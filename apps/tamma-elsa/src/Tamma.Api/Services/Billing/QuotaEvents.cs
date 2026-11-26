using System.Text.Json;
using Tamma.Core.Billing;
using Tamma.Data.Entities;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-6 (AC7, AC13) — DCB event-type constants and builders for quota
/// threshold crossings. Both constants strictly match the 3-segment
/// <c>AGGREGATE.ACTION.STATUS</c> naming ratchet.
/// </summary>
public static class QuotaEvents
{
    public const string Warn = "BILLING.QUOTA.WARN";
    public const string Exceeded = "BILLING.QUOTA.EXCEEDED";

    private const string SystemMetadata =
        """{"workflowVersion":"1.0.0","eventSource":"system"}""";

    public static DomainEvent BuildWarn(
        Guid tenantId,
        QuotaDimension dimension,
        string planSlug,
        string billingMode,
        DateTime periodStartUtc,
        long used,
        long limit,
        DateTime occurredAtUtc) =>
        new()
        {
            Id = Guid.NewGuid(),
            Type = Warn,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(new
            {
                tenantId = tenantId.ToString("D"),
                which_quota = dimension.ToWire(),
                plan = planSlug,
                mode = billingMode,
                period_start = periodStartUtc.ToString("O"),
                used,
                limit,
            }),
            Metadata = SystemMetadata,
            Data = JsonSerializer.Serialize(new
            {
                which_quota = dimension.ToWire(),
                plan = planSlug,
                mode = billingMode,
                period_start = periodStartUtc,
                used,
                limit,
            }),
            CreatedAt = occurredAtUtc,
        };

    public static DomainEvent BuildExceeded(
        Guid tenantId,
        QuotaDimension dimension,
        string planSlug,
        string billingMode,
        DateTime periodStartUtc,
        long used,
        long limit,
        OverageBehavior overageBehavior,
        DateTime occurredAtUtc) =>
        new()
        {
            Id = Guid.NewGuid(),
            Type = Exceeded,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(new
            {
                tenantId = tenantId.ToString("D"),
                which_quota = dimension.ToWire(),
                plan = planSlug,
                mode = billingMode,
                period_start = periodStartUtc.ToString("O"),
                used,
                limit,
                overage_behavior = overageBehavior.ToString(),
            }),
            Metadata = SystemMetadata,
            Data = JsonSerializer.Serialize(new
            {
                which_quota = dimension.ToWire(),
                plan = planSlug,
                mode = billingMode,
                period_start = periodStartUtc,
                used,
                limit,
                overage_behavior = overageBehavior.ToString(),
            }),
            CreatedAt = occurredAtUtc,
        };
}
