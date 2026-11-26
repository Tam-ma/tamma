using System.Text.Json.Serialization;

namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Story 44-4 step 7 / Amendment A6 — canonical outcome wire strings shared by
/// both Epic 41 → Epic 44 apply seams (<see cref="OrderingApplyService"/> and
/// <see cref="SprintPlanApplyService"/>).
///
/// <para><see cref="OrderingApplyService"/> continues to emit ONLY the first
/// three codes (<see cref="Applied"/>, <see cref="NotFound"/>,
/// <see cref="WrongProject"/>); <see cref="AlreadyCommittedElsewhere"/> is
/// additive for <see cref="SprintPlanApplyService"/> (44-4 D8).</para>
/// </summary>
public static class ApplyOutcomeCodes
{
    public const string Applied = "applied";
    public const string NotFound = "not-found";
    public const string WrongProject = "wrong-project";
    public const string AlreadyCommittedElsewhere = "already-committed-elsewhere";
}

/// <summary>
/// Shared per-entry apply outcome record used by both
/// <see cref="OrderingApplyService"/> (Story 44-3) and
/// <see cref="SprintPlanApplyService"/> (Story 44-4). Seam-specific optional
/// fields are omitted when null so 44-3's wire responses remain byte-identical.
/// </summary>
public sealed record ApplyOutcome(
    [property: JsonPropertyName("itemId")] string ItemId,
    [property: JsonPropertyName("outcome")] string Outcome,
    [property: JsonPropertyName("workItemId")] Guid? WorkItemId,
    [property: JsonPropertyName("workItemKey")] string? WorkItemKey,
    [property: JsonPropertyName("documentRank"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? DocumentRank = null,
    [property: JsonPropertyName("newRank"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? NewRank = null,
    [property: JsonPropertyName("previousIterationId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? PreviousIterationId = null);
