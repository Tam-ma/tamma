using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Moq;
using NUnit.Framework;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.Chat;
using Tamma.Api.Services.PromptStore;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Chat;

[TestFixture]
public sealed class ChatHistoryProjectionTests
{
    [Test]
    public async Task Projection_orders_by_SequenceNumber_groups_conversations_and_isolates_users()
    {
        var tenantId = Guid.NewGuid();
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();
        var convA1 = Guid.NewGuid();
        var convA2 = Guid.NewGuid();

        var t0 = DateTime.UtcNow.AddMinutes(-10);
        var allEvents = new List<DomainEvent>
        {
            MakeChatEvent(tenantId, userA, convA1, ChatEvents.MessageReceived, "user->agent", "first A1", 1, t0),
            MakeChatEvent(tenantId, userA, convA1, ChatEvents.MessageSent, "agent->user", "reply A1", 2, t0.AddSeconds(5)),
            MakeChatEvent(tenantId, userA, convA2, ChatEvents.MessageReceived, "user->agent", "hello A2", 3, t0.AddMinutes(2)),
            MakeChatEvent(tenantId, userB, convA1, ChatEvents.MessageReceived, "user->agent", "B same conv id", 4, t0.AddMinutes(3)),
        };

        var repo = new Mock<IEventRepository>(MockBehavior.Strict);
        repo.Setup(r => r.QueryEventsAsync(
                tenantId,
                ChatHistoryProjection.MessagePrefix,
                true,
                It.IsAny<string?>(),
                It.IsAny<string?>(),
                null, null,
                It.IsAny<long?>(),
                It.IsAny<int>(),
                false))
            .ReturnsAsync((Guid tid, string? type, bool prefix, string? corr, string? actor,
                DateTimeOffset? from, DateTimeOffset? to, long? cursor, int limit, bool incTotal) =>
            {
                var filtered = allEvents
                    .Where(e => e.TenantId == tid)
                    .Where(e => actor is null || e.Tags.Contains(actor, StringComparison.OrdinalIgnoreCase))
                    .Where(e => corr is null || e.Tags.Contains(corr, StringComparison.OrdinalIgnoreCase))
                    .OrderByDescending(e => e.SequenceNumber)
                    .Take(limit)
                    .ToList();
                return ((IReadOnlyList<DomainEvent>)filtered, (int?)null);
            });

        var projection = new ChatHistoryProjection(repo.Object);

        var summariesA = await projection.ListConversationsAsync(tenantId, userA);
        summariesA.Should().HaveCount(2);
        summariesA[0].ConversationId.Should().Be(convA2);
        summariesA[0].MessageCount.Should().Be(1);
        summariesA[1].ConversationId.Should().Be(convA1);
        summariesA[1].MessageCount.Should().Be(2);
        summariesA[1].LastSnippet.Should().Be("reply A1");

        var pageA1 = await projection.GetConversationAsync(tenantId, userA, convA1);
        pageA1.Messages.Select(m => m.Content).Should().Equal("first A1", "reply A1");

        // User B querying A's second conversation gets empty (actor filter).
        var pageBForA2 = await projection.GetConversationAsync(tenantId, userB, convA2);
        pageBForA2.Messages.Should().BeEmpty();
    }

    [Test]
    public async Task Single_user_null_tenant_path_returns_sole_users_history()
    {
        var soleUser = Guid.NewGuid();
        var convId = Guid.NewGuid();
        var t0 = DateTime.UtcNow.AddMinutes(-5);

        var repo = new Mock<IEventRepository>(MockBehavior.Strict);
        repo.Setup(r => r.QueryAsync(null, ChatEvents.MessageReceived, null, It.IsAny<int>()))
            .ReturnsAsync(new List<DomainEvent>
            {
                MakeChatEvent(null, soleUser, convId, ChatEvents.MessageReceived, "user->agent", "ping", 10, t0),
            });
        repo.Setup(r => r.QueryAsync(null, ChatEvents.MessageSent, null, It.IsAny<int>()))
            .ReturnsAsync(new List<DomainEvent>
            {
                MakeChatEvent(null, soleUser, convId, ChatEvents.MessageSent, "agent->user", "pong", 11, t0.AddSeconds(2)),
            });

        var projection = new ChatHistoryProjection(repo.Object);
        var page = await projection.GetConversationAsync(tenantId: null, soleUser, convId);

        page.Messages.Should().HaveCount(2);
        page.Messages.Select(m => m.Content).Should().Equal("ping", "pong");
    }

    [Test]
    public async Task ChatEndpoints_fail_closed_404_when_SaaS_tenant_missing_before_touching_repo()
    {
        var repo = new Mock<IEventRepository>(MockBehavior.Strict);
        var projection = new ChatHistoryProjection(repo.Object);
        var tc = new Mock<ITenantContext>();
        tc.SetupGet(t => t.TenantId).Returns((Guid?)null);
        var mode = new Mock<ITammaModeProvider>();
        mode.SetupGet(m => m.Mode).Returns(TammaMode.SaaS);

        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("sub", Guid.NewGuid().ToString("D")),
        }, "Test"));

        var listRes = await ChatEndpoints.ListConversations(null, projection, tc.Object, mode.Object, principal, CancellationToken.None);
        (listRes as IStatusCodeHttpResult)?.StatusCode.Should().Be(StatusCodes.Status404NotFound);

        var getRes = await ChatEndpoints.GetConversation(Guid.NewGuid(), null, null, projection, tc.Object, mode.Object, principal, CancellationToken.None);
        (getRes as IStatusCodeHttpResult)?.StatusCode.Should().Be(StatusCodes.Status404NotFound);

        repo.VerifyNoOtherCalls();
    }

    private static DomainEvent MakeChatEvent(
        Guid? tenantId, Guid userId, Guid convId, string type, string dir, string content, long seq, DateTime createdAt) =>
        new()
        {
            Id = Guid.NewGuid(),
            SequenceNumber = seq,
            Type = type,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["userId"] = userId.ToString("D"),
                ["conversationId"] = convId.ToString("D"),
                ["correlationId"] = convId.ToString("D"),
                ["turnId"] = Guid.NewGuid().ToString("D"),
                ["tenantId"] = tenantId?.ToString("D"),
            }),
            Data = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["direction"] = dir,
                ["content"] = content,
                ["snippet"] = content,
            }),
            CreatedAt = createdAt,
        };
}
