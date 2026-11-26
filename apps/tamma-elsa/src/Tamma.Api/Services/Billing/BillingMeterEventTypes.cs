using System.Text.Json;
using Tamma.Data.Entities;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-3 (AC10) — DCB event-type constants and builders for usage
/// metering, Stripe meter-event flushing, and reconciliation drift. All event
/// names strictly obey the <c>AGGREGATE.ACTION.STATUS</c> 3-segment convention.
/// </summary>
public static class BillingMeterEventTypes
{
    public const string UsageRecorded = "BILLING.USAGE.RECORDED";
    public const string FlushFailed = "BILLING.USAGE.FLUSH_FAILED";
    public const string ReconciliationMismatch = "BILLING.USAGE.RECONCILIATION_MISMATCH";

    private const string SystemMetadata =
        """{"workflowVersion":"1.0.0","eventSource":"system"}""";

    public static DomainEvent Recorded(
        Guid tenantId,
        DateTime periodStart,
        string? stripeCustomerId,
        string? billingMode,
        long platformInputTokens,
        long platformOutputTokens,
        long byokInputTokens,
        long byokOutputTokens,
        decimal platformCostUsd,
        decimal billableAmountUsd,
        DateTime occurredAtUtc) =>
        new()
        {
            Id = Guid.NewGuid(),
            Type = UsageRecorded,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(new
            {
                tenantId = tenantId.ToString("D"),
                billingMode,
                periodStart = periodStart.ToString("O"),
                stripeCustomerId,
            }),
            Metadata = SystemMetadata,
            Data = JsonSerializer.Serialize(new
            {
                periodStart,
                platformInputTokens,
                platformOutputTokens,
                byokInputTokens,
                byokOutputTokens,
                platformCostUsd,
                billableAmountUsd,
            }),
            CreatedAt = occurredAtUtc,
        };

    public static DomainEvent FlushFailure(
        Guid tenantId,
        DateTime periodStart,
        string stripeCustomerId,
        string eventName,
        string value,
        int attemptCount,
        string errorClass,
        DateTime occurredAtUtc) =>
        new()
        {
            Id = Guid.NewGuid(),
            Type = FlushFailed,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(new
            {
                tenantId = tenantId.ToString("D"),
                billingMode = BillingModeTokens.Platform,
                periodStart = periodStart.ToString("O"),
                stripeCustomerId,
                eventName,
            }),
            Metadata = SystemMetadata,
            Data = JsonSerializer.Serialize(new
            {
                eventName,
                value,
                attemptCount,
                errorClass,
            }),
            CreatedAt = occurredAtUtc,
        };

    public static DomainEvent DriftDetected(
        Guid tenantId,
        DateTime periodStart,
        string stripeCustomerId,
        string meter,
        long localTotal,
        long stripeTotal,
        decimal estimatedDriftUsd,
        DateTime occurredAtUtc) =>
        new()
        {
            Id = Guid.NewGuid(),
            Type = ReconciliationMismatch,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(new
            {
                tenantId = tenantId.ToString("D"),
                billingMode = BillingModeTokens.Platform,
                periodStart = periodStart.ToString("O"),
                stripeCustomerId,
                meter,
                local = localTotal,
                stripe = stripeTotal,
            }),
            Metadata = SystemMetadata,
            Data = JsonSerializer.Serialize(new
            {
                meter,
                local = localTotal,
                stripe = stripeTotal,
                tokenDrift = Math.Abs(localTotal - stripeTotal),
                estimatedDriftUsd,
            }),
            CreatedAt = occurredAtUtc,
        };
}
