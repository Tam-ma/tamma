using System.Text.RegularExpressions;
using FluentAssertions;
using NUnit.Framework;

namespace Tamma.Api.Tests.Auth;

/// <summary>
/// Story 43-6 AC3 — a new authorization policy has to be registered in THREE
/// places: the permission matrix (<c>Auth/Permissions.cs</c>), the production
/// <c>AddAuthorization</c> block in <c>Program.cs</c>, and the Development
/// "permissive" policy-name array in <c>Program.cs</c> (used when no JWT secret is
/// configured). The third is the one that gets forgotten (Story 44-2 says so in a
/// comment beside it). A policy missing there is only discovered when someone hits
/// that route on a Development host.
///
/// <para>This pins the second and third places to each other, and pins every
/// <c>RequireAuthorization("…")</c> name in Tamma.Api to a defined policy. It reads
/// the source rather than booting the host because the Development branch is only
/// taken when <c>Jwt:Secret</c> is absent, which the test fixtures always set.</para>
/// </summary>
[TestFixture]
public class DevelopmentPolicyParityTests
{
    // Not an authorization policy: Program.cs also registers a CORS policy by this name.
    private static readonly HashSet<string> NonAuthorizationPolicies = new(StringComparer.Ordinal) { "AllowDashboard" };

    [Test]
    public void Every_production_policy_is_in_the_development_permissive_array()
    {
        var program = ReadProgram();

        var production = Regex.Matches(program, @"options\.AddPolicy\(""(?<n>[A-Za-z]+)""")
            .Select(m => m.Groups["n"].Value)
            .Where(n => !NonAuthorizationPolicies.Contains(n))
            .ToHashSet(StringComparer.Ordinal);
        var development = DevelopmentArray(program);

        production.Should().NotBeEmpty("the production AddAuthorization block must be found");
        development.Should().BeEquivalentTo(production,
            "the Development-permissive array must name exactly the production policies — " +
            "a policy missing from it is the forgotten third RBAC place (Story 43-6 AC3)");
    }

    [Test]
    public void Every_RequireAuthorization_name_is_a_defined_policy()
    {
        var src = SrcRoot();
        var development = DevelopmentArray(ReadProgram());

        var used = Directory.EnumerateFiles(Path.Combine(src, "Tamma.Api"), "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                     && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
            .SelectMany(f => Regex.Matches(File.ReadAllText(f), @"RequireAuthorization\(""(?<n>[A-Za-z]+)""")
                .Select(m => m.Groups["n"].Value))
            .ToHashSet(StringComparer.Ordinal);

        used.Should().NotBeEmpty();
        used.Except(development).Should().BeEmpty(
            "every policy a route requires must be registered (and so present in the Development array)");
    }

    private static HashSet<string> DevelopmentArray(string program)
    {
        // The Development branch registers policies with: foreach (var name in new[] { "A", "B", … })
        var m = Regex.Match(program, @"foreach\s*\(\s*var\s+name\s+in\s+new\[\]\s*\{(?<body>.*?)\}\s*\)", RegexOptions.Singleline);
        m.Success.Should().BeTrue("the Development-permissive policy array must exist in Program.cs");
        return Regex.Matches(m.Groups["body"].Value, @"""(?<n>[A-Za-z]+)""")
            .Select(x => x.Groups["n"].Value)
            .ToHashSet(StringComparer.Ordinal);
    }

    private static string ReadProgram() => File.ReadAllText(Path.Combine(SrcRoot(), "Tamma.Api", "Program.cs"));

    private static string SrcRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var direct = Path.Combine(dir.FullName, "src", "Tamma.Api", "Program.cs");
            if (File.Exists(direct)) return Path.Combine(dir.FullName, "src");
            var nested = Path.Combine(dir.FullName, "apps", "tamma-elsa", "src", "Tamma.Api", "Program.cs");
            if (File.Exists(nested)) return Path.Combine(dir.FullName, "apps", "tamma-elsa", "src");
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("Could not locate apps/tamma-elsa/src from " + AppContext.BaseDirectory);
    }
}
