using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Access;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Access;

/// <summary>
/// Story 39-20 (AC3 / D6) — verifies <see cref="UserRepoScopeCache"/> hit/miss,
/// TTL expiration via fake <see cref="TimeProvider"/>, tenant invalidation, and
/// single-query caching across repeated <c>CanSeeAsync</c> calls.
/// </summary>
[TestFixture]
public class UserRepoScopeCacheTests
{
    private sealed class FakeTimeProvider(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan delta) => _now = _now.Add(delta);
    }

    [Test]
    public void Cache_hits_expires_after_ttl_and_invalidates_by_tenant()
    {
        var clock = new FakeTimeProvider(new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero));
        var cache = new UserRepoScopeCache(clock, TimeSpan.FromSeconds(30));

        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var user1 = Guid.NewGuid();
        var user2 = Guid.NewGuid();

        var scopeA1 = new UserRepoScope(tenantA, user1, "member",
            new Dictionary<Guid, string>(), new Dictionary<string, Guid>(), new Dictionary<Guid, string>());
        var scopeB2 = new UserRepoScope(tenantB, user2, "admin",
            new Dictionary<Guid, string>(), new Dictionary<string, Guid>(), new Dictionary<Guid, string>());

        cache.TryGet(tenantA, user1).Should().BeNull();
        cache.Set(scopeA1);
        cache.Set(scopeB2);
        cache.TryGet(tenantA, user1).Should().Be(scopeA1);
        cache.Count.Should().Be(2);

        // Tenant invalidation clears only tenantA entries
        cache.InvalidateTenant(tenantA);
        cache.TryGet(tenantA, user1).Should().BeNull();
        cache.TryGet(tenantB, user2).Should().Be(scopeB2);

        // TTL expiration evicts lazily after advancing clock
        clock.Advance(TimeSpan.FromSeconds(31));
        cache.TryGet(tenantB, user2).Should().BeNull();
    }

    [Test]
    public async Task Resolver_consults_repositories_once_across_repeated_CanSeeAsync_calls()
    {
        var tenantId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var repoId = Guid.NewGuid();

        var clock = new FakeTimeProvider(DateTimeOffset.UtcNow);
        var cache = new UserRepoScopeCache(clock, TimeSpan.FromSeconds(60));

        var repoMock = new Mock<IRepoAccessRepository>(MockBehavior.Strict);
        repoMock.Setup(r => r.GetUserRepoScopeAsync(tenantId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UserRepoScopeSnapshotData(
                [new RegisteredRepo { Id = repoId, TenantId = tenantId, RepoFullName = "acme/core", Visibility = "restricted" }],
                [new RepoGrantEntry(repoId, RepoAccessLevels.Contribute)]));

        var membershipMock = new Mock<ITenantMembershipRepository>(MockBehavior.Strict);
        membershipMock.Setup(m => m.GetRoleAsync(tenantId, userId))
            .ReturnsAsync("member");

        var resolver = new TaskAudienceResolver(repoMock.Object, membershipMock.Object, cache);
        var task = new TaskRef(tenantId, InitiatorUserId: null, RepoKey: "acme/core", IssueId: "acme/core#1");

        for (var i = 0; i < 5; i++)
        {
            (await resolver.CanSeeAsync(userId, task)).Should().BeTrue();
        }

        repoMock.Verify(r => r.GetUserRepoScopeAsync(tenantId, userId, It.IsAny<CancellationToken>()), Times.Once);
        membershipMock.Verify(m => m.GetRoleAsync(tenantId, userId), Times.Once);
    }
}
