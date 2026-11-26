namespace Tamma.Api.Services.Tasks;

/// <summary>
/// Story 39-19 (AC3 / D7) — closed set of Task View item kinds.
/// Unknown values in historical or future events fall back safely to
/// <see cref="AcceptanceDecision"/>.
/// </summary>
public static class TaskTypes
{
    public const string AcceptanceDecision = "acceptance_decision";
    public const string Review = "review";
    public const string Approval = "approval";
    public const string Clarification = "clarification";

    public static readonly IReadOnlySet<string> Allowed =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            AcceptanceDecision,
            Review,
            Approval,
            Clarification,
        };

    public static string Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return AcceptanceDecision;
        var trimmed = raw.Trim().ToLowerInvariant();
        return Allowed.Contains(trimmed) ? trimmed : AcceptanceDecision;
    }
}

/// <summary>
/// Story 39-19 (AC3 / D7) — one projected inbox item rendered by the Task View.
/// Derived purely from <c>TASK.*</c> and <c>APPROVAL.*</c> events; never persisted
/// in a separate table.
/// </summary>
public sealed record TaskViewItem(
    Guid SessionId,
    string TaskType,
    string? DocumentType,
    Guid? DocumentId,
    string? IssueId,
    string? CorrelationId,
    string? RepoKey,
    string AssignedRole,
    string EligibilityBasis,
    string? AutonomyContext,
    string? RulesReference,
    DateTimeOffset AssignedAt,
    string Status,
    string? LineageUrl);
