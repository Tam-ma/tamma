using System.Text.Json;

namespace Tamma.Core.Documents.Types;

/// <summary>
/// Story 41-29 (Phase 1 / Part 3) — resolved task-kind outcome fed into
/// <c>FlowSwitchByKind</c> inside <c>SingleIssueCycleWorkflow</c>.
/// Absent <c>kind</c> resolves to <see cref="Code"/> (back-compat); an out-of-vocab
/// or malformed <c>kind</c> resolves to <see cref="Unknown"/> so the router escalates
/// loudly instead of mis-routing into TDD.
/// </summary>
public enum ResolvedTaskKind
{
    Code,
    Test,
    Docs,
    Infra,
    Design,
    Investigation,
    Chore,
    Unknown,
}

/// <summary>Pure resolution outcome of <see cref="PlanRouting.ResolveKind"/>.</summary>
public sealed record TaskKindResolution(
    ResolvedTaskKind Kind,
    string KindWire,
    string? RawKind);

/// <summary>Pure resolution outcome of <see cref="PlanRouting.ResolveIssuePreRoute"/>.</summary>
public sealed record IssuePreRouteResolution(
    string ChosenFlow,
    string IssueType,
    string? Automation);

/// <summary>Pure routing target descriptor for one <see cref="ResolvedTaskKind"/>.</summary>
public sealed record TaskRouteTarget(
    string RouteMode,
    string? TargetWorkflow,
    string? MissingTarget);

/// <summary>
/// Story 41-29 — pure, deterministic routing helpers shared by
/// <c>SingleIssueCycleWorkflow</c> and unit tests. Contains ZERO I/O or non-durable
/// state so crash re-entry always re-derives the exact same route from persisted JSON.
/// </summary>
public static class PlanRouting
{
    public const string FlowPlan = "plan";
    public const string FlowQuestion = "question";
    public const string FlowNeedsHuman = "needs-human";

    public const string ModeCoding = "coding";
    public const string ModeSubWorkflow = "subworkflow";
    public const string ModeDeferToHuman = "defer-to-human";
    public const string ModeUnknown = "unknown";

