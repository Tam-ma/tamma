using System.Text;
using System.Text.RegularExpressions;
using FluentAssertions;
using NUnit.Framework;

namespace Tamma.Core.Tests.Events;

/// <summary>
/// Story 44-5 AC8/AC9 (D8/D9) — the repo-wide DCB event-name drift ratchet.
///
/// <para>Scans every <c>public const string</c> containing a <c>.</c> in every
/// <c>*Events.cs</c> / <c>*EventTypes.cs</c> file across <c>Tamma.Core</c>,
/// <c>Tamma.Activities</c>, <c>Tamma.Api</c>, and <c>Tamma.Platforms*</c>, and
/// asserts the canonical <c>AGGREGATE[.SUB].ACTION.STATUS</c> shape
/// (<c>^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*){2,3}$</c>).</para>
///
/// <para>Existing violators are seeded into <see cref="KnownEventNameViolations"/>
/// (shrink-only, count-pinned, staleness-checked). No Epic 44 family
/// (<c>PROJECT.</c>/<c>WORKITEM.</c>/<c>ITERATION.</c>) may ever be allowlisted.</para>
/// </summary>
[TestFixture]
public partial class EventTypeNamingRatchetTests
{
    private static readonly string[] ScopedProjects =
    [
        "Tamma.Core",
        "Tamma.Activities",
        "Tamma.Api",
        "Tamma.Platforms",
        "Tamma.Platforms.Abstractions",
        "Tamma.Platforms.GitHub",
        "Tamma.Platforms.GitLab",
        "Tamma.Platforms.Gitea",
    ];

    internal sealed record DiscoveredConstant(
        string FilePath, int Line, string ConstantName, string Value);

    [GeneratedRegex(@"^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*){2,3}$", RegexOptions.CultureInvariant)]
    private static partial Regex CanonicalShapeRegex();

    [GeneratedRegex(@"\bpublic\s+const\s+string\s+(\w+)\s*=\s*""([^""]+)""\s*;", RegexOptions.CultureInvariant)]
    private static partial Regex PublicConstStringRegex();

    [Test]
    public void All_event_constants_match_the_shape_or_are_allowlisted()
    {
        var discovered = ScanScopedEventConstants();
        discovered.Should().NotBeEmpty("repo contains ~390 dotted event constants across *Events.cs / *EventTypes.cs");

        var allowlisted = KnownEventNameViolations.All
            .Select(e => (e.FilePath, e.ConstantName, e.Value))
            .ToHashSet();

        var unallowlistedViolations = discovered
            .Where(c => !CanonicalShapeRegex().IsMatch(c.Value))
            .Where(c => !allowlisted.Contains((c.FilePath, c.ConstantName, c.Value)))
            .ToList();

        unallowlistedViolations.Should().BeEmpty(
            "AC8: every new or modified DCB event constant in *Events.cs / *EventTypes.cs must match "
            + "AGGREGATE[.SUB].ACTION.STATUS (^[A-Z][A-Z0-9_]*(\\.[A-Z][A-Z0-9_]*){2,3}$). "
            + "Unallowlisted violations:\n"
            + string.Join("\n", unallowlistedViolations.Select(
                v => $"  {v.FilePath}:{v.Line}  {v.ConstantName} = \"{v.Value}\"")));
    }

    [Test]
    public void Allowlist_is_shrink_only_and_count_pinned()
    {
        KnownEventNameViolations.All.Should().HaveCount(
            KnownEventNameViolations.PinnedCount,
            "AC9 / D9: KnownEventNameViolations is count-pinned; when removing fixed legacy entries, "
            + "decrement PinnedCount in the same commit. Never increase it.");

        foreach (var entry in KnownEventNameViolations.All)
        {
            entry.FilePath.Should().NotBeNullOrWhiteSpace();
            entry.Line.Should().BeGreaterThan(0, "each allowlist entry must record its file:line");
            entry.ConstantName.Should().NotBeNullOrWhiteSpace();
            entry.Value.Should().Contain(".");
        }

        // Duplicate entries would silently inflate the baseline.
        var uniqueKeys = KnownEventNameViolations.All
            .Select(e => (e.FilePath, e.ConstantName, e.Value))
            .ToHashSet();
        uniqueKeys.Should().HaveCount(KnownEventNameViolations.All.Count,
            "KnownEventNameViolations must contain no duplicate entries");
    }

