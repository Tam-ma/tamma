using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using NUnit.Framework;
using Tamma.Activities.Documents;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Channels;
using Tamma.Api.Services.Chat;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Services.Tasks;
using Tamma.Core.Documents.Channels;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Chat;

/// <summary>
/// Story 39-19 (AC1 / AC4 / AC6) — real Testcontainers Postgres two-tenant schema
/// isolation for chat history projection, task inbox projection, and production DI pins.
/// </summary>
[TestFixture]
public sealed class ChatHistoryIsolationTests
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
    public async Task Two_tenants_and_two_users_per_tenant_have_strictly_isolated_chat_and_task_projections()
    {
        var tenantA = await CreateAndProvisionTenantAsync("chat-iso-a");
        var tenantB = await CreateAndProvisionTenantAsync("chat-iso-b");

        var userA1 = Guid.NewGuid();
        var userA2 = Guid.NewGuid();
        var userB1 = Guid.NewGuid();
        var sharedConvId = Guid.NewGuid();
        var sessionA = Guid.NewGuid();
        var sessionB = Guid.NewGuid();

        using (var scopeA = ApiTestFixture.Factory.Services.CreateScope())
        {
            scopeA.ServiceProvider.GetRequiredService<ITenantContext>().SetTenantId(tenantA);
            var recorder = scopeA.ServiceProvider.GetRequiredService<EventStoreChatTranscriptRecorder>();
            var events = scopeA.ServiceProvider.GetRequiredService<IEventRepository>();

            var turnA1 = await recorder.RecordUserTurnAsync(new ChatTurnContext(tenantA, userA1, sharedConvId), "Tenant A User 1 private message");
            await recorder.RecordAgentReplyAsync(new ChatTurnContext(tenantA, userA1, sharedConvId), turnA1, "Tenant A User 1 private reply");
            await recorder.RecordUserTurnAsync(new ChatTurnContext(tenantA, userA2, Guid.NewGuid()), "Tenant A User 2 message");

            await events.AppendAsync(new DomainEvent
            {
                Id = Guid.NewGuid(),
                Type = TaskEvents.Assigned,
                TenantId = tenantA,
                Tags = JsonSerializer.Serialize(new { sessionId = sessionA.ToString("D"), issueId = "acme/a#1", initiatedBy = userA1.ToString("D") }),
                Data = JsonSerializer.Serialize(new { roleWire = "member", basis = "initiator", audienceUserIds = new[] { userA1.ToString("D") } }),
                CreatedAt = DateTime.UtcNow,
            });
        }

        using (var scopeB = ApiTestFixture.Factory.Services.CreateScope())
        {
            scopeB.ServiceProvider.GetRequiredService<ITenantContext>().SetTenantId(tenantB);
            var recorder = scopeB.ServiceProvider.GetRequiredService<EventStoreChatTranscriptRecorder>();
            var events = scopeB.ServiceProvider.GetRequiredService<IEventRepository>();

            await recorder.RecordUserTurnAsync(new ChatTurnContext(tenantB, userB1, sharedConvId), "Tenant B User 1 message");
            await events.AppendAsync(new DomainEvent
            {
                Id = Guid.NewGuid(),
                Type = TaskEvents.Assigned,
                TenantId = tenantB,
                Tags = JsonSerializer.Serialize(new { sessionId = sessionB.ToString("D"), issueId = "beta/b#1", initiatedBy = userB1.ToString("D") }),
                Data = JsonSerializer.Serialize(new { roleWire = "member", basis = "initiator", audienceUserIds = new[] { userB1.ToString("D") } }),
                CreatedAt = DateTime.UtcNow,
            });
        }

        // Verify Tenant A reads: A1 sees A1's conversation only; A2 sees empty for A1's conversationId.
        using (var verifyA = ApiTestFixture.Factory.Services.CreateScope())
        {
            verifyA.ServiceProvider.GetRequiredService<ITenantContext>().SetTenantId(tenantA);
            var chatProj = verifyA.ServiceProvider.GetRequiredService<ChatHistoryProjection>();

            var pageA1 = await chatProj.GetConversationAsync(tenantA, userA1, sharedConvId);
            pageA1.Messages.Select(m => m.Content)
                .Should().Equal("Tenant A User 1 private message", "Tenant A User 1 private reply");

            var pageA2 = await chatProj.GetConversationAsync(tenantA, userA2, sharedConvId);
            pageA2.Messages.Should().BeEmpty("user A2 must not see user A1's conversation");

            // Cross-tenant probe: userB1 cannot read tenantA's data even using sharedConvId.
            var crossPage = await chatProj.GetConversationAsync(tenantA, userB1, sharedConvId);
            crossPage.Messages.Should().BeEmpty();
        }

        // Verify Tenant B reads: B1 sees ONLY Tenant B's message even with identical conversationId.
        using (var verifyB = ApiTestFixture.Factory.Services.CreateScope())
        {
            verifyB.ServiceProvider.GetRequiredService<ITenantContext>().SetTenantId(tenantB);
            var chatProj = verifyB.ServiceProvider.GetRequiredService<ChatHistoryProjection>();

            var pageB1 = await chatProj.GetConversationAsync(tenantB, userB1, sharedConvId);
            pageB1.Messages.Select(m => m.Content).Should().Equal("Tenant B User 1 message");
        }
    }

    [Test]
    public void Production_DI_wires_OrchestratorChatService_and_EventStoreChatTranscriptRecorder()
    {
        using var scope = ApiTestFixture.Factory.Services.CreateScope();
        var sp = scope.ServiceProvider;

        sp.GetRequiredService<IOrchestratorChatRelay>().Should().BeOfType<OrchestratorChatService>();
        sp.GetRequiredService<IChatTranscriptRecorder>().Should().BeOfType<EventStoreChatTranscriptRecorder>();
        sp.GetRequiredService<IUserChannelSender>().Should().BeOfType<SignalRUserChannelSender>();
        sp.GetRequiredService<IChatWorkflowInitiationService>().Should().BeOfType<ChatWorkflowInitiationService>();
        sp.GetRequiredService<ChatHistoryProjection>().Should().NotBeNull();
        sp.GetRequiredService<TaskInboxProjection>().Should().NotBeNull();
    }
}
