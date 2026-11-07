using System.Text.Json;
using Elsa.Workflows;
using Elsa.Workflows.Helpers;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.AI;

namespace Tamma.Activities.Tests.Workflows;

/// <summary>
/// The JSON workflows in <c>apps/tamma-elsa/workflows/</c> are imported at startup by
/// <c>WorkflowSeeder</c> and name activities by Elsa type-name strings
/// (e.g. <c>"Tamma.Mentorship.CodeReviewActivity"</c>). The compiler never sees those
/// strings, so deleting or renaming an activity class leaves the JSON pointing at
/// nothing — Elsa then imports a placeholder for that node instead of failing loudly.
///
/// <para>This sweep resolves every <c>Tamma.*</c> type name in those files against the
/// activity classes actually compiled into <c>Tamma.Activities</c>, using Elsa's own
/// type-name rule. Known breaks sit in a shrink-only allowlist: a NEW unresolved name
/// fails, and an allowlisted name that resolves again (or disappears from the JSON)
/// also fails until its entry is deleted.</para>
/// </summary>
[TestFixture]
public class JsonWorkflowActivityTypesTests
{
    /// <summary>Unresolved type names already in the JSON, with why they are not fixed here.</summary>
    private static readonly IReadOnlyDictionary<string, string> KnownMissing = new Dictionary<string, string>
    {
        ["Tamma.AI.ContextGatheringActivity"] =
            "autonomous-mentorship.json node 'gather-initial-context'. The class was deleted as orphaned in " +
            "commit ca9a9b2a, but this live workflow (started by POST /api/Mentorship/start) still uses it and " +
            "feeds its result into SuggestionGenerator's codeContext. Fixing it (drop the node, or restore the " +
            "activity) is a product decision — see the coverage PR's dead-code report.",
    };

    [Test]
    public void EveryTammaActivityTypeInTheJsonWorkflows_ResolvesToACompiledActivity()
    {
        var compiled = CompiledActivityTypeNames();
        var used = UsedTammaTypeNames();

        var missing = used.Keys.Where(t => !compiled.Contains(t)).ToHashSet();

        missing.Except(KnownMissing.Keys).Should().BeEmpty(
            "every JSON workflow node must name an activity that exists. Unresolved (type → files): " +
            string.Join("; ", missing.Except(KnownMissing.Keys).Select(t => $"{t} → {string.Join(", ", used[t])}")));

        KnownMissing.Keys.Except(missing).Should().BeEmpty(
            "an allowlisted name now resolves or is no longer used — delete its KnownMissing entry");
    }

    [Test]
    public void TheSweepIsNotVacuous()
    {
        // Guards the extractor and the type-name rule: if either broke, the sweep above
        // would pass with nothing to check.
        UsedTammaTypeNames().Should().HaveCountGreaterThan(5);
        CompiledActivityTypeNames().Should().Contain("Tamma.AI.ClaudeAnalysisActivity");
        UsedTammaTypeNames().Should().ContainKey("Tamma.AI.ClaudeAnalysisActivity");
    }

    private static HashSet<string> CompiledActivityTypeNames() =>
        typeof(ClaudeAnalysisActivity).Assembly.GetTypes()
            .Where(t => typeof(IActivity).IsAssignableFrom(t) && t is { IsAbstract: false, IsGenericTypeDefinition: false })
            .Select(ActivityTypeNameHelper.GenerateTypeName)
            .ToHashSet();

    /// <summary>Type name → JSON files that use it, for every <c>"type": "Tamma.…"</c>.</summary>
    private static Dictionary<string, SortedSet<string>> UsedTammaTypeNames()
    {
        var used = new Dictionary<string, SortedSet<string>>();
        var files = Directory.GetFiles(Path.Combine(ElsaRoot(), "workflows"), "*.json", SearchOption.AllDirectories);
        files.Should().NotBeEmpty();

        foreach (var file in files)
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            Walk(doc.RootElement, Path.GetFileName(file), used);
        }

        return used;
    }

    private static void Walk(JsonElement e, string file, Dictionary<string, SortedSet<string>> used)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var p in e.EnumerateObject())
                {
                    if (p.Name == "type" && p.Value.ValueKind == JsonValueKind.String
                        && p.Value.GetString() is { } t && t.StartsWith("Tamma.", StringComparison.Ordinal))
                    {
                        if (!used.TryGetValue(t, out var set)) used[t] = set = new SortedSet<string>();
                        set.Add(file);
                    }
                    Walk(p.Value, file, used);
                }
                break;
            case JsonValueKind.Array:
                foreach (var item in e.EnumerateArray()) Walk(item, file, used);
                break;
        }
    }

    private static string ElsaRoot()
    {
        var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Tamma.sln")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("Tamma.sln not found above the test directory");
    }
}
