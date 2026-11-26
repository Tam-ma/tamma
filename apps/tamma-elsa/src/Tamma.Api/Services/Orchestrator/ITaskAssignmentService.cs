using Tamma.Api.Services.Access;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-20 (AC4 / AC5 / D7) — server-validated role-addressed task
/// assignment seam consumed by the orchestrator (39-17) and human completion
/// surfaces (39-8 / 39-19).
/// </summary>
public interface ITaskAssignmentService
{
    Task<AssignmentResult> AssignAsync(
        Guid tenantId,
        TaskRef task,
        string roleWire,
        string basis,
        string? autonomyContextRef,
        CancellationToken ct = default);

    Task<AssignmentResult> ReassignAsync(
        Guid tenantId,
        TaskRef task,
        string previousRoleWire,
        string newRoleWire,
        string basis,
        string? autonomyContextRef,
        CancellationToken ct = default);

    Task<TaskCompletionResult> CompleteAsync(
        Guid tenantId,
        TaskRef task,
        Guid completedByUserId,
        string surface,
        CancellationToken ct = default);
}

public enum AssignmentOutcome
{
    Accepted,
    RefusedUnknownRole,
    RefusedEmptyAudience,
    RefusedInvalidInput,
}

public sealed record AssignmentResult(
    AssignmentOutcome Outcome,
    string? RoleWire,
    IReadOnlyList<AudienceMember> Audience,
    string? RefusalReason = null)
{
    public bool IsAccepted => Outcome == AssignmentOutcome.Accepted;

    public static AssignmentResult Accepted(string roleWire, IReadOnlyList<AudienceMember> audience)
        => new(AssignmentOutcome.Accepted, roleWire, audience);

    public static AssignmentResult Refused(AssignmentOutcome outcome, string reason)
        => new(outcome, null, Array.Empty<AudienceMember>(), reason);
}

public enum TaskCompletionOutcome
{
    Completed,
    RefusedNotEligible,
    RefusedInvalidInput,
}

public sealed record TaskCompletionResult(
    TaskCompletionOutcome Outcome,
    string? RefusalReason = null)
{
    public bool IsCompleted => Outcome == TaskCompletionOutcome.Completed;

    public static TaskCompletionResult Completed() => new(TaskCompletionOutcome.Completed);
    public static TaskCompletionResult Refused(TaskCompletionOutcome outcome, string reason)
        => new(outcome, reason);
}