    [Test]
    public void A_stale_allowlist_entry_fails()
    {
        var discovered = ScanScopedEventConstants();

        // 1. Live allowlist must have ZERO stale entries (every entry must still exist
        //    AND still violate the canonical shape).
        var liveStale = FindStaleEntries(KnownEventNameViolations.All, discovered);
        liveStale.Should().BeEmpty(
            "D9: allowlisted entries that now comply or were deleted must be removed from "
            + "KnownEventNameViolations (ratchet shrinks). Stale entries:\n"
            + string.Join("\n", liveStale));

        // 2. Prove the staleness detector itself fails naming the entry when a compliant
        //    constant is placed in the allowlist.
        var syntheticCompliant = new KnownEventNameViolations.Entry(
            "apps/tamma-elsa/src/Tamma.Api/Services/Tracker/WorkItemEvents.cs",
            1,
            "Created",
            "WORKITEM.CREATED.SUCCESS");
        var withStale = KnownEventNameViolations.All.Concat([syntheticCompliant]).ToList();

        var detected = FindStaleEntries(withStale, discovered);
        detected.Should().ContainSingle(msg =>
            msg.Contains("WORKITEM.CREATED.SUCCESS", StringComparison.Ordinal)
            && msg.Contains("WorkItemEvents.cs", StringComparison.Ordinal),
            "D9: a now-compliant allowlist entry must fail loudly naming itself");
    }

    [Test]
    public void No_epic_44_constant_is_allowlisted()
    {
        // AC9 — the self-defeat guard: no PROJECT.*, WORKITEM.*, or ITERATION.* constant
        // may ever appear in KnownEventNameViolations.
        var forbiddenPrefixes = new[] { "PROJECT.", "WORKITEM.", "ITERATION." };

        var offenders = KnownEventNameViolations.All
            .Where(e => forbiddenPrefixes.Any(p => e.Value.StartsWith(p, StringComparison.Ordinal)))
            .ToList();

        offenders.Should().BeEmpty(
            "AC9: Epic 44 event families (PROJECT.*, WORKITEM.*, ITERATION.*) must conform natively "
            + "and may NEVER be added to KnownEventNameViolations");

        // Positive confirmation: all three Epic 44 files are actually scanned and compliant.
        var discovered = ScanScopedEventConstants();
        discovered.Should().Contain(c => c.Value == "PROJECT.CREATED.SUCCESS");
        discovered.Should().Contain(c => c.Value == "WORKITEM.CREATED.SUCCESS");
        discovered.Should().Contain(c => c.Value == "ITERATION.CREATED.SUCCESS");
    }

    [Test]
    public void Sse_bus_strings_are_out_of_scope()
    {
        // D8: lowercase SSE bus strings in TaskQueueProcessor.cs (task.claimed etc.)
        // are NOT DCB event types — excluded by the *Events.cs / *EventTypes.cs
        // filename filter rather than falsely allowlisted.
        var discovered = ScanScopedEventConstants();

        discovered.Should().NotContain(
            c => c.FilePath.EndsWith("TaskQueueProcessor.cs", StringComparison.OrdinalIgnoreCase),
            "D8: TaskQueueProcessor.cs is an SSE bus emitter, not an *Events.cs / *EventTypes.cs catalogue");

        KnownEventNameViolations.All.Should().NotContain(
            e => e.FilePath.EndsWith("TaskQueueProcessor.cs", StringComparison.OrdinalIgnoreCase),
            "D8: SSE bus strings must be excluded by scope filter, never allowlisted");

        // Sanity check that the file actually exists in the repo (so this test cannot
        // pass vacuously if the path were wrong).
        var repoRoot = LocateRepoRoot();
        var taskQueueFile = Path.Combine(
            repoRoot, "apps", "tamma-elsa", "src", "Tamma.Api", "Services", "TaskQueue", "TaskQueueProcessor.cs");
        File.Exists(taskQueueFile).Should().BeTrue(
            "TaskQueueProcessor.cs exists in the repo and is intentionally out of scope by filename filter");
    }

    internal static IReadOnlyList<string> FindStaleEntries(
        IReadOnlyList<KnownEventNameViolations.Entry> allowlist,
        IReadOnlyList<DiscoveredConstant> discovered)
    {
        var discoveredMap = discovered
            .GroupBy(c => (c.FilePath, c.ConstantName, c.Value))
            .ToDictionary(g => g.Key, g => g.First());

        var stale = new List<string>();
        foreach (var entry in allowlist)
        {
            var key = (entry.FilePath, entry.ConstantName, entry.Value);
            if (!discoveredMap.ContainsKey(key))
            {
                stale.Add($"{entry.FilePath}:{entry.Line} {entry.ConstantName} = \"{entry.Value}\" (no longer present — remove from allowlist)");
            }
            else if (CanonicalShapeRegex().IsMatch(entry.Value))
            {
                stale.Add($"{entry.FilePath}:{entry.Line} {entry.ConstantName} = \"{entry.Value}\" (now complies with canonical shape — remove from allowlist)");
            }
        }
        return stale;
    }

