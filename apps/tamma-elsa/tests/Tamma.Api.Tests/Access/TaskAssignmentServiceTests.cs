using System.Text.Json;
using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Services.Tasks;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Access;

/// <summary>
/// Story 39-20 (AC4 / AC5 / D7 / D8) — tests for <see cref="TaskAssignmentService"/>:
/// role-addressed server validation, unknown-role &amp; empty-audience refusal with
/// zero events, reassign, act-time completion authorization, and fail-loud append.
/// </summary>
[TestFixture]
public class TaskAssignmentServiceTests
{
    [Test]
    public async Task AssignAsync_validates_audience_and_emits_TASK_ASSIGNED_SUCCESS_with_metadata_and_tags()
    {
        var tenantId = Guid.NewGuid();
        var userA = Guid.NewGuid();
        var docId = Guid.NewGuid();
        var task = new TaskRef(tenantId, userA, "acme/api", "TAM-12", DocumentId: docId, RequiredPermission: "workflows:manage");

        var resolver = new Mock<ITaskAudienceResolver>();
        resolver.Setup(r => r.EligibleAudienceAsync(task, "admin"))
            .ReturnsAsync([new AudienceMember(userA, "admin", "initiator", "admin")]);

        DomainEvent? captured = null;
        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(d => captured = d)
            .ReturnsAsync((DomainEvent d) => d);

        var svc = new TaskAssignmentService(resolver.Object, events.Object);
        var result = await svc.AssignAsync(tenantId, task, "admin", TaskEvents.BasisInitiator, "autonomy:level=50");

        result.IsAccepted.Should().BeTrue();
        result.Audience.Should().ContainSingle().Which.UserId.Should().Be(userA);
        captured.Should().NotBeNull();
        captured!.Type.Should().Be(TaskEvents.Assigned);

        using var tags = JsonDocument.Parse(captured.Tags);
        tags.RootElement.GetProperty("issueId").GetString().Should().Be("TAM-12");
        tags.RootElement.GetProperty("documentId").GetString().Should().Be(docId.ToString());
        tags.RootElement.GetProperty("tenantId").GetString().Should().Be(tenantId.ToString());

        using var data = JsonDocument.Parse(captured.Data);
        data.RootElement.GetProperty("roleWire").GetString().Should().Be("admin");
        data.RootElement.GetProperty("basis").GetString().Should().Be(TaskEvents.BasisInitiator);
        data.RootElement.GetProperty("autonomyContextRef").GetString().Should().Be("autonomy:level=50");
    }

    [Test]
    public async Task AssignAsync_refuses_unknown_role_or_empty_audience_and_emits_zero_events()
    {
        var tenantId = Guid.NewGuid();
        var task = new TaskRef(tenantId, null, "acme/secret", "TAM-99");

        var resolver = new Mock<ITaskAudienceResolver>();
        resolver.Setup(r => r.EligibleAudienceAsync(task, "owner"))
            .ReturnsAsync(Array.Empty<AudienceMember>());

        var events = new Mock<IEventRepository>(MockBehavior.Strict);
        var svc = new TaskAssignmentService(resolver.Object, events.Object);

        var unknownRole = await svc.AssignAsync(tenantId, task, "not-a-role", TaskEvents.BasisRepoAccess, null);
        unknownRole.Outcome.Should().Be(AssignmentOutcome.RefusedUnknownRole);

        var emptyAudience = await svc.AssignAsync(tenantId, task, "owner", TaskEvents.BasisRepoAccess, null);
        emptyAudience.Outcome.Should().Be(AssignmentOutcome.RefusedEmptyAudience);

        events.Verify(e => e.AppendAsync(It.IsAny<DomainEvent>()), Times.Never);
    }

    [Test]
    public async Task ReassignAsync_emits_previous_and_new_role()
    {
        var tenantId = Guid.NewGuid();
        var owner = Guid.NewGuid();
        var task = new TaskRef(tenantId, null, "acme/api", "TAM-15");

        var resolver = new Mock<ITaskAudienceResolver>();
        resolver.Setup(r => r.EligibleAudienceAsync(task, "owner"))
            .ReturnsAsync([new AudienceMember(owner, "owner", "repo-access", "admin")]);

        DomainEvent? captured = null;
        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(d => captured = d)
            .ReturnsAsync((DomainEvent d) => d);

        var svc = new TaskAssignmentService(resolver.Object, events.Object);
        var res = await svc.ReassignAsync(tenantId, task, "admin", "owner", TaskEvents.BasisRepoAccess, "autonomy:escalated");

        res.IsAccepted.Should().BeTrue();
        captured!.Type.Should().Be(TaskEvents.Reassigned);
        using var data = JsonDocument.Parse(captured.Data);
        data.RootElement.GetProperty("previousRoleWire").GetString().Should().Be("admin");
        data.RootElement.GetProperty("roleWire").GetString().Should().Be("owner");
    }

    [Test]
    public async Task CompleteAsync_refuses_ineligible_caller_and_emits_TASK_COMPLETED_SUCCESS_for_eligible_caller()
    {
        var tenantId = Guid.NewGuid();
        var allowedUser = Guid.NewGuid();
        var deniedUser = Guid.NewGuid();
        var task = new TaskRef(tenantId, allowedUser, "acme/api", "TAM-20");

        var resolver = new Mock<ITaskAudienceResolver>();
        resolver.Setup(r => r.CanSeeAsync(allowedUser, task)).ReturnsAsync(true);
        resolver.Setup(r => r.CanSeeAsync(deniedUser, task)).ReturnsAsync(false);

        DomainEvent? captured = null;
        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(d => captured = d)
            .ReturnsAsync((DomainEvent d) => d);

        var svc = new TaskAssignmentService(resolver.Object, events.Object);

        var denied = await svc.CompleteAsync(tenantId, task, deniedUser, TaskEvents.SurfaceChat);
        denied.Outcome.Should().Be(TaskCompletionOutcome.RefusedNotEligible);
        events.Verify(e => e.AppendAsync(It.IsAny<DomainEvent>()), Times.Never);

        var ok = await svc.CompleteAsync(tenantId, task, allowedUser, TaskEvents.SurfaceTaskView);
        ok.IsCompleted.Should().BeTrue();
        captured!.Type.Should().Be(TaskEvents.Completed);
        using var data = JsonDocument.Parse(captured.Data);
        data.RootElement.GetProperty("completedByUserId").GetString().Should().Be(allowedUser.ToString());
        data.RootElement.GetProperty("surface").GetString().Should().Be(TaskEvents.SurfaceTaskView);
        using var tags = JsonDocument.Parse(captured.Tags);
        tags.RootElement.GetProperty("userId").GetString().Should().Be(allowedUser.ToString());
    }

    [Test]
    public async Task Append_failure_propagates_fail_loud()
    {
        var tenantId = Guid.NewGuid();
        var user = Guid.NewGuid();
        var task = new TaskRef(tenantId, user, "acme/api", "TAM-30");

        var resolver = new Mock<ITaskAudienceResolver>();
        resolver.Setup(r => r.EligibleAudienceAsync(task, "member"))
            .ReturnsAsync([new AudienceMember(user, "member", "initiator", "contribute")]);

        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ThrowsAsync(new InvalidOperationException("DCB store offline"));

        var svc = new TaskAssignmentService(resolver.Object, events.Object);

        var act = () => svc.AssignAsync(tenantId, task, "member", TaskEvents.BasisInitiator, null);
        await act.Should().ThrowAsync<InvalidOperationException>().WithMessage("*DCB store offline*");
    }
}
