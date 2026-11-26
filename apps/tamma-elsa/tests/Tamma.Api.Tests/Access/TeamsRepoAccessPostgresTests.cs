using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using NUnit.Framework;
using Tamma.Api.Services.Access;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.Access;

/// <summary>
/// Story 39-20 (AC2 / AC7) — Docker Testcontainers PostgreSQL integration suite
/// proving:
/// <list type="number">
///   <item><b>Migration &amp; constraints (<c>AddTeamsAndRepoAccess</c>):</b>
///     CHECK constraints reject invalid access levels, visibilities, and team
///     roles; grantee XOR rejects both-set and neither-set; unique indexes
///     dedupe; GitHub repo grandfather backfill seeds <c>Visibility='tenant'</c>.</item>
///   <item><b>Two scoping models parity (AC7):</b>
///     SaaS (one tenant, two teams with disjoint restricted repos, one workflow
///     initiated by Team A member on Team B's repo) AND Single-user (sole owner,
///     zero teams, personal tenant) evaluated through the exact same
///     <see cref="TaskAudienceResolver"/> with zero mode branching.</item>
/// </list>
/// </summary>
[TestFixture]
[Category("Integration")]
public class TeamsRepoAccessPostgresTests
{
    private PostgreSqlContainer _postgres = null!;
    private DbContextOptions<ControlPlaneDbContext> _options = null!;

    [OneTimeSetUp]
    public async Task OneTimeSetUp()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:16-alpine")
            .WithDatabase("tamma_cp_access_test")
            .WithUsername("postgres")
            .WithPassword("postgres")
            .Build();
        await _postgres.StartAsync();

        var builder = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseNpgsql(_postgres.GetConnectionString(), npgsql =>
                npgsql.MigrationsHistoryTable("__ControlPlaneMigrationsHistory"));
        ControlPlaneDbContext.ConfigureControlPlaneWarnings(builder);
        _options = builder.Options;

