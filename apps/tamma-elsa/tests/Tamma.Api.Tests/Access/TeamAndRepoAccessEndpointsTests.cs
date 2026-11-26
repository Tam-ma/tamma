using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Authorization;
using Tamma.Api.Dtos.Access;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.Access;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Access;

/// <summary>
/// Story 39-20 (AC1 / AC2 / AC6 / D4 / D9) — handler tests for
/// <see cref="TeamEndpoints"/> and <see cref="RepoAccessEndpoints"/> proving
/// RBAC 403 parity for members, admin/owner writes, maintainer own-team member
/// management (without repo-grant bypass), validation 400s, event emission, and
/// scope-cache invalidation.
/// </summary>
[TestFixture]
public class TeamAndRepoAccessEndpointsTests
{
    private static ClaimsPrincipal MakePrincipal(Guid userId) => new(
        new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "test"));

    private static DefaultHttpContext MakeHttp(string tenantRole)
    {
        var ctx = new DefaultHttpContext();
        ctx.Items[RequireTenantMembershipFilter.TenantRoleItemKey] = tenantRole;
        return ctx;
    }

    [Test]
    public async Task Member_receives_403_on_team_and_repo_admin_writes()
    {
        var tenantId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var repoId = Guid.NewGuid();
        var cache = new UserRepoScopeCache(TimeProvider.System);
        var events = new Mock<IEventRepository>();
        var teamSvc = new TeamService(Mock.Of<ITeamRepository>(), cache, events.Object, NullLogger<TeamService>.Instance);
        var repoSvc = new RepoAccessService(Mock.Of<IRepoAccessRepository>(), cache, events.Object, NullLogger<RepoAccessService>.Instance);

        var createTeam = await TeamEndpoints.CreateTeam(
            tenantId, new CreateTeamRequest("Backend"), teamSvc, MakePrincipal(userId), MakeHttp("member"), default);
        createTeam.Should().BeAssignableTo<IStatusCodeHttpResult>()
            .Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);

        var vis = await RepoAccessEndpoints.UpdateVisibility(
            tenantId, repoId, new UpdateRepoVisibilityRequest("restricted"), repoSvc, MakePrincipal(userId), MakeHttp("member"), default);
        vis.Should().BeAssignableTo<IStatusCodeHttpResult>()
            .Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);

        var grant = await RepoAccessEndpoints.UpsertGrant(
            tenantId, repoId, new UpsertRepoGrantRequest(userId, null, "contribute"), repoSvc, MakePrincipal(userId), MakeHttp("member"), default);
        grant.Should().BeAssignableTo<IStatusCodeHttpResult>()
            .Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
    }

    [Test]
    public async Task Maintainer_can_mutate_own_team_members_but_cannot_mutate_repo_grants()
    {
        var tenantId = Guid.NewGuid();
        var teamId = Guid.NewGuid();
        var maintainerId = Guid.NewGuid();
        var newMemberId = Guid.NewGuid();
        var repoId = Guid.NewGuid();

        var teamRepo = new Mock<ITeamRepository>();
        teamRepo.Setup(r => r.GetByIdAsync(tenantId, teamId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Team { Id = teamId, TenantId = tenantId, Name = "Core", DefaultMemberRole = "member" });
        teamRepo.Setup(r => r.GetMemberRoleAsync(teamId, maintainerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(TeamMemberRoles.Maintainer);
        teamRepo.Setup(r => r.AddMemberAsync(teamId, newMemberId, "member", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TeamMember { Id = Guid.NewGuid(), TeamId = teamId, UserId = newMemberId, Role = "member" });

        var cache = new UserRepoScopeCache(TimeProvider.System);
        cache.Set(new UserRepoScope(tenantId, newMemberId, "member",
            new Dictionary<Guid, string>(), new Dictionary<string, Guid>(), new Dictionary<Guid, string>()));

        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ReturnsAsync((DomainEvent d) => d);

        var teamSvc = new TeamService(teamRepo.Object, cache, events.Object, NullLogger<TeamService>.Instance);
        var repoSvc = new RepoAccessService(Mock.Of<IRepoAccessRepository>(), cache, events.Object, NullLogger<RepoAccessService>.Instance);

        var addRes = await TeamEndpoints.AddMember(
            tenantId, teamId, new AddTeamMemberRequest(newMemberId), teamSvc, MakePrincipal(maintainerId), MakeHttp("member"), default);
        addRes.Should().BeAssignableTo<IStatusCodeHttpResult>()
            .Which.StatusCode.Should().Be(StatusCodes.Status200OK);

        cache.TryGet(tenantId, newMemberId).Should().BeNull();
        events.Verify(e => e.AppendAsync(It.Is<DomainEvent>(d => d.Type == AccessEvents.TeamMemberAdded)), Times.Once);

        var grantRes = await RepoAccessEndpoints.UpsertGrant(
            tenantId, repoId, new UpsertRepoGrantRequest(null, teamId, "admin"), repoSvc, MakePrincipal(maintainerId), MakeHttp("member"), default);
        grantRes.Should().BeAssignableTo<IStatusCodeHttpResult>()
            .Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
    }

    [Test]
    public async Task Admin_grant_and_visibility_writes_validate_vocabularies_emit_events_and_invalidate_cache()
    {
        var tenantId = Guid.NewGuid();
        var adminId = Guid.NewGuid();
        var repoId = Guid.NewGuid();
        var granteeId = Guid.NewGuid();

        var repoMock = new Mock<IRepoAccessRepository>();
        repoMock.Setup(r => r.GetRepoByIdAsync(tenantId, repoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RegisteredRepo { Id = repoId, TenantId = tenantId, RepoFullName = "acme/api", Visibility = "tenant" });
        repoMock.Setup(r => r.UpdateVisibilityAsync(tenantId, repoId, "restricted", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RegisteredRepo { Id = repoId, TenantId = tenantId, RepoFullName = "acme/api", Visibility = "restricted" });
        repoMock.Setup(r => r.UpsertGrantAsync(repoId, granteeId, null, "contribute", adminId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RepoAccessGrant { Id = Guid.NewGuid(), RepositoryId = repoId, UserId = granteeId, AccessLevel = "contribute" });

        var cache = new UserRepoScopeCache(TimeProvider.System);
        cache.Set(new UserRepoScope(tenantId, granteeId, "member",
            new Dictionary<Guid, string>(), new Dictionary<string, Guid>(), new Dictionary<Guid, string>()));

        var events = new Mock<IEventRepository>();
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ReturnsAsync((DomainEvent d) => d);

        var svc = new RepoAccessService(repoMock.Object, cache, events.Object, NullLogger<RepoAccessService>.Instance);

        var badVis = await RepoAccessEndpoints.UpdateVisibility(
            tenantId, repoId, new UpdateRepoVisibilityRequest("public"), svc, MakePrincipal(adminId), MakeHttp("admin"), default);
        badVis.Should().BeAssignableTo<IStatusCodeHttpResult>()
            .Which.StatusCode.Should().Be(StatusCodes.Status400BadRequest);

        var badGrantLevel = await RepoAccessEndpoints.UpsertGrant(
            tenantId, repoId, new UpsertRepoGrantRequest(granteeId, null, "superuser"), svc, MakePrincipal(adminId), MakeHttp("admin"), default);
        badGrantLevel.Should().BeAssignableTo<IStatusCodeHttpResult>()
            .Which.StatusCode.Should().Be(StatusCodes.Status400BadRequest);

        var okVis = await RepoAccessEndpoints.UpdateVisibility(
            tenantId, repoId, new UpdateRepoVisibilityRequest("restricted"), svc, MakePrincipal(adminId), MakeHttp("admin"), default);
        okVis.Should().BeAssignableTo<IStatusCodeHttpResult>()
            .Which.StatusCode.Should().Be(StatusCodes.Status200OK);

        var okGrant = await RepoAccessEndpoints.UpsertGrant(
            tenantId, repoId, new UpsertRepoGrantRequest(granteeId, null, "contribute"), svc, MakePrincipal(adminId), MakeHttp("admin"), default);
        okGrant.Should().BeAssignableTo<IStatusCodeHttpResult>()
            .Which.StatusCode.Should().Be(StatusCodes.Status200OK);

        cache.TryGet(tenantId, granteeId).Should().BeNull();
        events.Verify(e => e.AppendAsync(It.Is<DomainEvent>(d => d.Type == AccessEvents.RepoVisibilityChanged)), Times.Once);
        events.Verify(e => e.AppendAsync(It.Is<DomainEvent>(d => d.Type == AccessEvents.RepoGrantUpserted)), Times.Once);
    }
}