    internal static List<DiscoveredConstant> ScanScopedEventConstants()
    {
        var repoRoot = LocateRepoRoot();
        var srcRoot = Path.Combine(repoRoot, "apps", "tamma-elsa", "src");
        var results = new List<DiscoveredConstant>();

        foreach (var project in ScopedProjects)
        {
            var projectDir = Path.Combine(srcRoot, project);
            if (!Directory.Exists(projectDir))
                continue;

            foreach (var file in Directory.GetFiles(projectDir, "*.cs", SearchOption.AllDirectories)
                         .OrderBy(p => p, StringComparer.Ordinal))
            {
                var fileName = Path.GetFileName(file);
                if (!fileName.EndsWith("Events.cs", StringComparison.Ordinal)
                    && !fileName.EndsWith("EventTypes.cs", StringComparison.Ordinal))
                    continue;

                var relPath = Path.GetRelativePath(repoRoot, file).Replace('\\', '/');
                var cleaned = StripCommentsPreservingLines(File.ReadAllText(file));

                foreach (Match match in PublicConstStringRegex().Matches(cleaned))
                {
                    var name = match.Groups[1].Value;
                    var value = match.Groups[2].Value;
                    if (!value.Contains('.'))
                        continue;

                    var line = CountNewlines(cleaned, match.Index) + 1;
                    results.Add(new DiscoveredConstant(relPath, line, name, value));
                }
            }
        }

        return results;
    }

    internal static string LocateRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "apps", "tamma-elsa", "src")))
                return dir.FullName;
            dir = dir.Parent;
        }
        throw new InvalidOperationException("Could not locate repository root containing apps/tamma-elsa/src.");
    }

    private static string StripCommentsPreservingLines(string source)
    {
        var sb = new StringBuilder(source.Length);
        var i = 0;
        var inString = false;
        var inChar = false;
        var inVerbatimString = false;

        while (i < source.Length)
        {
            var ch = source[i];
            var next = i + 1 < source.Length ? source[i + 1] : '\0';

            if (inVerbatimString)
            {
                sb.Append(ch);
                if (ch == '"' && next == '"')
                {
                    sb.Append(next);
                    i += 2;
                    continue;
                }
                if (ch == '"')
                    inVerbatimString = false;
                i++;
                continue;
            }

            if (inString)
            {
                sb.Append(ch);
                if (ch == '\\' && i + 1 < source.Length)
                {
                    sb.Append(next);
                    i += 2;
                    continue;
                }
                if (ch == '"')
                    inString = false;
                i++;
                continue;
            }

            if (inChar)
            {
                sb.Append(ch);
                if (ch == '\\' && i + 1 < source.Length)
                {
                    sb.Append(next);
                    i += 2;
                    continue;
                }
                if (ch == '\'')
                    inChar = false;
                i++;
                continue;
            }

            if (ch == '@' && next == '"')
            {
                inVerbatimString = true;
                sb.Append(ch).Append(next);
                i += 2;
                continue;
            }

            if (ch == '"')
            {
                inString = true;
                sb.Append(ch);
                i++;
                continue;
            }

            if (ch == '\'')
            {
                inChar = true;
                sb.Append(ch);
                i++;
                continue;
            }

            if (ch == '/' && next == '/')
            {
                i += 2;
                while (i < source.Length && source[i] != '\n')
                    i++;
                continue;
            }

            if (ch == '/' && next == '*')
            {
                i += 2;
                while (i < source.Length)
                {
                    if (source[i] == '\n')
                        sb.Append('\n');
                    if (source[i] == '*' && i + 1 < source.Length && source[i + 1] == '/')
                    {
                        i += 2;
                        break;
                    }
                    i++;
                }
                continue;
            }

            sb.Append(ch);
            i++;
        }

        return sb.ToString();
    }

    private static int CountNewlines(string text, int endIndex)
    {
        var count = 0;
        for (var i = 0; i < endIndex; i++)
        {
            if (text[i] == '\n')
                count++;
        }
        return count;
    }
}
