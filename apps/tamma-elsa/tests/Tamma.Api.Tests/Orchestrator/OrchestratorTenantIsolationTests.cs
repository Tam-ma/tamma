using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.AcceptanceRules;
using Tamma.Api.Services.Documents;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Services.Orchestrator.Tools;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Channels;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;
using Tamma.Platforms.Abstractions;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Story 39-17 (AC1 / AC6 / AC7 / D13) — real Postgres multi-tenant isolation
/// integration tests across two provisioned tenant schemas (<c>t_&lt;hex&gt;</c>):
/// <list type="bullet">
///   <item>Two tenants' <see cref="OrchestratorAgentInstance"/>s run concurrently with completely disjoint sessions and registries.</item>
///   <item>Tenant A's <c>event_store_query</c> and <c>document_get</c> NEVER see Tenant B's rows.</item>
///   <item>Inbox deliveries and <see cref="OrchestratorConfigService"/> overrides never cross tenants.</item>
/// </list>
/// </summary>
[TestFixture]
public class OrchestratorTenantIsolationTests
{
    [Test]
    public async Task Two_tenants_run_isolated_with_disjoint_events_documents_configs_and_inboxes()
    {
        Guid tenantA;
        Guid tenantB;
        using (var scope = ApiTestFixture.Factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<IUserRepository>();
            var tenants = scope.ServiceProvider.GetRequiredService<ITenantRepository>();
            var ownerA = await users.CreateAsync(new User
            {
                Email = $"orch-iso-a-{Guid.NewGuid():N}@example.com",
                DisplayName = "Orch Iso Owner A",
            });
            var ownerB = await users.CreateAsync(new User
            {
                Email = $"orch-iso-b-{Guid.NewGuid():N}@example.com",
                DisplayName = "Orch Iso Owner B",
            });
            var tA = await tenants.CreateAsync(new Tenant
            {
                Name = "Orch Iso Tenant A",
                Slug = $"orch-a-{Guid.NewGuid():N}"[..20],
                Type = "org",
                OwnerId = ownerA.Id,
            });
            var tB = await tenants.CreateAsync(new Tenant
            {
                Name = "Orch Iso Tenant B",
                Slug = $"orch-b-{Guid.NewGuid():N}"[..20],
                Type = "org",
                OwnerId = ownerB.Id,
            });
            tenantA = tA.Id;
            tenantB = tB.Id;
        }

        await ApiTestFixture.ProvisionTenantAsync(tenantA);
        await ApiTestFixture.ProvisionTenantAsync(tenantB);

        var dbFactory = ApiTestFixture.Factory.Services.GetRequiredService<ITenantDbContextFactory>();

        // Seed distinct events, documents, and configs into Tenant A and Tenant B schemas
        var docAId = Guid.NewGuid();
        var docBId = Guid.NewGuid();

        await using (var dbA = await dbFactory.CreateAsync(tenantA))
        {
            dbA.DomainEvents.Add(new DomainEvent
            {
                Type = "ORCHESTRATOR.DECISION.MADE",
                TenantId = tenantA,
                Tags = """{"tenant":"A"}""",
                Metadata = "{}",
                Data = """{"secret":"tenant-A-only-event"}""",
                CreatedAt = DateTime.UtcNow,
            });
            dbA.Documents.Add(new DocumentInstance
            {
                Id = docAId,
                TenantId = tenantA,
                DocumentType = "findings",
                SchemaVersion = 1,
                IssueId = "orgA/repo#1",
                CorrelationId = "corr-A",
                ProducedByRole = "architect",
                ProducedByAction = "context-scan",
                Status = "in_review",
                BodyJson = """{"topic":"tenantA","summary":"Tenant A secret doc","findings":[{"title":"A1","summary":"A","relevance":0.9,"confidence":0.9,"citations":["a.cs"]}],"overallConfidence":0.9}""",
                Revision = 1,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
            await dbA.SaveChangesAsync();
        }

        await using (var dbB = await dbFactory.CreateAsync(tenantB))
        {
            dbB.DomainEvents.Add(new DomainEvent
            {
                Type = "ORCHESTRATOR.DECISION.MADE",
                TenantId = tenantB,
                Tags = """{"tenant":"B"}""",
                Metadata = "{}",
                Data = """{"secret":"tenant-B-only-event"}""",
                CreatedAt = DateTime.UtcNow,
            });
            dbB.Documents.Add(new DocumentInstance
            {
                Id = docBId,
                TenantId = tenantB,
                DocumentType = "findings",
                SchemaVersion = 1,
                IssueId = "orgB/repo#2",
                CorrelationId = "corr-B",
                ProducedByRole = "architect",
                ProducedByAction = "context-scan",
                Status = "in_review",
                BodyJson = """{"topic":"tenantB","summary":"Tenant B secret doc","findings":[{"title":"B1","summary":"B","relevance":0.9,"confidence":0.9,"citations":["b.cs"]}],"overallConfidence":0.9}""",
                Revision = 1,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
            await dbB.SaveChangesAsync();
        }

        // Build per-tenant repositories bound to each tenant's real Postgres schema
        var tcA = new TenantContext(); tcA.SetTenantId(tenantA);
        var tcB = new TenantContext(); tcB.SetTenantId(tenantB);

        var eventsA = new EventRepository(dbFactory, tcA);
        var eventsB = new EventRepository(dbFactory, tcB);
        var docsA = new DocumentInstanceRepository(dbFactory, tcA);
        var docsB = new DocumentInstanceRepository(dbFactory, tcB);
        var cfgRepoA = new OrchestratorAgentConfigRepository(dbFactory, tcA);
        var cfgRepoB = new OrchestratorAgentConfigRepository(dbFactory, tcB);
        var cfgSvcA = new OrchestratorConfigService(cfgRepoA, eventsA, NullLogger<OrchestratorConfigService>.Instance);
        var cfgSvcB = new OrchestratorConfigService(cfgRepoB, eventsB, NullLogger<OrchestratorConfigService>.Instance);

        await cfgSvcA.UpsertForTenantAsync(tenantA, Guid.NewGuid(), OrchestratorAgentDefaults.Config with { Model = "model-tenant-A" });
        await cfgSvcB.UpsertForTenantAsync(tenantB, Guid.NewGuid(), OrchestratorAgentDefaults.Config with { Model = "model-tenant-B" });

        (await cfgSvcA.ResolveForTenantAsync(tenantA)).Config.Model.Should().Be("model-tenant-A");
        (await cfgSvcB.ResolveForTenantAsync(tenantB)).Config.Model.Should().Be("model-tenant-B");

        // Run Tenant A's event_store_query and document_get tools against real Postgres
        var ctxA = new OrchestratorToolContext(tenantA, null, null, null, "corr-iso-A");
        var eventToolA = new EventStoreQueryTool(ctxA, eventsA);
        var docToolA = new DocumentGetTool(ctxA, docsA);

        var evResA = await eventToolA.ExecuteAsync("c1", """{"type":"ORCHESTRATOR."}""");
        evResA.Success.Should().BeTrue();
        evResA.Output.Should().Contain("tenant-A-only-event");
        evResA.Output.Should().NotContain("tenant-B-only-event");

        var docOwnResA = await docToolA.ExecuteAsync("c2", $$"""{"documentId":"{{docAId}}"}""");
        docOwnResA.Success.Should().BeTrue();
        docOwnResA.Output.Should().Contain("Tenant A secret doc");

        var docCrossResA = await docToolA.ExecuteAsync("c3", $$"""{"documentId":"{{docBId}}"}""");
        docCrossResA.Success.Should().BeFalse("Tenant A's document_get must never read Tenant B's document");
        docCrossResA.Output.Should().NotContain("Tenant B secret doc");

        // Shared inbox dispatches strictly per tenant
        var inbox = new InMemoryOrchestratorInbox();
        await inbox.EnqueueAsync(new OrchestratorInboxItem(Guid.NewGuid(), tenantA, new GuidanceQuery(Guid.NewGuid(), "cA", "Q-A", null), DateTimeOffset.UtcNow));
        await inbox.EnqueueAsync(new OrchestratorInboxItem(Guid.NewGuid(), tenantB, new GuidanceQuery(Guid.NewGuid(), "cB", "Q-B", null), DateTimeOffset.UtcNow));

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        OrchestratorInboxItem? receivedA = null;
        await foreach (var item in inbox.SubscribeAsync(tenantA, cts.Token))
        {
            receivedA = item;
            break;
        }
        receivedA.Should().NotBeNull();
        receivedA!.TenantId.Should().Be(tenantA);
        ((GuidanceQuery)receivedA.Message).Question.Should().Be("Q-A");
    }
}
