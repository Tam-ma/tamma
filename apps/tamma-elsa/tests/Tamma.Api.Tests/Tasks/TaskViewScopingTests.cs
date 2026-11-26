using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Moq;
using NUnit.Framework;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Services.Tasks;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Tasks;

[TestFixture]
public sealed class TaskViewScopingTests
{
    [Test]
    public async Task Two_same_tenant_users_with_disjoint_repo_access_see_only_their_scoped_tasks()
    {
        var tenantId = Guid.NewGuid();
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();
        var taskRepoA = Guid.NewGuid();
        var taskRepoB = Guid.NewGuid();
        var taskInitiatedByA = Guid.NewGuid();
        var t0 = DateTime.UtcNow.AddMinutes(-10);

        var allEvents = new List<DomainEvent>
        {
            MakeTaskEvent(tenantId, taskRepoA, 1, t0, "acme/repo-a#1", initiator: null),
            MakeTaskEvent(tenantId, taskRepoB, 2, t0.AddMinutes(1), "acme/repo-b#2", initiator: null),
            MakeTaskEvent(tenantId, taskInitiatedByA, 3, t0.AddMinutes(2), "acme/other#3", initiator: userA),
        };

        var repo = new Mock<IEventRepository>(MockBehavior.Strict);
        repo.Setup(r => r.QueryEventsAsync(tenantId, It.IsAny<string?>(), true, null, null, null, null, null, It.IsAny<int>(), false))
            .ReturnsAsync((Guid tid, string? type, bool prefix, string? corr, string? actor,
                DateTimeOffset? from, DateTimeOffset? to, long? cursor, int limit, bool incTotal) =>
            {
                var matched = allEvents.Where(e => type is null || e.Type.StartsWith(type, StringComparison.Ordinal)).ToList();
                return ((IReadOnlyList<DomainEvent>)matched, (int?)null);
            });

        // 39-20 predicate: user A sees repo-a + tasks they initiated; user B sees repo-b only.
        var resolver = new Mock<ITaskAudienceResolver>();
        resolver.Setup(r => r.CanSeeAsync(It.IsAny<Guid>(), It.IsAny<TaskRef>()))
            .ReturnsAsync((Guid uid, TaskRef t) =>
                (uid == userA && (t.RepoKey == "acme/repo-a" || t.InitiatorUserId == userA)) ||
                (uid == userB && t.RepoKey == "acme/repo-b"));
        resolver.Setup(r => r.EligibleAudienceAsync(It.IsAny<TaskRef>(), It.IsAny<string>()))
            .ReturnsAsync(Array.Empty<AudienceMember>());

        var projection = new TaskInboxProjection(repo.Object, resolver.Object);
        var tc = new Mock<ITenantContext>();
        tc.SetupGet(t => t.TenantId).Returns(tenantId);
        var mode = new Mock<ITammaModeProvider>();
        mode.SetupGet(m => m.Mode).Returns(TammaMode.SaaS);

        var listA = await projection.ListForUserAsync(tenantId, userA);
        listA.Select(t => t.SessionId).Should().Equal(taskRepoA, taskInitiatedByA);

        var listB = await projection.ListForUserAsync(tenantId, userB);
        listB.Select(t => t.SessionId).Should().Equal(taskRepoB);

        // Endpoint GetTask returns 404 when userB requests userA's task.
        var principalB = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("sub", userB.ToString("D")) }, "Test"));
        var getRes = await TaskEndpoints.GetTask(taskRepoA, projection, tc.Object, mode.Object, principalB, CancellationToken.None);
        (getRes as IStatusCodeHttpResult)?.StatusCode.Should().Be(StatusCodes.Status404NotFound);
    }

    [Test]
    public async Task TaskEndpoints_fail_closed_404_when_SaaS_tenant_missing_and_single_user_sees_all()
    {
        var repo = new Mock<IEventRepository>(MockBehavior.Strict);
        var resolver = new Mock<ITaskAudienceResolver>(MockBehavior.Strict);
        var projection = new TaskInboxProjection(repo.Object, resolver.Object);

        var tc = new Mock<ITenantContext>();
        tc.SetupGet(t => t.TenantId).Returns((Guid?)null);
        var saasMode = new Mock<ITammaModeProvider>();
        saasMode.SetupGet(m => m.Mode).Returns(TammaMode.SaaS);

        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("sub", Guid.NewGuid().ToString("D")) }, "Test"));

        var listRes = await TaskEndpoints.ListTasks(false, projection, tc.Object, saasMode.Object, principal, CancellationToken.None);
        (listRes as IStatusCodeHttpResult)?.StatusCode.Should().Be(StatusCodes.Status404NotFound);

        var getRes = await TaskEndpoints.GetTask(Guid.NewGuid(), projection, tc.Object, saasMode.Object, principal, CancellationToken.None);
        (getRes as IStatusCodeHttpResult)?.StatusCode.Should().Be(StatusCodes.Status404NotFound);

        repo.VerifyNoOtherCalls();
        resolver.VerifyNoOtherCalls();
    }

    private static DomainEvent MakeTaskEvent(Guid tenantId, Guid sessionId, long seq, DateTime at, string issueId, Guid? initiator) =>
        new()
        {
            Id = Guid.NewGuid(),
            SequenceNumber = seq,
            Type = TaskEvents.Assigned,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["sessionId"] = sessionId.ToString("D"),
                ["issueId"] = issueId,
                ["initiatedBy"] = initiator?.ToString("D"),
            }),
            Data = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["roleWire"] = "member",
                ["basis"] = initiator is not null ? "initiator" : "repo-access",
            }),
            CreatedAt = at,
        };
}
