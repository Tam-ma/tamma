using System.Text.Json;
using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.Documents;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Tasks;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Tasks;

[TestFixture]
public sealed class TaskInboxProjectionTests
{
    [Test]
    public async Task Assigned_task_surfaces_for_all_audience_members_with_metadata_and_lineage_url()
    {
        var tenantId = Guid.NewGuid();
        var alice = Guid.NewGuid();
        var bob = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var docId = Guid.NewGuid();
        var t0 = DateTime.UtcNow.AddMinutes(-30);

        var events = new List<DomainEvent>
        {
            new()
            {
                Id = Guid.NewGuid(),
                SequenceNumber = 1,
                Type = ApprovalEvents.Requested,
                TenantId = tenantId,
                Tags = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["sessionId"] = sessionId.ToString("D"),
                    ["issueId"] = "acme/web#42",
                    ["documentId"] = docId.ToString("D"),
                    ["documentType"] = "design",
                    ["correlationId"] = "wf-run-42",
                }),
                Data = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["rulesReference"] = "rules-v3",
                    ["requestedAtUtc"] = t0.ToString("O"),
                }),
                CreatedAt = t0,
            },
            new()
            {
                Id = Guid.NewGuid(),
                SequenceNumber = 2,
                Type = TaskEvents.Assigned,
                TenantId = tenantId,
                Tags = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["tenantId"] = tenantId.ToString("D"),
                    ["issueId"] = "acme/web#42",
                    ["documentId"] = docId.ToString("D"),
                }),
                Data = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["roleWire"] = "member",
                    ["basis"] = "repo-access",
                    ["taskType"] = "unknown_future_kind", // exercises closed-set fallback
                    ["autonomyContextRef"] = "autonomy level 60: Design requires human acceptance",
                    ["audienceUserIds"] = new[] { alice.ToString("D"), bob.ToString("D") },
                }),
                CreatedAt = t0.AddSeconds(5),
            },
        };

        var resolver = new Mock<ITaskAudienceResolver>();
        resolver.Setup(r => r.CanSeeAsync(It.IsAny<Guid>(), It.IsAny<TaskRef>())).ReturnsAsync(true);
        resolver.Setup(r => r.EligibleAudienceAsync(It.IsAny<TaskRef>(), "member"))
            .ReturnsAsync(new[]
            {
                new AudienceMember(alice, "member"),
                new AudienceMember(bob, "member"),
            });

        var projection = new TaskInboxProjection(MakeEventRepo(tenantId, events), resolver.Object);

        foreach (var viewer in new[] { alice, bob })
        {
            var items = await projection.ListForUserAsync(tenantId, viewer);
            items.Should().HaveCount(1);
            var item = items[0];
            item.SessionId.Should().Be(sessionId);
            item.TaskType.Should().Be(TaskTypes.AcceptanceDecision, "unknown task type falls back safely");
            item.DocumentType.Should().Be("design");
            item.DocumentId.Should().Be(docId);
            item.IssueId.Should().Be("acme/web#42");
            item.CorrelationId.Should().Be("wf-run-42");
            item.AssignedRole.Should().Be("member");
            item.EligibilityBasis.Should().Be("repo-access");
            item.AutonomyContext.Should().Contain("autonomy level 60");
            item.LineageUrl.Should().Be("/api/documents/issues/acme%2Fweb%2342/lineage");
            item.Status.Should().Be("pending");
        }
    }

    [Test]
    public async Task Reassignment_clears_old_role_holders_and_grants_new_role_holders()
    {
        var tenantId = Guid.NewGuid();
        var member = Guid.NewGuid();
        var admin = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var t0 = DateTime.UtcNow.AddMinutes(-20);

        var events = new List<DomainEvent>
        {
            new()
            {
                Id = Guid.NewGuid(),
                SequenceNumber = 1,
                Type = TaskEvents.Assigned,
                TenantId = tenantId,
                Tags = JsonSerializer.Serialize(new { sessionId = sessionId.ToString("D"), issueId = "acme/web#10" }),
                Data = JsonSerializer.Serialize(new
                {
                    roleWire = "member",
                    basis = "repo-access",
                    audienceUserIds = new[] { member.ToString("D"), admin.ToString("D") },
                }),
                CreatedAt = t0,
            },
            new()
            {
                Id = Guid.NewGuid(),
                SequenceNumber = 2,
                Type = TaskEvents.Reassigned,
                TenantId = tenantId,
                Tags = JsonSerializer.Serialize(new { sessionId = sessionId.ToString("D"), issueId = "acme/web#10" }),
                Data = JsonSerializer.Serialize(new
                {
                    previousRoleWire = "member",
                    roleWire = "admin",
                    basis = "repo-access",
                    audienceUserIds = new[] { admin.ToString("D") },
                }),
                CreatedAt = t0.AddMinutes(5),
            },
        };

        var resolver = new Mock<ITaskAudienceResolver>();
        resolver.Setup(r => r.CanSeeAsync(It.IsAny<Guid>(), It.IsAny<TaskRef>())).ReturnsAsync(true);
        resolver.Setup(r => r.EligibleAudienceAsync(It.IsAny<TaskRef>(), "admin"))
            .ReturnsAsync(new[] { new AudienceMember(admin, "admin") });

        var projection = new TaskInboxProjection(MakeEventRepo(tenantId, events), resolver.Object);

        (await projection.ListForUserAsync(tenantId, member)).Should().BeEmpty("old role holder loses reassigned task");
        var adminItems = await projection.ListForUserAsync(tenantId, admin);
        adminItems.Should().ContainSingle(t => t.SessionId == sessionId && t.AssignedRole == "admin");
    }

    [Test]
    public async Task Either_APPROVAL_PROVIDED_or_TASK_COMPLETED_removes_pending_task_for_all_viewers()
    {
        var tenantId = Guid.NewGuid();
        var alice = Guid.NewGuid();
        var bob = Guid.NewGuid();
        var s1 = Guid.NewGuid();
        var s2 = Guid.NewGuid();
        var s3 = Guid.NewGuid();
        var t0 = DateTime.UtcNow.AddMinutes(-15);

        var events = new List<DomainEvent>
        {
            MakeAssigned(tenantId, s1, 1, t0, alice, bob),
            MakeAssigned(tenantId, s2, 2, t0.AddMinutes(1), alice, bob),
            MakeAssigned(tenantId, s3, 3, t0.AddMinutes(2), alice, bob),
            // s1 completed by APPROVAL.PROVIDED alone
            new()
            {
                Id = Guid.NewGuid(),
                SequenceNumber = 4,
                Type = ApprovalEvents.Provided,
                TenantId = tenantId,
                Tags = JsonSerializer.Serialize(new { sessionId = s1.ToString("D") }),
                Data = JsonSerializer.Serialize(new { decisionKind = "accept", channel = "user" }),
                CreatedAt = t0.AddMinutes(3),
            },
            // s2 completed by TASK.COMPLETED.SUCCESS alone
            new()
            {
                Id = Guid.NewGuid(),
                SequenceNumber = 5,
                Type = TaskEvents.Completed,
                TenantId = tenantId,
                Tags = JsonSerializer.Serialize(new { sessionId = s2.ToString("D") }),
                Data = JsonSerializer.Serialize(new { completedByUserId = alice.ToString("D"), surface = "chat" }),
                CreatedAt = t0.AddMinutes(4),
            },
        };

        var resolver = new Mock<ITaskAudienceResolver>();
        resolver.Setup(r => r.CanSeeAsync(It.IsAny<Guid>(), It.IsAny<TaskRef>())).ReturnsAsync(true);
        resolver.Setup(r => r.EligibleAudienceAsync(It.IsAny<TaskRef>(), "member"))
            .ReturnsAsync(new[] { new AudienceMember(alice, "member"), new AudienceMember(bob, "member") });

        var projection = new TaskInboxProjection(MakeEventRepo(tenantId, events), resolver.Object);

        foreach (var viewer in new[] { alice, bob })
        {
            var pending = await projection.ListForUserAsync(tenantId, viewer, includeCompleted: false);
            pending.Should().ContainSingle(t => t.SessionId == s3);
        }
    }

    private static DomainEvent MakeAssigned(Guid tenantId, Guid sessionId, long seq, DateTime at, params Guid[] users) =>
        new()
        {
            Id = Guid.NewGuid(),
            SequenceNumber = seq,
            Type = TaskEvents.Assigned,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(new { sessionId = sessionId.ToString("D"), issueId = $"acme/web#{seq}" }),
            Data = JsonSerializer.Serialize(new
            {
                roleWire = "member",
                basis = "repo-access",
                audienceUserIds = users.Select(u => u.ToString("D")).ToArray(),
            }),
            CreatedAt = at,
        };

    private static IEventRepository MakeEventRepo(Guid tenantId, List<DomainEvent> all)
    {
        var repo = new Mock<IEventRepository>(MockBehavior.Strict);
        repo.Setup(r => r.QueryEventsAsync(
                tenantId,
                It.IsAny<string?>(),
                true,
                null, null, null, null, null,
                It.IsAny<int>(),
                false))
            .ReturnsAsync((Guid tid, string? type, bool prefix, string? corr, string? actor,
                DateTimeOffset? from, DateTimeOffset? to, long? cursor, int limit, bool incTotal) =>
            {
                var matched = all
                    .Where(e => e.TenantId == tid && (type is null || e.Type.StartsWith(type, StringComparison.Ordinal)))
                    .ToList();
                return ((IReadOnlyList<DomainEvent>)matched, (int?)null);
            });
        return repo.Object;
    }
}