    /// <summary>
    /// Resolve one serialized <see cref="PlanTask"/> slice into its
    /// <see cref="ResolvedTaskKind"/>. Absent/null <c>kind</c> ⇒ <see cref="ResolvedTaskKind.Code"/>;
    /// out-of-vocabulary or non-string <c>kind</c> ⇒ <see cref="ResolvedTaskKind.Unknown"/>.
    /// </summary>
    public static TaskKindResolution ResolveKind(string? taskJson)
    {
        if (string.IsNullOrWhiteSpace(taskJson))
            return new TaskKindResolution(ResolvedTaskKind.Code, "code", null);

        try
        {
            using var doc = JsonDocument.Parse(taskJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return new TaskKindResolution(ResolvedTaskKind.Code, "code", null);

            if (!TryGetPropertyIgnoreCase(doc.RootElement, "kind", out var kindEl) ||
                kindEl.ValueKind == JsonValueKind.Null)
            {
                return new TaskKindResolution(ResolvedTaskKind.Code, "code", null);
            }

            if (kindEl.ValueKind != JsonValueKind.String)
            {
                var raw = kindEl.GetRawText();
                return new TaskKindResolution(ResolvedTaskKind.Unknown, "unknown", raw);
            }

            var rawStr = kindEl.GetString();
            if (PlanTaskVocabulary.TryParseKind(rawStr, out var parsed))
            {
                var resolved = parsed switch
                {
                    TaskKind.Code => ResolvedTaskKind.Code,
                    TaskKind.Test => ResolvedTaskKind.Test,
                    TaskKind.Docs => ResolvedTaskKind.Docs,
                    TaskKind.Infra => ResolvedTaskKind.Infra,
                    TaskKind.Design => ResolvedTaskKind.Design,
                    TaskKind.Investigation => ResolvedTaskKind.Investigation,
                    TaskKind.Chore => ResolvedTaskKind.Chore,
                    _ => ResolvedTaskKind.Unknown,
                };
                return new TaskKindResolution(resolved, parsed.ToWire(), rawStr);
            }

            return new TaskKindResolution(ResolvedTaskKind.Unknown, "unknown", rawStr ?? string.Empty);
        }
        catch (JsonException)
        {
            return new TaskKindResolution(ResolvedTaskKind.Code, "code", null);
        }
    }

    /// <summary>
    /// Map a <see cref="ResolvedTaskKind"/> to its target execution mode and workflow
    /// DefinitionId. <c>infra</c> maps to the coding path (NEVER <c>deployment-pipeline</c>,
    /// which requires a post-merge <c>MergeSha</c>); unbuilt Epic 41 targets (<c>docs</c>)
    /// defer to human with an explicit missing-target reason.
    /// </summary>
    public static TaskRouteTarget TargetFor(ResolvedTaskKind kind) => kind switch
    {
        ResolvedTaskKind.Code => new(ModeCoding, "tdd-for-task", null),
        ResolvedTaskKind.Infra => new(ModeCoding, "tdd-for-task", null),
        ResolvedTaskKind.Chore => new(ModeCoding, "tdd-for-task", null),
        ResolvedTaskKind.Test => new(ModeSubWorkflow, "test-case-creation", null),
        ResolvedTaskKind.Investigation => new(ModeSubWorkflow, "research", null),
        ResolvedTaskKind.Design => new(ModeSubWorkflow, "design-proposal", null),
        ResolvedTaskKind.Docs => new(ModeDeferToHuman, null, "epic-41-docs-workflow (41-24/41-25/41-26)"),
        _ => new(ModeUnknown, null, null),
    };

    /// <summary>
    /// Story 41-29 (Part 2 / AC4) — resolve the issue-level pre-route from the accepted
    /// <see cref="TriageDecision"/> JSON (when stored in 39-11), falling back to
    /// <paramref name="workItemJson"/>'s <c>type</c> and <c>labels</c>.
    ///
    /// <para>Only two non-default pre-routes exist:
    /// <list type="bullet">
    ///   <item><c>needs-human</c> (defensive terminal when triage automation is <c>needs-human</c>)</item>
    ///   <item><c>question</c> (answer sub-graph: research → comment → close; never plan/branch)</item>
    /// </list>
    /// Everything else — explicitly including <c>docs</c>, <c>bug</c>, <c>feature</c>,
    /// <c>chore</c>, and <c>security</c> — takes the <c>plan</c> path.</para>
    /// </summary>
    public static IssuePreRouteResolution ResolveIssuePreRoute(
        string? triageDocJson,
        string? workItemJson)
    {
        string? issueType = null;
        string? automation = null;

        // 1. Primary source: accepted TriageDecision document from 39-11 store.
        if (!string.IsNullOrWhiteSpace(triageDocJson))
        {
            TryExtractTriageFields(triageDocJson, ref issueType, ref automation);
        }

        // 2. Fallback: workItemJson type + labels when no accepted triage document exists.
        if (string.IsNullOrWhiteSpace(issueType) || string.IsNullOrWhiteSpace(automation))
        {
            TryExtractWorkItemFallback(workItemJson, ref issueType, ref automation);
        }

        var normalizedType = string.IsNullOrWhiteSpace(issueType)
            ? "feature"
            : issueType.Trim().ToLowerInvariant();
        var normalizedAutomation = string.IsNullOrWhiteSpace(automation)
            ? null
            : automation.Trim().ToLowerInvariant();

        if (string.Equals(normalizedAutomation, TriageAutomation.NeedsHuman.ToWire(), StringComparison.OrdinalIgnoreCase))
            return new IssuePreRouteResolution(FlowNeedsHuman, normalizedType, normalizedAutomation);

        if (string.Equals(normalizedType, TriageIssueType.Question.ToWire(), StringComparison.OrdinalIgnoreCase))
            return new IssuePreRouteResolution(FlowQuestion, normalizedType, normalizedAutomation);

        // bug / feature / chore / docs / security -> existing plan pipeline (docs is NOT pre-routed, AC4).
        return new IssuePreRouteResolution(FlowPlan, normalizedType, normalizedAutomation);
    }

    private static void TryExtractTriageFields(string json, ref string? issueType, ref string? automation)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return;

            if (string.IsNullOrWhiteSpace(issueType) &&
                TryGetPropertyIgnoreCase(doc.RootElement, "type", out var tEl) &&
                tEl.ValueKind == JsonValueKind.String &&
                TriageVocabulary.TryParseType(tEl.GetString(), out var parsedType))
            {
                issueType = parsedType.ToWire();
            }

            if (string.IsNullOrWhiteSpace(automation) &&
                TryGetPropertyIgnoreCase(doc.RootElement, "automation", out var aEl) &&
                aEl.ValueKind == JsonValueKind.String &&
                TriageVocabulary.TryParseAutomation(aEl.GetString(), out var parsedAuto))
            {
                automation = parsedAuto.ToWire();
            }
        }
        catch (JsonException)
        {
            // Malformed triage JSON falls back cleanly to work item labels.
        }
    }

    private static void TryExtractWorkItemFallback(string? json, ref string? issueType, ref string? automation)
    {
        if (string.IsNullOrWhiteSpace(json)) return;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return;

            if (string.IsNullOrWhiteSpace(issueType) &&
                TryGetPropertyIgnoreCase(doc.RootElement, "type", out var tEl) &&
                tEl.ValueKind == JsonValueKind.String &&
                TriageVocabulary.TryParseType(tEl.GetString(), out var parsedType))
            {
                issueType = parsedType.ToWire();
            }

            if (string.IsNullOrWhiteSpace(automation) &&
                TryGetPropertyIgnoreCase(doc.RootElement, "automation", out var aEl) &&
                aEl.ValueKind == JsonValueKind.String &&
                TriageVocabulary.TryParseAutomation(aEl.GetString(), out var parsedAuto))
            {
                automation = parsedAuto.ToWire();
            }

            if (TryGetPropertyIgnoreCase(doc.RootElement, "labels", out var labelsEl) &&
                labelsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in labelsEl.EnumerateArray())
                {
                    var label = item.ValueKind switch
                    {
                        JsonValueKind.String => item.GetString(),
                        JsonValueKind.Object when TryGetPropertyIgnoreCase(item, "name", out var n) && n.ValueKind == JsonValueKind.String => n.GetString(),
                        _ => null,
                    };
                    if (string.IsNullOrWhiteSpace(label)) continue;
                    var norm = label.Trim().ToLowerInvariant();

                    if (string.IsNullOrWhiteSpace(automation) &&
                        TriageVocabulary.TryParseAutomation(norm, out var labelAuto))
                    {
                        automation = labelAuto.ToWire();
                    }
                    else if (string.IsNullOrWhiteSpace(issueType) &&
                        TriageVocabulary.TryParseType(norm, out var labelType))
                    {
                        issueType = labelType.ToWire();
                    }
                    else if (string.IsNullOrWhiteSpace(issueType) && norm is "documentation" or "doc")
                    {
                        issueType = TriageIssueType.Docs.ToWire();
                    }
                }
            }
        }
        catch (JsonException)
        {
            // Unparseable workItemJson defaults to plan pipeline.
        }
    }

    private static bool TryGetPropertyIgnoreCase(JsonElement obj, string name, out JsonElement value)
    {
        if (obj.TryGetProperty(name, out value))
            return true;
        foreach (var prop in obj.EnumerateObject())
        {
            if (string.Equals(prop.Name, name, StringComparison.OrdinalIgnoreCase))
            {
                value = prop.Value;
                return true;
            }
        }
        value = default;
        return false;
    }
}
