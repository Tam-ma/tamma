using FluentAssertions;
using NUnit.Framework;
using Tamma.Api.Auth;
using Tamma.Api.Services.Access;

namespace Tamma.Api.Tests.Access;

/// <summary>
/// Story 39-20 (AC6 / D3 / D4) — closed access-level ranks and the pure
/// <see cref="EffectiveAccess.Compute"/> composition truth table.
/// </summary>
[TestFixture]
public class RepoAccessLevelsAndEffectiveAccessTests
{
    [Test]
    public void RepoAccessLevels_ranks_and_IsAtLeast_are_strictly_ordered()
    {
        RepoAccessLevels.IsValid("read").Should().BeTrue();
        RepoAccessLevels.IsValid("contribute").Should().BeTrue();
        RepoAccessLevels.IsValid("admin").Should().BeTrue();
        RepoAccessLevels.IsValid("write").Should().BeFalse();
        RepoAccessLevels.IsValid(null).Should().BeFalse();

        RepoAccessLevels.Rank(RepoAccessLevels.Admin).Should().BeGreaterThan(RepoAccessLevels.Rank(RepoAccessLevels.Contribute));
        RepoAccessLevels.Rank(RepoAccessLevels.Contribute).Should().BeGreaterThan(RepoAccessLevels.Rank(RepoAccessLevels.Read));
        RepoAccessLevels.Rank(RepoAccessLevels.Read).Should().BeGreaterThan(RepoAccessLevels.Rank(null));

        RepoAccessLevels.IsAtLeast("admin", "contribute").Should().BeTrue();
        RepoAccessLevels.IsAtLeast("contribute", "contribute").Should().BeTrue();
        RepoAccessLevels.IsAtLeast("read", "contribute").Should().BeFalse();
        RepoAccessLevels.IsAtLeast(null, "read").Should().BeFalse();
    }

    [TestCase("owner", "restricted", null, "admin")]
    [TestCase("admin", "restricted", null, "admin")]
    [TestCase("owner", "tenant", null, "admin")]
    [TestCase("member", "tenant", null, "contribute")]
    [TestCase("member", "restricted", null, null)]
    [TestCase("member", "restricted", "read", "read")]
    [TestCase("member", "restricted", "contribute", "contribute")]
    [TestCase("member", "restricted", "admin", "admin")]
    [TestCase("member", "tenant", "read", "contribute")]
    [TestCase("member", "tenant", "admin", "admin")]
    [TestCase(null, "tenant", "admin", null)]
    [TestCase("unknown", "tenant", "admin", null)]
    public void EffectiveAccess_follows_D4_composition_truth_table(
        string? tenantRole,
        string repoVisibility,
        string? singleGrant,
        string? expected)
    {
        var grants = singleGrant is null ? null : new[] { singleGrant };
        EffectiveAccess.Compute(tenantRole, repoVisibility, grants).Should().Be(expected);
    }

    [Test]
    public void Direct_and_team_grants_combine_by_max_and_never_reduce_access()
    {
        EffectiveAccess.Compute("member", "restricted", ["read", "contribute", "read"])
            .Should().Be("contribute");
        EffectiveAccess.Compute("member", "restricted", ["read", "admin"])
            .Should().Be("admin");
    }

    [Test]
    public void Permissions_matrix_includes_Story_39_20_keys_for_admin_and_owner_only()
    {
        foreach (var key in new[] { "teams:manage", "repos:manage", "tasks:assign" })
        {
            Permissions.HasPermission("member", key).Should().BeFalse($"{key} must reject member");
            Permissions.HasPermission("admin", key).Should().BeTrue($"{key} must admit admin");
            Permissions.HasPermission("owner", key).Should().BeTrue($"{key} must admit owner");
        }
    }
}
