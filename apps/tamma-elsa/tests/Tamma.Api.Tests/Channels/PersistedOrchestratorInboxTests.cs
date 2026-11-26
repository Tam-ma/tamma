using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Tamma.Api.Services.Channels;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Tests.Orchestrator;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Channels;
using Tamma.Core.Documents.Policy;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Channels;

/// <summary>
/// Story 39-18 + Story 39-17 lockstep — integration tests for
/// <see cref="PersistedOrchestratorInbox"/> backed by real Postgres
/// <c>channel_outbox</c> across provisioned tenant schemas:
/// <list type="bullet">
///   <item>DI registration pin (<see cref="IOrchestratorInbox"/> and <see cref="IOrchestratorInboxNotifier"/> resolve the same <see cref="PersistedOrchestratorInbox"/> singleton).</item>
///   <item>Durable persistence, UUID v7 replay order, crash/restart redelivery without loss, and idempotent ack.</item>
///   <item>End-to-end write-time wake: <see cref="ChannelOutboxService.EnqueueAsync"/> → <see cref="PersistedOrchestratorInbox"/> → <see cref="OrchestratorAgentInstance"/>.</item>
///   <item>Strict two-tenant isolation on Postgres schemas.</item>
///   <item>Non-inbound filtering (<see cref="GuidanceReply"/> is never delivered back into the agent's inbound loop).</item>
/// </list>
/// </summary>
[TestFixture]
public class PersistedOrchestratorInboxTests
{
    [SetUp]
    public Task SetUp() => ApiTestFixture.ResetDatabaseAsync();

    private static async Task<Guid> CreateAndProvisionTenantAsync(string slugPrefix)
    {
        Guid tenantId;
        using (var scope = ApiTestFixture.Factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<IUserRepository>();
            var tenants = scope.ServiceProvider.GetRequiredService<ITenantRepository>();
            var owner = await users.CreateAsync(new User
            {
                Email = $"{slugPrefix}-{Guid.NewGuid():N}@example.com",
                DisplayName = $"{slugPrefix} owner",
            });
            var tenant = await tenants.CreateAsync(new Tenant
            {
                Name = $"{slugPrefix} org",
                Slug = $"{slugPrefix}-{Guid.NewGuid():N}"[..20],
                Type = "org",
                OwnerId = owner.Id,
            });
            tenantId = tenant.Id;
        }

        await ApiTestFixture.ProvisionTenantAsync(tenantId);
        return tenantId;
    }

    [Test]
    public void Production_DI_wires_PersistedOrchestratorInbox_for_both_inbox_and_notifier()
    {
        var inbox = ApiTestFixture.Factory.Services.GetRequiredService<IOrchestratorInbox>();
        var notifier = ApiTestFixture.Factory.Services.GetRequiredService<IOrchestratorInboxNotifier>();

        inbox.Should().BeOfType<PersistedOrchestratorInbox>();
        notifier.Should().BeSameAs(inbox);
    }

