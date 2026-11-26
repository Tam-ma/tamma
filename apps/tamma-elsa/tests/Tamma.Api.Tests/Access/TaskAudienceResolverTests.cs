using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Access;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Access;

/// <summary>
/// Story 39-20 (AC3 / D2 / D5) — unit tests for <see cref="TaskAudienceResolver"/>
/// covering both predicate directions, team-transitive grants, restricted vs
/// uncatalogued grandfather fallback, cross-tenant fail-closed, ordering, and
/// <see cref="TaskRef.RequiredPermission"/> filtering.
/// </summary>
[TestFixture]
public class TaskAudienceResolverTests
{
    [Test]
    public async Task CanSee_admits_initiator_and_team_transitive_grant_but_hides_restricted_repo_from_ungranted_member()
    {
        var tenantId = Guid.NewGuid();
        var repoId = Guid.NewGuid();
        var initiator = Guid.NewGuid();
        var teamMember = Guid.NewGuid();
        var outsiderMember = Guid.NewGuid();
        var foreignUser = Guid.NewGuid();

        var repo = new RegisteredRepo
        {
            Id = repoId, TenantId = tenantId, RepoFullName = "acme/secret", Visibility = "restricted",
        };

        var repoMock = new Mock<IRepoAccessRepository>();
        repoMock.Setup(r => r.GetUserRepoScopeAsync(tenantId, initiator, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UserRepoScopeSnapshotData([repo], []));
        repoMock.Setup(r => r.GetUserRepoScopeAsync(tenantId, teamMember, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UserRepoScopeSnapshotData([repo], [new RepoGrantEntry(repoId, RepoAccessLevels.Read)]));
        repoMock.Setup(r => r.GetUserRepoScopeAsync(tenantId, outsiderMember, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UserRepoScopeSnapshotData([repo], []));

        var memMock = new Mock<ITenantMembershipRepository>();
        memMock.Setup(m => m.GetRoleAsync(tenantId, initiator)).ReturnsAsync("member");
        memMock.Setup(m => m.GetRoleAsync(tenantId, teamMember)).ReturnsAsync("member");
        memMock.Setup(m => m.GetRoleAsync(tenantId, outsiderMember)).ReturnsAsync("member");
        memMock.Setup(m => m.GetRoleAsync(tenantId, foreignUser)).ReturnsAsync((string?)null);

        var resolver = new TaskAudienceResolver(repoMock.Object, memMock.Object, new UserRepoScopeCache(TimeProvider.System));
        var task = new TaskRef(
            tenantId,
            InitiatorUserId: initiator,
            RepoKey: "acme/secret",
            IssueId: "acme/secret#7",
            RequiredPermission: "workflows:manage"); // CanSee deliberately ignores RequiredPermission (D5)

        (await resolver.CanSeeAsync(initiator, task)).Should().BeTrue("initiator sees their own workflow regardless of repo grant");
        (await resolver.CanSeeAsync(teamMember, task)).Should().BeTrue("team-transitive grant gives visibility");
        (await resolver.CanSeeAsync(outsiderMember, task)).Should().BeFalse("restricted repo hides from ungranted member");
        (await resolver.CanSeeAsync(foreignUser, task)).Should().BeFalse("non-member of tenant is strictly fail-closed");
    }

    [Test]
    public async Task Uncatalogued_repo_falls_back_to_tenant_visible_inside_authorized_tenant_only()
    {
        var tenantId = Guid.NewGuid();
        var member = Guid.NewGuid();
        var stranger = Guid.NewGuid();

        var repoMock = new Mock<IRepoAccessRepository>();
        repoMock.Setup(r => r.GetUserRepoScopeAsync(tenantId, member, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UserRepoScopeSnapshotData([], []));

        var memMock = new Mock<ITenantMembershipRepository>();
        memMock.Setup(m => m.GetRoleAsync(tenantId, member)).ReturnsAsync("member");
        memMock.Setup(m => m.GetRoleAsync(tenantId, stranger)).ReturnsAsync((string?)null);

        var resolver = new TaskAudienceResolver(repoMock.Object, memMock.Object, new UserRepoScopeCache(TimeProvider.System));
        var task = new TaskRef(tenantId, InitiatorUserId: null, RepoKey: "gitea-org/uncatalogued", IssueId: "gitea-org/uncatalogued#1");

        (await resolver.CanSeeAsync(member, task)).Should().BeTrue("D2 grandfather fallback inside tenant");
        (await resolver.CanSeeAsync(stranger, task)).Should().BeFalse("cross-tenant stays fail-closed");
    }

    [Test]
    public async Task EligibleAudience_orders_initiator_first_and_filters_by_RequiredPermission()
    {
        var tenantId = Guid.NewGuid();
        var repoId = Guid.NewGuid();
        var initiatorMember = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var grantedAdmin = Guid.Parse("00000000-0000-0000-0000-000000000002");
        var grantedMember = Guid.Parse("00000000-0000-0000-0000-000000000003");
        var ungrantedMember = Guid.Parse("00000000-0000-0000-0000-000000000004");

        var repo = new RegisteredRepo
        {
            Id = repoId, TenantId = tenantId, RepoFullName = "acme/core", Visibility = "restricted",
        };

        var repoMock = new Mock<IRepoAccessRepository>();
        repoMock.Setup(r => r.GetByFullNameAsync(tenantId, "acme/core", It.IsAny<CancellationToken>()))
            .ReturnsAsync(repo);
        repoMock.Setup(r => r.GetRepoAudienceAsync(tenantId, repoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new UserGrantEntry(grantedMember, RepoAccessLevels.Contribute),
            ]);

        var memMock = new Mock<ITenantMembershipRepository>();
        memMock.Setup(m => m.ListAllByTenantAsync(tenantId))
            .ReturnsAsync([
                new TenantMembership { TenantId = tenantId, UserId = ungrantedMember, Role = "member" },
                new TenantMembership { TenantId = tenantId, UserId = grantedMember, Role = "member" },
                new TenantMembership { TenantId = tenantId, UserId = grantedAdmin, Role = "admin" },
                new TenantMembership { TenantId = tenantId, UserId = initiatorMember, Role = "member" },
            ]);

        var resolver = new TaskAudienceResolver(repoMock.Object, memMock.Object, new UserRepoScopeCache(TimeProvider.System));

        // Without RequiredPermission: initiator first, then admin (effective admin), then grantedMember (contribute); ungrantedMember excluded.
        var allMembers = await resolver.EligibleAudienceAsync(
            new TaskRef(tenantId, initiatorMember, "acme/core", "acme/core#9"),
            "member");

        allMembers.Select(m => m.UserId).Should().Equal(initiatorMember, grantedAdmin, grantedMember);
        allMembers[0].Basis.Should().Be(TaskAudienceResolver.BasisInitiator);
        allMembers[1].Basis.Should().Be(TaskAudienceResolver.BasisRepoAccess);
        allMembers[2].Basis.Should().Be(TaskAudienceResolver.BasisRepoAccess);

        // With RequiredPermission = "workflows:manage" (admin+owner): member-role candidates filtered out!
        var managersOnly = await resolver.EligibleAudienceAsync(
            new TaskRef(tenantId, initiatorMember, "acme/core", "acme/core#9", RequiredPermission: "workflows:manage"),
            "member");

        managersOnly.Should().ContainSingle().Which.UserId.Should().Be(grantedAdmin);

        // Unknown role wire -> empty list
        (await resolver.EligibleAudienceAsync(
            new TaskRef(tenantId, initiatorMember, "acme/core", "acme/core#9"),
            "superhero")).Should().BeEmpty();
    }
}
