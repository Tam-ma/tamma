using System.Text.Json;
using System.Text.Json.Serialization;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Policy;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (AC3 / D11) — closed discriminated union representing the parsed
/// outcome of an Orchestrator Agent turn. Never throws on malformed LLM output:
/// <see cref="OrchestratorOutcomeParser"/> fails closed to a typed escalation or
/// refusal-safe outcome.
/// </summary>
public abstract record OrchestratorTurnOutcome
{
    public sealed record DecideSelf(
        AcceptanceDecision Decision,
        string ReasoningSummary) : OrchestratorTurnOutcome;

    public sealed record AssignToRole(
        string RoleWire,
        AssignmentBasis Basis,
        string ReasoningSummary) : OrchestratorTurnOutcome;

    public sealed record DispositionEscalation(
        EscalationDisposition Disposition,
        string? Note,
        string ReasoningSummary) : OrchestratorTurnOutcome;

    public sealed record Reply(
        string Text,
        string ReasoningSummary) : OrchestratorTurnOutcome;
}

/// <summary>
/// Fail-closed parser for Orchestrator Agent final turn responses (D11).
/// Strips optional Markdown JSON fences and parses the structured routing payload.
/// Unparseable acceptance responses fail closed to
/// <see cref="OrchestratorTurnOutcome.DecideSelf"/> carrying
/// <see cref="AcceptanceDecision.Escalate"/> (<see cref="AcceptanceEscalationReason.AcceptorJudgment"/>).
/// </summary>
public static class OrchestratorOutcomeParser
{
    public static OrchestratorTurnOutcome ParseAcceptanceOutcome(string? rawResponse)
    {
        var cleaned = StripFences(rawResponse);
        if (string.IsNullOrWhiteSpace(cleaned))
        {
            return FailClosedEscalate("Empty orchestrator response; escalating for human review.");
        }

        try
        {
            using var doc = JsonDocument.Parse(cleaned);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return FailClosedEscalate("Orchestrator response was not a JSON object; escalating.");

            var root = doc.RootElement;
            var routing = GetString(root, "routing")?.Trim().ToLowerInvariant();
            var reasoning = GetString(root, "reasoningSummary") ?? GetString(root, "reasoning") ?? "Orchestrator decision.";

            if (routing == "assign-to-role")
            {
                var roleWire = GetString(root, "roleWire")?.Trim();
                if (string.IsNullOrWhiteSpace(roleWire))
                    return FailClosedEscalate("assign-to-role outcome omitted roleWire; escalating.");

                var basisWire = GetString(root, "basis")?.Trim().ToLowerInvariant();
                var basis = basisWire == "repo-access"
                    ? AssignmentBasis.RepoAccess
                    : AssignmentBasis.Initiator;

                return new OrchestratorTurnOutcome.AssignToRole(roleWire, basis, reasoning);
            }

            if (routing == "decide-self")
            {
                if (!root.TryGetProperty("decision", out var decEl) || decEl.ValueKind != JsonValueKind.Object)
                    return FailClosedEscalate("decide-self outcome omitted decision object; escalating.");

                var decision = ParseDecision(decEl, reasoning);
                return new OrchestratorTurnOutcome.DecideSelf(decision, reasoning);
            }

            return FailClosedEscalate($"Unrecognized routing '{routing}'; escalating.");
        }
        catch (JsonException)
        {
            return FailClosedEscalate("Unparseable JSON from orchestrator; failing closed to escalation.");
        }
    }

