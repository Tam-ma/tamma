namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-3 — control-plane usage metering service. Computes idempotent
/// per-tenant per-billing-period rollups split by <c>billing_mode</c> (delegating
/// all markup/pricing math to 34-5's <c>IUsagePricingEngine</c>), reads the
/// current-period rollup for the API (never hitting Stripe on read), and buffers
/// platform-only token meter events for batch flushing.
/// </summary>
public interface IUsageMeteringService
{
    /// <summary>Recompute a tenant's rollup for a billing period from usage facts. Idempotent and fail-open.</summary>
    Task UpsertRollupAsync(Guid tenantId, BillingPeriod period, CancellationToken ct = default);

    /// <summary>Read the current-period rollup for a tenant from the local control-plane store (never Stripe).</summary>
    Task<UsageSummaryDto> GetCurrentUsageAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>Buffer platform-only token meter events for the flush handler (BYOK is explicitly excluded).</summary>
    Task BufferMeterEventsAsync(Guid tenantId, BillingPeriod period, CancellationToken ct = default);
}

/// <summary>Half-open UTC billing period <c>[StartUtc, EndUtc)</c>.</summary>
public sealed record BillingPeriod(DateTime StartUtc, DateTime EndUtc)
{
    /// <summary>Default UTC calendar month containing <paramref name="utcNow"/>.</summary>
    public static BillingPeriod ForUtcMonth(DateTime utcNow)
    {
        var utc = utcNow.Kind == DateTimeKind.Utc
            ? utcNow
            : DateTime.SpecifyKind(utcNow, DateTimeKind.Utc);
        var start = new DateTime(utc.Year, utc.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        return new BillingPeriod(start, start.AddMonths(1));
    }
}

/// <summary>
/// Story 35-3 (AC8) — current-period usage response returned by
/// <c>GET /api/v1/billing/usage</c>. Serializes as camelCase matching the API spec.
/// </summary>
public sealed record UsageSummaryDto(
    long PlatformInputTokens,
    long PlatformOutputTokens,
    long ByokInputTokens,
    long ByokOutputTokens,
    decimal PlatformCostUsd,
    decimal BillableUsd,
    int Seats,
    DateTime PeriodStart,
    DateTime PeriodEnd);

/// <summary>
/// Story 35-3 — canonical Stripe Billing Meter event names shared with Story
/// 35-1's <see cref="BillingSeeder"/>. Kept outside <c>*EventTypes.cs</c> so the
/// DCB event-name naming ratchet only inspects DCB event types.
/// </summary>
public static class BillingMeterNames
{
    public const string PlatformTokensInput = "tamma.platform_tokens_input";
    public const string PlatformTokensOutput = "tamma.platform_tokens_output";
    public const string Seats = "tamma.seats";
}
