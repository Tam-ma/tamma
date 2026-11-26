using System.Text.Json.Serialization;
using Tamma.Core.Billing;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-6 — outcome of evaluating one quota dimension for a tenant.
/// When <see cref="Allowed"/> is <c>false</c>, <see cref="HttpStatus"/> is
/// <c>402</c> (platform-token HardBlock) or <c>429</c> (concurrent workflows,
/// seats, connected repos).
/// </summary>
public sealed record QuotaDecision(
    bool Allowed,
    QuotaDimension WhichQuota,
    long Limit,
    long Used,
    DateTimeOffset? ResetAt,
    int HttpStatus,
    string? Reason = null)
{
    public static QuotaDecision Allow(
        QuotaDimension dimension,
        long limit = 0,
        long used = 0,
        DateTimeOffset? resetAt = null) =>
        new(true, dimension, limit, used, resetAt, 0, null);

    public static QuotaDecision Deny(
        QuotaDimension dimension,
        long limit,
        long used,
        DateTimeOffset? resetAt,
        int httpStatus,
        string? reason = null) =>
        new(false, dimension, limit, used, resetAt, httpStatus, reason);
}

/// <summary>
/// Story 35-6 (AC8) — machine-readable over-quota response body returned on
/// HTTP 402 (token allowance HardBlock or billing suspension) or HTTP 429 (cap exhaustion).
/// </summary>
public sealed record QuotaResponse(
    [property: JsonPropertyName("error")] string Error,
    [property: JsonPropertyName("which_quota")] string WhichQuota,
    [property: JsonPropertyName("reset_at")] string? ResetAt,
    [property: JsonPropertyName("limit")] long Limit,
    [property: JsonPropertyName("used")] long Used,
    [property: JsonPropertyName("reason"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Reason = null)
{
    public static QuotaResponse From(QuotaDecision decision) => new(
        Error: "quota_exceeded",
        WhichQuota: decision.WhichQuota.ToWire(),
        ResetAt: decision.ResetAt?.UtcDateTime.ToString("O"),
        Limit: decision.Limit,
        Used: decision.Used,
        Reason: decision.Reason);
}

/// <summary>
/// Story 35-6 (AC12) — read-only observability snapshot returned by
/// <c>GET /api/v1/admin/quota/{tenantId}</c> and
/// <c>GET /api/v1/orgs/{tenantId}/quota</c>.
/// </summary>
public sealed record QuotaSnapshotDto(
    [property: JsonPropertyName("plan")] string Plan,
    [property: JsonPropertyName("mode")] string Mode,
    [property: JsonPropertyName("token_allowance")] long? TokenAllowance,
    [property: JsonPropertyName("tokens_used")] long TokensUsed,
    [property: JsonPropertyName("overage_behavior")] string OverageBehavior,
    [property: JsonPropertyName("seats_limit")] int? SeatsLimit,
    [property: JsonPropertyName("seats_used")] int SeatsUsed,
    [property: JsonPropertyName("concurrent_limit")] int? ConcurrentLimit,
    [property: JsonPropertyName("concurrent_used")] int ConcurrentUsed,
    [property: JsonPropertyName("repos_limit")] int? ReposLimit,
    [property: JsonPropertyName("repos_used")] int ReposUsed,
    [property: JsonPropertyName("reset_at")] string? ResetAt);