    [Test]
    public async Task Unacked_outbox_rows_replay_in_uuidv7_order_across_restart_and_clear_after_ack()
    {
        var tenantId = await CreateAndProvisionTenantAsync("pbox-replay");
        var scopeFactory = ApiTestFixture.Factory.Services.GetRequiredService<IServiceScopeFactory>();

        // Instance 1 enqueues two items directly to Postgres channel_outbox
        var inboxBeforeRestart = new PersistedOrchestratorInbox(
            scopeFactory, NullLogger<PersistedOrchestratorInbox>.Instance);

        var id1 = UuidV7.NewGuid(DateTimeOffset.UtcNow.AddMilliseconds(-20));
        var id2 = UuidV7.NewGuid(DateTimeOffset.UtcNow);
        var q1 = new GuidanceQuery(Guid.NewGuid(), "corr-1", "First question", null);
        var q2 = new GuidanceQuery(Guid.NewGuid(), "corr-2", "Second question", null);

        await inboxBeforeRestart.EnqueueAsync(new OrchestratorInboxItem(id1, tenantId, q1, DateTimeOffset.UtcNow));
        await inboxBeforeRestart.EnqueueAsync(new OrchestratorInboxItem(id2, tenantId, q2, DateTimeOffset.UtcNow));

        // First consumer reads id1, then crashes before acking
        using (var cts1 = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
        {
            await foreach (var item in inboxBeforeRestart.SubscribeAsync(tenantId, cts1.Token))
            {
                item.ItemId.Should().Be(id1);
                cts1.Cancel();
                break;
            }
        }

        // Simulate full process restart with a brand-new PersistedOrchestratorInbox instance (zero in-memory state)
        var inboxAfterRestart = new PersistedOrchestratorInbox(
            scopeFactory, NullLogger<PersistedOrchestratorInbox>.Instance);

        (await inboxAfterRestart.GetTenantsWithPendingItemsAsync()).Should().Contain(tenantId);

        var replayed = new List<Guid>();
        using (var cts2 = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
        {
            await foreach (var item in inboxAfterRestart.SubscribeAsync(tenantId, cts2.Token))
            {
                replayed.Add(item.ItemId);
                await inboxAfterRestart.AckAsync(tenantId, item.ItemId);
                if (replayed.Count == 2)
                {
                    cts2.Cancel();
                    break;
                }
            }
        }

        replayed.Should().Equal(id1, id2);

        // Idempotent second ack does not throw; unacked list is now empty
        await inboxAfterRestart.AckAsync(tenantId, id1);
        using (var scope = scopeFactory.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<ITenantContext>().SetTenantId(tenantId);
            var repo = scope.ServiceProvider.GetRequiredService<IChannelOutboxRepository>();
            var remaining = await repo.ListUnackedAsync(tenantId, ChannelAudience.Orchestrator.ToWire(), null, 50);
            remaining.Should().BeEmpty();
        }
    }

    [Test]
    public async Task ChannelOutboxService_wakes_PersistedOrchestratorInbox_live_and_filters_non_inbound_replies()
    {
        var tenantId = await CreateAndProvisionTenantAsync("pbox-live");
        var inbox = ApiTestFixture.Factory.Services.GetRequiredService<IOrchestratorInbox>();
        var req = OrchestratorTestHarness.MakeRequest(docType: DocumentTypeKey.Findings, autonomyLevel: 100);

        // Start a live subscriber BEFORE enqueuing via ChannelOutboxService
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var received = new TaskCompletionSource<OrchestratorInboxItem>(TaskCreationOptions.RunContinuationsAsynchronously);
        var subTask = Task.Run(async () =>
        {
            await foreach (var item in inbox.SubscribeAsync(tenantId, cts.Token))
            {
                received.TrySetResult(item);
                break;
            }
        }, CancellationToken.None);

        // Give SubscribeAsync a moment to register live channel after empty initial scan
        await Task.Delay(150);

        // Enqueue a non-inbound GuidanceReply first (must NOT be delivered to inbound agent loop)
        // followed by an inbound AcceptanceRequested (MUST wake subscriber immediately).
        Guid reqMsgId;
        using (var scope = ApiTestFixture.Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<ITenantContext>().SetTenantId(tenantId);
            var svc = scope.ServiceProvider.GetRequiredService<ChannelOutboxService>();

            await svc.EnqueueAsync(new ChannelEnvelope(
                UuidV7.NewGuid(), tenantId, ChannelAudience.Orchestrator, null,
                new GuidanceReply(Guid.NewGuid(), "Outbound reply"), DateTimeOffset.UtcNow));

            reqMsgId = UuidV7.NewGuid();
            await svc.EnqueueAsync(new ChannelEnvelope(
                reqMsgId, tenantId, ChannelAudience.Orchestrator, null,
                new AcceptanceRequested(req), DateTimeOffset.UtcNow));
        }

        var delivered = await received.Task.WaitAsync(TimeSpan.FromSeconds(5));
        delivered.ItemId.Should().Be(reqMsgId);
        delivered.TenantId.Should().Be(tenantId);
        delivered.Message.Should().BeOfType<AcceptanceRequested>();

        await inbox.AckAsync(tenantId, delivered.ItemId);
        cts.Cancel();
        try { await subTask; } catch (OperationCanceledException) { }
    }

    [Test]
    public async Task Two_tenants_outbox_inboxes_are_strictly_isolated_on_postgres()
    {
        var tenantA = await CreateAndProvisionTenantAsync("pbox-isoA");
        var tenantB = await CreateAndProvisionTenantAsync("pbox-isoB");
        var scopeFactory = ApiTestFixture.Factory.Services.GetRequiredService<IServiceScopeFactory>();

        var inbox = new PersistedOrchestratorInbox(
            scopeFactory, NullLogger<PersistedOrchestratorInbox>.Instance);

        var idA = UuidV7.NewGuid();
        var idB = UuidV7.NewGuid();
        await inbox.EnqueueAsync(new OrchestratorInboxItem(idA, tenantA, new GuidanceQuery(Guid.NewGuid(), "cA", "Only A", null), DateTimeOffset.UtcNow));
        await inbox.EnqueueAsync(new OrchestratorInboxItem(idB, tenantB, new GuidanceQuery(Guid.NewGuid(), "cB", "Only B", null), DateTimeOffset.UtcNow));

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        OrchestratorInboxItem? gotA = null;
        await foreach (var item in inbox.SubscribeAsync(tenantA, cts.Token))
        {
            gotA = item;
            await inbox.AckAsync(tenantA, item.ItemId);
            break;
        }

        gotA.Should().NotBeNull();
        gotA!.ItemId.Should().Be(idA);
        gotA.TenantId.Should().Be(tenantA);
        ((GuidanceQuery)gotA.Message).Question.Should().Be("Only A");

        // Tenant B's item is still untouched and pending in Tenant B's outbox
        using var scope = scopeFactory.CreateScope();
        scope.ServiceProvider.GetRequiredService<ITenantContext>().SetTenantId(tenantB);
        var repo = scope.ServiceProvider.GetRequiredService<IChannelOutboxRepository>();
        var unackedB = await repo.ListUnackedAsync(tenantB, ChannelAudience.Orchestrator.ToWire(), null, 10);
        unackedB.Should().ContainSingle(r => r.Id == idB);
    }
}