        await using var db = new ControlPlaneDbContext(_options);
        await db.Database.MigrateAsync();
    }

    [OneTimeTearDown]
    public async Task OneTimeTearDown()
    {
        await _postgres.DisposeAsync();
    }

    private ControlPlaneDbContext NewDb() => new(_options);

    [Test]
    public async Task Migration_enforces_checks_xor_uniques_and_backfills_github_repos_as_tenant_visible()
    {
        // 1. Seed a tenant, user, github_installation + github_installation_repo and re-run backfill SQL
        var tenantId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var installId = Guid.NewGuid();

        await using (var db = NewDb())
        {
            db.Tenants.Add(new Tenant { Id = tenantId, Name = "Acme", Slug = $"acme-{tenantId:N}"[..24], Type = "org" });
            db.Users.Add(new User { Id = userId, GitHubId = Random.Shared.NextInt64(100_000, 999_999_999), DisplayName = $"u-{userId:N}"[..20], Email = $"{userId:N}@test.local", Role = "member" });
            db.GitHubInstallations.Add(new GitHubInstallation
            {
                Id = installId, InstallationId = Random.Shared.NextInt64(100_000, 999_999_999),
                AccountLogin = "acme", AccountType = "Organization", TenantId = tenantId,
            });
            db.GitHubInstallationRepos.Add(new GitHubInstallationRepo
            {
                Id = Guid.NewGuid(), InstallationEntityId = installId, RepoId = 777001,
                Owner = "acme", Name = "legacy-app", RepoFullName = "acme/legacy-app", IsActive = true,
            });
            await db.SaveChangesAsync();

            // Run the exact idempotent backfill SQL from AddTeamsAndRepoAccess.Up()
            await db.Database.ExecuteSqlRawAsync(@"
INSERT INTO repositories (""Id"", ""TenantId"", ""PlatformKind"", ""RepoFullName"", ""ExternalId"", ""Visibility"", ""CreatedAt"", ""UpdatedAt"")
SELECT gen_random_uuid(), i.""TenantId"", 'github', r.""RepoFullName"", r.""RepoId""::text, 'tenant', now(), now()
FROM github_installation_repos r
INNER JOIN github_installations i ON i.""Id"" = r.""InstallationEntityId""
WHERE i.""TenantId"" IS NOT NULL AND r.""IsActive"" = true
ON CONFLICT (""TenantId"", ""PlatformKind"", ""RepoFullName"") DO NOTHING;");
        }

        Guid repoId;
        await using (var db = NewDb())
        {
            var backfilled = await db.RegisteredRepos.SingleAsync(r => r.TenantId == tenantId && r.RepoFullName == "acme/legacy-app");
            backfilled.Visibility.Should().Be("tenant", "AC2 grandfather clause seeds existing repos as tenant-visible");
            backfilled.PlatformKind.Should().Be("github");
            backfilled.ExternalId.Should().Be("777001");
            repoId = backfilled.Id;
        }

        // 2. CHECK constraint rejects bad visibility
        await using (var db = NewDb())
        {
            db.RegisteredRepos.Add(new RegisteredRepo
            {
                Id = Guid.NewGuid(), TenantId = tenantId, PlatformKind = "github",
                RepoFullName = "acme/bad-vis", Visibility = "public",
            });
            var act = () => db.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateException>();
        }

        // 3. CHECK constraint rejects bad access level
        await using (var db = NewDb())
        {
            db.RepoAccessGrants.Add(new RepoAccessGrant
            {
                Id = Guid.NewGuid(), RepositoryId = repoId, UserId = userId, AccessLevel = "root",
            });
            var act = () => db.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateException>();
        }

        // 4. Grantee XOR CHECK rejects neither set AND both set
        await using (var db = NewDb())
        {
            db.RepoAccessGrants.Add(new RepoAccessGrant
            {
                Id = Guid.NewGuid(), RepositoryId = repoId, UserId = null, TeamId = null, AccessLevel = "read",
            });
            var act = () => db.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateException>();
        }

        Guid teamId;
        await using (var db = NewDb())
        {
            var team = new Team { Id = Guid.NewGuid(), TenantId = tenantId, Name = "Alpha", DefaultMemberRole = "member" };
            db.Teams.Add(team);
            await db.SaveChangesAsync();
            teamId = team.Id;
        }

        await using (var db = NewDb())
        {
            db.RepoAccessGrants.Add(new RepoAccessGrant
            {
                Id = Guid.NewGuid(), RepositoryId = repoId, UserId = userId, TeamId = teamId, AccessLevel = "read",
            });
            var act = () => db.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateException>();
        }

        // 5. Unique NULLS NOT DISTINCT rejects duplicate user grant on same repo
        await using (var db = NewDb())
        {
            db.RepoAccessGrants.Add(new RepoAccessGrant
            {
                Id = Guid.NewGuid(), RepositoryId = repoId, UserId = userId, TeamId = null, AccessLevel = "read",
            });
            await db.SaveChangesAsync();
        }
        await using (var db = NewDb())
        {
            db.RepoAccessGrants.Add(new RepoAccessGrant
            {
                Id = Guid.NewGuid(), RepositoryId = repoId, UserId = userId, TeamId = null, AccessLevel = "admin",
            });
            var act = () => db.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateException>();
        }
    }

    [Test]
    public async Task SaaS_two_teams_disjoint_restricted_repos_and_SingleUser_sole_owner_share_same_resolver()
    {
        // ── SaaS scenario: 1 tenant, 2 teams (A & B), disjoint restricted repos,
        //    shared workflow initiated by Team A member (alice) on Team B's repo.
        var saasTenant = Guid.NewGuid();
        var alice = Guid.NewGuid();    // Team A member + workflow initiator on repo B
        var bob = Guid.NewGuid();      // Team A member (NOT initiator, NO grant on repo B)
        var charlie = Guid.NewGuid();  // Team B member (team grant on repo B)
        var owner = Guid.NewGuid();    // Tenant owner (admin everywhere)

        // ── Single-user scenario: personal tenant, sole owner, zero teams, tenant-visible repo.
        var personalTenant = Guid.NewGuid();
        var soleOwner = Guid.NewGuid();

        Guid repoAId, repoBId, personalRepoId;

        await using (var db = NewDb())
        {
            db.Tenants.AddRange(
                new Tenant { Id = saasTenant, Name = "SaaS Org", Slug = $"saas-{saasTenant:N}"[..24], Type = "org" },
                new Tenant { Id = personalTenant, Name = "Personal", Slug = $"solo-{personalTenant:N}"[..24], Type = "personal" });

            foreach (var (uid, name) in new[]
            {
                (alice, "alice"), (bob, "bob"), (charlie, "charlie"), (owner, "owner"), (soleOwner, "solo"),
            })
            {
                db.Users.Add(new User
                {
                    Id = uid,
                    GitHubId = Random.Shared.NextInt64(100_000, 999_999_999),
                    DisplayName = $"{name}-{uid:N}"[..20],
                    Email = $"{name}-{uid:N}@test.local",
                    Role = "member",
                });
            }

            db.TenantMemberships.AddRange(
                new TenantMembership { Id = Guid.NewGuid(), TenantId = saasTenant, UserId = alice, Role = "member" },
                new TenantMembership { Id = Guid.NewGuid(), TenantId = saasTenant, UserId = bob, Role = "member" },
                new TenantMembership { Id = Guid.NewGuid(), TenantId = saasTenant, UserId = charlie, Role = "member" },
                new TenantMembership { Id = Guid.NewGuid(), TenantId = saasTenant, UserId = owner, Role = "owner" },
                new TenantMembership { Id = Guid.NewGuid(), TenantId = personalTenant, UserId = soleOwner, Role = "owner" });

            var teamA = new Team { Id = Guid.NewGuid(), TenantId = saasTenant, Name = "Team A" };
            var teamB = new Team { Id = Guid.NewGuid(), TenantId = saasTenant, Name = "Team B" };
            db.Teams.AddRange(teamA, teamB);

            db.TeamMembers.AddRange(
                new TeamMember { Id = Guid.NewGuid(), TeamId = teamA.Id, UserId = alice, Role = "maintainer" },
                new TeamMember { Id = Guid.NewGuid(), TeamId = teamA.Id, UserId = bob, Role = "member" },
                new TeamMember { Id = Guid.NewGuid(), TeamId = teamB.Id, UserId = charlie, Role = "member" });

            var repoA = new RegisteredRepo { Id = Guid.NewGuid(), TenantId = saasTenant, PlatformKind = "github", RepoFullName = "saas/repo-a", Visibility = "restricted" };
            var repoB = new RegisteredRepo { Id = Guid.NewGuid(), TenantId = saasTenant, PlatformKind = "github", RepoFullName = "saas/repo-b", Visibility = "restricted" };
            var personalRepo = new RegisteredRepo { Id = Guid.NewGuid(), TenantId = personalTenant, PlatformKind = "github", RepoFullName = "solo/my-app", Visibility = "tenant" };
            db.RegisteredRepos.AddRange(repoA, repoB, personalRepo);

            db.RepoAccessGrants.AddRange(
                new RepoAccessGrant { Id = Guid.NewGuid(), RepositoryId = repoA.Id, TeamId = teamA.Id, AccessLevel = "contribute" },
                new RepoAccessGrant { Id = Guid.NewGuid(), RepositoryId = repoB.Id, TeamId = teamB.Id, AccessLevel = "contribute" });

            await db.SaveChangesAsync();
            repoAId = repoA.Id;
            repoBId = repoB.Id;
            personalRepoId = personalRepo.Id;
        }

        await using var queryDb = NewDb();
        var resolver = new TaskAudienceResolver(
            new RepoAccessRepository(queryDb),
            new TenantMembershipRepository(queryDb),
            new UserRepoScopeCache(TimeProvider.System));

        // ── Assert SaaS visibility & audience for Alice's task on Team B's restricted repo
        var taskOnRepoB = new TaskRef(saasTenant, InitiatorUserId: alice, RepoKey: "saas/repo-b", IssueId: "saas/repo-b#42", RepositoryId: repoBId);

        (await resolver.CanSeeAsync(alice, taskOnRepoB)).Should().BeTrue("initiator sees their workflow even on Team B's repo");
        (await resolver.CanSeeAsync(charlie, taskOnRepoB)).Should().BeTrue("Team B member sees repo B via team grant");
        (await resolver.CanSeeAsync(owner, taskOnRepoB)).Should().BeTrue("tenant owner sees all tenant repos");
        (await resolver.CanSeeAsync(bob, taskOnRepoB)).Should().BeFalse("Team A non-initiator sees nothing on Team B's restricted repo");
        (await resolver.CanSeeAsync(soleOwner, taskOnRepoB)).Should().BeFalse("foreign tenant user sees nothing");

        var audienceB = await resolver.EligibleAudienceAsync(taskOnRepoB, "member");
        audienceB.Select(m => m.UserId).Should().Equal(alice, owner, charlie);
        audienceB[0].Basis.Should().Be(TaskAudienceResolver.BasisInitiator);
        audienceB[1].Basis.Should().Be(TaskAudienceResolver.BasisRepoAccess);
        audienceB[2].Basis.Should().Be(TaskAudienceResolver.BasisRepoAccess);

        // ── Assert SaaS visibility on Repo A (Team A only + owner)
        var taskOnRepoA = new TaskRef(saasTenant, InitiatorUserId: null, RepoKey: "saas/repo-a", IssueId: "saas/repo-a#1", RepositoryId: repoAId);
        (await resolver.CanSeeAsync(alice, taskOnRepoA)).Should().BeTrue();
        (await resolver.CanSeeAsync(bob, taskOnRepoA)).Should().BeTrue();
        (await resolver.CanSeeAsync(charlie, taskOnRepoA)).Should().BeFalse();

        // ── Assert Single-user mode through the IDENTICAL resolver (zero teams, zero mode branch)
        var soloTask = new TaskRef(personalTenant, InitiatorUserId: null, RepoKey: "solo/my-app", IssueId: "solo/my-app#1", RepositoryId: personalRepoId);
        (await resolver.CanSeeAsync(soleOwner, soloTask)).Should().BeTrue();
        var soloAudience = await resolver.EligibleAudienceAsync(soloTask, "owner");
        soloAudience.Should().ContainSingle().Which.UserId.Should().Be(soleOwner);
    }
}
