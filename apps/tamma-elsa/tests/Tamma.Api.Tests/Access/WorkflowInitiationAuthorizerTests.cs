using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Git;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Access;

/// <summary>
/// Story 39-20 (AC4 / D10) — tests for <see cref="WorkflowInitiationAuthorizer"/>:
/// tenant-fence pass-through, restricted/read-only denial emitting
/// <c>REPO.ACCESS_CHECK.DENIED</c>, and contribute/admin allow.
/// </summary>
[TestFixture]
public class WorkflowInitiationAuthorizerTests
{
    [Test]
    public async Task Denies_and_emits_event_when_tenant_fence_rejects()
    {
        var tenantId = Guid.NewGuid();
        var userId = Guid.NewGuid();

        var gitAuth = new Mock<IGitRepoAuthorizer>();
        gitAuth.Setup(g => g.AuthorizeAsync(tenantId, "other/repo", It.IsAny<CancellationToken>()))
            .ReturnsAsync(GitRepoAuthorization.Deny("cross-tenant"));

        var evaluator = new Mock<IRepoAccessEvaluator>(MockBehavior.Strict);
        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ReturnsAsync((DomainEvent d) => d);

        var authorizer = new WorkflowInitiationAuthorizer(
            gitAuth.Object, evaluator.Object, events.Object, NullLogger<WorkflowInitiationAuthorizer>.Instance);

        var res = await authorizer.AuthorizeAsync(userId, tenantId, "other/repo", "single-issue-cycle");

        res.Allowed.Should().BeFalse();
        res.Reason.Should().Contain("cross-tenant");
        events.Verify(e => e.AppendAsync(It.Is<DomainEvent>(d => d.Type == AccessEvents.RepoAccessCheckDenied)), Times.Once);
    }

    [Test]
    public async Task Denies_read_only_and_ungranted_members_but_allows_contribute_and_admin()
    {
        var tenantId = Guid.NewGuid();
        var userId = Guid.NewGuid();

        var gitAuth = new Mock<IGitRepoAuthorizer>();
        gitAuth.Setup(g => g.AuthorizeAsync(tenantId, "acme/secret", It.IsAny<CancellationToken>()))
            .ReturnsAsync(GitRepoAuthorization.Allow());

        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ReturnsAsync((DomainEvent d) => d);

        var evaluator = new Mock<IRepoAccessEvaluator>();
        var authorizer = new WorkflowInitiationAuthorizer(
            gitAuth.Object, evaluator.Object, events.Object, NullLogger<WorkflowInitiationAuthorizer>.Instance);

        evaluator.Setup(e => e.GetEffectiveAccessLevelAsync(userId, tenantId, null, "acme/secret", It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);
        (await authorizer.AuthorizeAsync(userId, tenantId, "acme/secret")).Allowed.Should().BeFalse();

        evaluator.Setup(e => e.GetEffectiveAccessLevelAsync(userId, tenantId, null, "acme/secret", It.IsAny<CancellationToken>()))
            .ReturnsAsync(RepoAccessLevels.Read);
        (await authorizer.AuthorizeAsync(userId, tenantId, "acme/secret")).Allowed.Should().BeFalse();

        events.Verify(e => e.AppendAsync(It.Is<DomainEvent>(d => d.Type == AccessEvents.RepoAccessCheckDenied)), Times.Exactly(2));

        evaluator.Setup(e => e.GetEffectiveAccessLevelAsync(userId, tenantId, null, "acme/secret", It.IsAny<CancellationToken>()))
            .ReturnsAsync(RepoAccessLevels.Contribute);
        (await authorizer.AuthorizeAsync(userId, tenantId, "acme/secret")).Allowed.Should().BeTrue();

        evaluator.Setup(e => e.GetEffectiveAccessLevelAsync(userId, tenantId, null, "acme/secret", It.IsAny<CancellationToken>()))
            .ReturnsAsync(RepoAccessLevels.Admin);
        (await authorizer.AuthorizeAsync(userId, tenantId, "acme/secret")).Allowed.Should().BeTrue();
    }
}