    public static OrchestratorTurnOutcome ParseEscalationOutcome(string? rawResponse)
    {
        var cleaned = StripFences(rawResponse);
        if (string.IsNullOrWhiteSpace(cleaned))
        {
            return new OrchestratorTurnOutcome.AssignToRole(
                "tech_lead", AssignmentBasis.RepoAccess, "Empty escalation response; routing to tech_lead.");
        }

        try
        {
            using var doc = JsonDocument.Parse(cleaned);
            if (doc.RootElement.ValueKind == JsonValueKind.Object)
            {
                var root = doc.RootElement;
                var routing = GetString(root, "routing")?.Trim().ToLowerInvariant();
                var reasoning = GetString(root, "reasoningSummary") ?? GetString(root, "reasoning") ?? "Orchestrator escalation disposition.";

                if (routing == "assign-to-role")
                {
                    var roleWire = GetString(root, "roleWire")?.Trim();
                    if (!string.IsNullOrWhiteSpace(roleWire))
                    {
                        var basis = string.Equals(GetString(root, "basis"), "initiator", StringComparison.OrdinalIgnoreCase)
                            ? AssignmentBasis.Initiator
                            : AssignmentBasis.RepoAccess;
                        return new OrchestratorTurnOutcome.AssignToRole(roleWire, basis, reasoning);
                    }
                }

                if (routing == "disposition" || root.TryGetProperty("disposition", out _))
                {
                    var dispWire = GetString(root, "disposition")?.Trim().ToLowerInvariant();
                    var note = GetString(root, "note") ?? reasoning;
                    var disp = dispWire switch
                    {
                        "resolved" => EscalationDisposition.Resolved,
                        "overridden" => EscalationDisposition.Overridden,
                        "abandoned" => EscalationDisposition.Abandoned,
                        _ => EscalationDisposition.Resolved,
                    };
                    return new OrchestratorTurnOutcome.DispositionEscalation(disp, note, reasoning);
                }
            }
        }
        catch (JsonException)
        {
            // Fall through to safe role assignment.
        }

        return new OrchestratorTurnOutcome.AssignToRole(
            "tech_lead", AssignmentBasis.RepoAccess, "Unparseable escalation outcome; routing to tech_lead.");
    }

    private static AcceptanceDecision ParseDecision(JsonElement decEl, string fallbackDetail)
    {
        var kind = GetString(decEl, "kind")?.Trim().ToLowerInvariant();
        return kind switch
        {
            "accept" => new AcceptanceDecision.Accept(),
            "request-revision" => new AcceptanceDecision.RequestRevision(
                GetString(decEl, "notes") ?? fallbackDetail),
            "reject" => new AcceptanceDecision.Reject(
                GetString(decEl, "reason") ?? fallbackDetail),
            "escalate" => new AcceptanceDecision.Escalate(
                ParseEscalationReason(GetString(decEl, "reason")),
                GetString(decEl, "detail") ?? fallbackDetail),
            _ => new AcceptanceDecision.Escalate(
                AcceptanceEscalationReason.AcceptorJudgment,
                $"Unknown decision kind '{kind}'; failing closed to escalate."),
        };
    }

    private static AcceptanceEscalationReason ParseEscalationReason(string? wire)
    {
        if (!string.IsNullOrWhiteSpace(wire))
        {
            foreach (var r in Enum.GetValues<AcceptanceEscalationReason>())
                if (string.Equals(r.ToWire(), wire.Trim(), StringComparison.OrdinalIgnoreCase))
                    return r;
        }
        return AcceptanceEscalationReason.AcceptorJudgment;
    }

    private static OrchestratorTurnOutcome.DecideSelf FailClosedEscalate(string detail) =>
        new(new AcceptanceDecision.Escalate(AcceptanceEscalationReason.AcceptorJudgment, detail), detail);

    private static string? GetString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String
            ? el.GetString()
            : null;

    internal static string StripFences(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return string.Empty;
        var s = raw.Trim();
        if (s.StartsWith("```", StringComparison.Ordinal))
        {
            var firstNl = s.IndexOf('\n');
            if (firstNl >= 0) s = s[(firstNl + 1)..];
            var lastFence = s.LastIndexOf("```", StringComparison.Ordinal);
            if (lastFence >= 0) s = s[..lastFence];
            s = s.Trim();
        }
        return s;
    }
}
