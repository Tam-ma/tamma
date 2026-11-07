using System.Text.RegularExpressions;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Core.Documents.Policy;

namespace Tamma.Core.Tests.Documents.Policy;

/// <summary>
/// Story 43-1 AC10: <see cref="AutonomyDial"/> is the ONLY place production C#
/// may state a dial bound. This scan is COMPARISON-shaped on purpose — it looks
/// for the syntax of a bound check against an autonomy value, never for bare
/// numbers. A bare-literal scan would be useless: <c>ActionCatalog.Descriptors.cs</c>
/// carries ~150 <c>DefaultMinAutonomy</c> literals that are data, not bounds, so a
/// literal scan would fail permanently or be allowlisted into meaninglessness.
///
/// <para>It is deliberately NOT extended to <c>.ts</c>/<c>.tsx</c>: the dashboard's
/// constants were deleted (the slider binds to <c>GET /api/actions/dial</c>), so
/// there is nothing there to scan, and the TS tests pin the binding instead.</para>
///
/// <para>The allowlist is shrink-only with staleness detection (the
/// <c>ContractBindingTests.KnownContractViolations</c> pattern): an entry may only
/// be removed, and an entry that no longer matches anything fails the build.</para>
/// </summary>
[TestFixture]
public class AutonomyDialSingleSourceTests
{
    // Every number that has ever been, or is, a dial bound: the live constants
    // plus 70, the pre-43-11 floor (a stale `>= 70` check is exactly the bug
    // class this guards against).
    private static readonly int[] BoundValues =
        new[] { AutonomyDial.Min, AutonomyDial.Max, AutonomyDial.AlwaysHuman, 70 }
            .Distinct().ToArray();

    private static readonly string BoundAlternation = string.Join("|", BoundValues);

    // Comparison operators only — a plain `=` is an assignment (e.g. the shipped
    // DefaultAutonomyLevel = 70), which is data, not a bound check.
    private const string Cmp = @"(?:<=|>=|==|!=|<|>)";

    private static readonly Regex[] ComparisonPatterns =
    {
        // AutonomyLevel >= 70, autonomy is < 101, minAutonomy != 100 …
        new($@"Autonomy\w*\s*(is\s+)?(not\s+)?{Cmp}\s*({BoundAlternation})\b", RegexOptions.IgnoreCase),
        // 70 <= autonomyLevel …
        new($@"\b({BoundAlternation})\s*{Cmp}\s*\w*Autonomy", RegexOptions.IgnoreCase),
        // AutonomyLevel is < 70 or > 100 (relational pattern, the original enforcement shape)
        new(@"Autonomy\w*\s+is\s+(not\s+)?\(?\s*[<>]", RegexOptions.IgnoreCase),
    };

    /// <summary>
    /// Shrink-only: "relative/path.cs" → why it is allowed. Empty today.
    /// </summary>
    private static readonly Dictionary<string, string> KnownRestatements = new();

    private const string OwnerFile = "Tamma.Core/Documents/Policy/AutonomyDial.cs";

    [Test]
    public void No_autonomy_comparison_restates_a_bound()
    {
        var offenders = Scan()
            .Where(h => !KnownRestatements.ContainsKey(h.File))
            .Select(h => $"{h.File}:{h.Line}: {h.Text}")
            .ToList();

        offenders.Should().BeEmpty(
            "a dial bound may only be stated in AutonomyDial.cs — use AutonomyDial.IsValidLevel / " +
            "IsValidThreshold / Min / Max instead of comparing an autonomy value to a literal");
    }

    [Test]
    public void Allowlist_has_no_stale_entries()
    {
        var hitFiles = Scan().Select(h => h.File).ToHashSet();
        KnownRestatements.Keys.Where(k => !hitFiles.Contains(k)).Should().BeEmpty(
            "an allowlisted file no longer restates a bound — remove its entry (shrink-only)");
    }

    [Test]
    public void The_scan_actually_detects_the_shapes_it_guards()
    {
        // Guard the guard: if a pattern stops matching its own target shape, the
        // scan silently passes forever.
        var samples = new[]
        {
            "if (AutonomyLevel is < 70 or > 100)",
            "if (rules.AutonomyLevel >= 70)",
            $"return minAutonomy == {AutonomyDial.AlwaysHuman};",
            $"if ({AutonomyDial.Max} < autonomyLevel)",
        };
        foreach (var sample in samples)
            ComparisonPatterns.Any(p => p.IsMatch(sample)).Should().BeTrue($"the scan must catch: {sample}");

        // …and does not fire on catalog DATA (the reason this is not a literal scan).
        ComparisonPatterns.Any(p => p.IsMatch("DefaultMinAutonomy: 70,")).Should().BeFalse();
        ComparisonPatterns.Any(p => p.IsMatch("public const int DefaultAutonomyLevel = 70;")).Should().BeFalse();
        ComparisonPatterns.Any(p => p.IsMatch("AutonomyDial.IsValidLevel(level)")).Should().BeFalse();
    }

    private static IEnumerable<(string File, int Line, string Text)> Scan()
    {
        var root = TammaElsaSrcRoot();
        foreach (var path in Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(root, path).Replace('\\', '/');
            if (rel.Contains("/obj/") || rel.Contains("/bin/") || rel == OwnerFile)
                continue;

            var lines = File.ReadAllLines(path);
            for (var i = 0; i < lines.Length; i++)
            {
                var line = lines[i];
                var trimmed = line.TrimStart();
                if (trimmed.StartsWith("//", StringComparison.Ordinal) || trimmed.StartsWith("*", StringComparison.Ordinal))
                    continue; // prose in comments is the doc pass's job, not this guard's
                if (ComparisonPatterns.Any(p => p.IsMatch(line)))
                    yield return (rel, i + 1, trimmed);
            }
        }
    }

    private static string TammaElsaSrcRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var direct = Path.Combine(dir.FullName, "src", "Tamma.Core");
            if (Directory.Exists(direct))
                return Path.Combine(dir.FullName, "src");

            var nested = Path.Combine(dir.FullName, "apps", "tamma-elsa", "src", "Tamma.Core");
            if (Directory.Exists(nested))
                return Path.Combine(dir.FullName, "apps", "tamma-elsa", "src");

            dir = dir.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate apps/tamma-elsa/src from " + AppContext.BaseDirectory);
    }
}
