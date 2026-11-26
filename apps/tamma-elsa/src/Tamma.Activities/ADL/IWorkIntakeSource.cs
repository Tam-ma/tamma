using Tamma.Core.Tracking;

namespace Tamma.Activities.ADL;

/// <summary>
/// Story 44-7 AC3 (D4) — source-agnostic intake query passed to every
/// <see cref="IWorkIntakeSource"/> implementation.
/// </summary>
public sealed record WorkIntakeQuery(
    string Repository,
    string[] AutoLabels,
    string[] ExcludeLabels,
    string BotAssignee,
    Guid? ProjectId = null,
    int Limit = 50);

/// <summary>
/// Result of one <see cref="IWorkIntakeSource.FetchAsync"/> call.
/// Distinguishes a genuine empty backlog (<see cref="Failed"/> = false) from a
/// transport / HTTP / deserialization error (<see cref="Failed"/> = true,
/// <see cref="Error"/> populated) so AC2's loud event never conflates the two.
/// </summary>
public sealed record WorkIntakeResult(
    IReadOnlyList<WorkItem> Candidates,
    int UntriagedCount = 0,
    bool Failed = false,
    string? Error = null);

/// <summary>
/// Story 44-7 AC3 (D4) — intake-source abstraction at the <em>source</em> level
/// rather than the item level: every implementation yields the single shared
/// <see cref="WorkItem"/> shape so <c>SingleIssueCycleWorkflow.cs</c> requires
/// zero changes (AC9 / D3).
/// </summary>
public interface IWorkIntakeSource
{
    WorkIntakeSourceKind Kind { get; }

    Task<WorkIntakeResult> FetchAsync(WorkIntakeQuery query, CancellationToken ct = default);
}
