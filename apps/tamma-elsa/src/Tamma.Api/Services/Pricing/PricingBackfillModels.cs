using System.Text.Json;
using Microsoft.Extensions.Logging;
using Tamma.Core.Enums;

namespace Tamma.Api.Services.Pricing;

/// <summary>Trigger origin for a pricing backfill run (AC10).</summary>
public enum BackfillTrigger
{
    Startup,
    Admin,
}

/// <summary>
/// Story 34-10 (AC9, AC10) — summary returned by
/// <see cref="IPricingBackfillService.RunAsync"/>. A second idempotent run
/// returns <c>WasNoOp = true</c> with all-zero insert counts.
/// </summary>
public sealed record BackfillReport(
    Guid RunId,
    int PlansConverted,
    int EntitlementsCreated,
    int TenantsAssigned,
    int SkippedTenants,
    bool WasNoOp,
    long DurationMs);

/// <summary>One mapped entitlement specification parsed from legacy <c>Plan.Quotas</c> JSON.</summary>
public sealed record LegacyQuotaSpec(
    EntitlementMetricKey MetricKey,
    long? LimitValue,
    string Period,
    string OverageMode);

/// <summary>
/// Story 34-10 (AC1) — pure parser converting legacy <c>Plan.Quotas</c> JSON
/// blobs into structured <see cref="LegacyQuotaSpec"/> entries:
/// <list type="bullet">
///   <item><c>llmTokensPerMonth</c> → <see cref="EntitlementMetricKey.LlmTokens"/></item>
///   <item><c>seats</c> → <see cref="EntitlementMetricKey.Seats"/></item>
///   <item><c>-1</c> sentinel or <c>null</c> → <c>LimitValue = null</c> (unlimited)</item>
///   <item><c>concurrentWorkflows</c> and other unrecognized keys → dropped with WARN log</item>
/// </list>
/// Malformed JSON logs WARN and returns an empty list (never fails the run).
/// </summary>
public static class LegacyQuotaMap
{
    public const string DefaultPeriod = "monthly";
    public const string DefaultOverageMode = "block";

    public static IReadOnlyList<LegacyQuotaSpec> Parse(
        string planSlug,
        string? quotasJson,
        ILogger? logger = null)
    {
        if (string.IsNullOrWhiteSpace(quotasJson))
        {
            return [];
        }

        try
        {
            using var doc = JsonDocument.Parse(quotasJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                logger?.LogWarning(
                    "Legacy Plan.Quotas on plan '{Slug}' is not a JSON object; skipping quota conversion.",
                    planSlug);
                return [];
            }

            var specs = new List<LegacyQuotaSpec>();
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                switch (prop.Name)
                {
                    case "llmTokensPerMonth":
                        if (TryReadLimit(prop.Value, out var tokenLimit))
                        {
                            specs.Add(new LegacyQuotaSpec(
                                EntitlementMetricKey.LlmTokens,
                                tokenLimit,
                                DefaultPeriod,
                                DefaultOverageMode));
                        }
                        break;

                    case "seats":
                        if (TryReadLimit(prop.Value, out var seatLimit))
                        {
                            specs.Add(new LegacyQuotaSpec(
                                EntitlementMetricKey.Seats,
                                seatLimit,
                                "total",
                                DefaultOverageMode));
                        }
                        break;

                    default:
                        // AC1: concurrentWorkflows (and any other non-entitlement key)
                        // is dropped and logged WARN rather than failing the backfill.
                        logger?.LogWarning(
                            "Unmapped legacy Plan.Quotas key '{Key}' on plan '{Slug}' dropped during backfill.",
                            prop.Name, planSlug);
                        break;
                }
            }

            return specs;
        }
        catch (JsonException ex)
        {
            logger?.LogWarning(
                ex,
                "Malformed legacy Plan.Quotas JSON on plan '{Slug}'; skipping quota conversion.",
                planSlug);
            return [];
        }
    }

    private static bool TryReadLimit(JsonElement el, out long? limit)
    {
        if (el.ValueKind == JsonValueKind.Null)
        {
            limit = null;
            return true;
        }

        if (el.ValueKind == JsonValueKind.Number && el.TryGetInt64(out var raw))
        {
            limit = raw < 0 ? null : raw; // -1 sentinel => unlimited (NULL)
            return true;
        }

        limit = null;
        return false;
    }
}
