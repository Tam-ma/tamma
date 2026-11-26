using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Tamma.Core.Billing;
using Tamma.Core.Enums;
using Tamma.Data;
using Tamma.Data.Entities;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-6 — singleton cross-request cache of resolved per-tenant
/// <see cref="PlanQuota"/> instances (60s default TTL). Keeping the cache in a
/// singleton ensures <see cref="IQuotaService.Invalidate"/> called from a
/// webhook/subscription scope immediately evicts the cached quota for the very
/// next HTTP request (AC9).
/// </summary>
public sealed class QuotaCache
{
    private readonly ConcurrentDictionary<Guid, (PlanQuota Quota, DateTime FetchedAtUtc)> _entries = new();

    public bool TryGet(Guid tenantId, DateTime utcNow, TimeSpan ttl, out PlanQuota quota)
    {
        if (_entries.TryGetValue(tenantId, out var entry) && utcNow - entry.FetchedAtUtc < ttl)
        {
            quota = entry.Quota;
            return true;
        }

        quota = null!;
        return false;
    }

    public void Set(Guid tenantId, PlanQuota quota, DateTime utcNow)
        => _entries[tenantId] = (quota, utcNow);

    public void Invalidate(Guid tenantId)
        => _entries.TryRemove(tenantId, out _);

    public void Clear() => _entries.Clear();
}

/// <summary>
/// Story 35-6 (AC1, AC6, AC9) — resolves a tenant's effective <see cref="PlanQuota"/>
/// from the active <see cref="BillingSubscription"/> (falling back to
/// <see cref="Tenant.Plan"/> when pre-checkout) joined to the active
/// <see cref="Plan"/> row + its <see cref="Plan.Quotas"/> JSON and typed
/// <see cref="PlanEntitlement"/> children.
///
/// <para>Malformed <c>Plan.Quotas</c> JSON fails CLOSED to
/// <see cref="PlanQuota.FreeDefault"/> with a WARN log — never silently unlimited.</para>
/// </summary>
public sealed class QuotaResolver
{
    private readonly ControlPlaneDbContext _cp;
    private readonly QuotaCache _cache;
    private readonly QuotaOptions _options;
    private readonly TimeProvider _clock;
    private readonly ILogger<QuotaResolver> _logger;

    public QuotaResolver(
        ControlPlaneDbContext cp,
        QuotaCache cache,
        IOptions<QuotaOptions> options,
        TimeProvider clock,
        ILogger<QuotaResolver> logger)
    {
        ArgumentNullException.ThrowIfNull(cp);
        ArgumentNullException.ThrowIfNull(cache);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(logger);

        _cp = cp;
        _cache = cache;
        _options = options.Value;
        _clock = clock;
        _logger = logger;
    }

    public async Task<PlanQuota> ResolveAsync(Guid tenantId, CancellationToken ct = default)
    {
        var now = _clock.GetUtcNow().UtcDateTime;
        var ttl = TimeSpan.FromSeconds(Math.Max(1, _options.CacheTtlSeconds));
        if (_cache.TryGet(tenantId, now, ttl, out var cached))
        {
            return cached;
        }

        var subscription = await _cp.BillingSubscriptions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId
                        && s.Status != "canceled"
                        && s.Status != "incomplete_expired")
            .OrderByDescending(s => s.UpdatedAt)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);

        string planSlug;
        if (subscription is not null && !string.IsNullOrWhiteSpace(subscription.PlanSlug))
        {
            planSlug = subscription.PlanSlug;
        }
        else
        {
            var tenantPlan = await _cp.Tenants
                .AsNoTracking()
                .Where(t => t.Id == tenantId)
                .Select(t => t.Plan)
                .FirstOrDefaultAsync(ct)
                .ConfigureAwait(false);
            planSlug = string.IsNullOrWhiteSpace(tenantPlan) ? "free" : tenantPlan;
        }

        var plan = await _cp.Plans
            .AsNoTracking()
            .Include(p => p.Entitlements)
            .Where(p => p.Slug == planSlug && p.Status == "active")
            .OrderByDescending(p => p.Version)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);

        plan ??= await _cp.Plans
            .AsNoTracking()
            .Include(p => p.Entitlements)
            .Where(p => p.Slug == planSlug)
            .OrderByDescending(p => p.Version)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);

        var resolved = plan is null
            ? ResolveDefaultForSlug(planSlug, subscription?.Seats)
            : ParsePlan(plan, subscription?.Seats);

        _cache.Set(tenantId, resolved, now);
        return resolved;
    }

    public void Invalidate(Guid tenantId) => _cache.Invalidate(tenantId);

    internal PlanQuota ParsePlan(Plan plan, int? subscriptionSeats)
    {
        var defaultWarn = ClampWarn(_options.WarnThreshold);
        var defaultOverage = string.Equals(plan.Slug, "free", StringComparison.OrdinalIgnoreCase)
            ? OverageBehavior.HardBlock
            : OverageBehavior.AllowWithOverage;

        long? tokenAllowance = null;
        OverageBehavior? jsonOverage = null;
        int? maxSeats = null;
        int? maxConcurrent = null;
        int? maxRepos = null;
        double? jsonWarn = null;

        if (!string.IsNullOrWhiteSpace(plan.Quotas))
        {
            try
            {
                using var doc = JsonDocument.Parse(plan.Quotas);
                if (doc.RootElement.ValueKind != JsonValueKind.Object)
                {
                    _logger.LogWarning(
                        "Plan '{PlanSlug}' has non-object Plan.Quotas JSON; failing closed to free-tier quota.",
                        plan.Slug);
                    return PlanQuota.FreeDefault(defaultWarn);
                }

                var root = doc.RootElement;
                tokenAllowance = ReadNullableLimitLong(root, "llmTokensPerMonth", "platformTokenAllowance", "platform_token_allowance");
                maxConcurrent = ReadNullableLimitInt(root, "concurrentWorkflows", "maxConcurrentWorkflows", "max_concurrent_workflows");
                maxSeats = ReadNullableLimitInt(root, "seats", "maxSeats", "max_seats");
                maxRepos = ReadNullableLimitInt(root, "connectedRepos", "maxConnectedRepos", "max_connected_repos", "repos");

                if (TryGetString(root, out var overageRaw, "overageBehavior", "tokenOverage", "overage_behavior", "overageMode"))
                {
                    jsonOverage = ParseOverage(overageRaw, defaultOverage);
                }

                if (TryGetDouble(root, out var w, "warnThreshold", "warn_threshold"))
                {
                    jsonWarn = ClampWarn(w);
                }
            }
            catch (JsonException ex)
            {
                // AC1 / Technical Design: malformed Plan.Quotas fails CLOSED to
                // the free-tier quota — never silently unlimited.
                _logger.LogWarning(
                    ex,
                    "Malformed Plan.Quotas JSON on plan '{PlanSlug}'; failing closed to free-tier quota.",
                    plan.Slug);
                return PlanQuota.FreeDefault(defaultWarn);
            }
        }

        // Overlay typed PlanEntitlement rows (Story 34-1) when present and not
        // already overridden in JSON (or to supply connectedRepos / overageMode).
        var overageBehavior = jsonOverage ?? defaultOverage;
        if (plan.Entitlements is { Count: > 0 })
        {
            foreach (var ent in plan.Entitlements)
            {
                switch (ent.MetricKey)
                {
                    case EntitlementMetricKey.LlmTokens:
                        if (!tokenAllowance.HasValue && ent.LimitValue.HasValue && ent.LimitValue.Value >= 0)
                            tokenAllowance = ent.LimitValue.Value;
                        if (!jsonOverage.HasValue && !string.IsNullOrWhiteSpace(ent.OverageMode))
                            overageBehavior = ParseOverage(ent.OverageMode, overageBehavior);
                        break;
                    case EntitlementMetricKey.Seats:
                        if (!maxSeats.HasValue && ent.LimitValue.HasValue && ent.LimitValue.Value >= 0)
                            maxSeats = (int)Math.Min(int.MaxValue, ent.LimitValue.Value);
                        break;
                    case EntitlementMetricKey.Repos:
                        if (!maxRepos.HasValue && ent.LimitValue.HasValue && ent.LimitValue.Value >= 0)
                            maxRepos = (int)Math.Min(int.MaxValue, ent.LimitValue.Value);
                        break;
                }
            }
        }

        // If the tenant purchased a specific seat count on an active subscription
        // and the plan enforces a seat limit (non-null), honour the higher of
        // purchased seats vs plan baseline seats (or exact purchased seats on paid plans).
        if (subscriptionSeats is > 0 && maxSeats.HasValue && !string.Equals(plan.Slug, "free", StringComparison.OrdinalIgnoreCase))
        {
            maxSeats = Math.Max(maxSeats.Value, subscriptionSeats.Value);
        }

        return new PlanQuota(
            PlanSlug: plan.Slug,
            PlatformTokenAllowance: tokenAllowance,
            TokenOverage: overageBehavior,
            MaxSeats: maxSeats,
            MaxConcurrentWorkflows: maxConcurrent,
            MaxConnectedRepos: maxRepos,
            WarnThreshold: jsonWarn ?? defaultWarn);
    }

    private PlanQuota ResolveDefaultForSlug(string slug, int? subscriptionSeats)
    {
        var warn = ClampWarn(_options.WarnThreshold);
        return slug.ToLowerInvariant() switch
        {
            "team" => new PlanQuota("team", 2_000_000L, OverageBehavior.AllowWithOverage,
                subscriptionSeats is > 0 ? Math.Max(10, subscriptionSeats.Value) : 10, 10, 25, warn),
            "enterprise" => new PlanQuota("enterprise", 50_000_000L, OverageBehavior.AllowWithOverage,
                null, 100, null, warn),
            _ => PlanQuota.FreeDefault(warn),
        };
    }

    private static OverageBehavior ParseOverage(string? raw, OverageBehavior fallback)
    {
        if (string.IsNullOrWhiteSpace(raw)) return fallback;
        return raw.Trim().ToLowerInvariant() switch
        {
            "hardblock" or "hard_block" or "block" => OverageBehavior.HardBlock,
            "allowwithoverage" or "allow_with_overage" or "meter" or "allow" or "overage" => OverageBehavior.AllowWithOverage,
            _ => fallback,
        };
    }

    private static long? ReadNullableLimitLong(JsonElement root, params string[] keys)
    {
        foreach (var k in keys)
        {
            if (!root.TryGetProperty(k, out var el)) continue;
            if (el.ValueKind == JsonValueKind.Null) return null;
            if (el.ValueKind == JsonValueKind.Number && el.TryGetInt64(out var n))
                return n < 0 ? null : n; // -1 sentinel in PlansSeeder means unlimited
        }
        return null;
    }

    private static int? ReadNullableLimitInt(JsonElement root, params string[] keys)
    {
        var v = ReadNullableLimitLong(root, keys);
        return v.HasValue ? (int)Math.Min(int.MaxValue, v.Value) : null;
    }

    private static bool TryGetString(JsonElement root, out string? value, params string[] keys)
    {
        foreach (var k in keys)
        {
            if (root.TryGetProperty(k, out var el) && el.ValueKind == JsonValueKind.String)
            {
                value = el.GetString();
                return true;
            }
        }
        value = null;
        return false;
    }

    private static bool TryGetDouble(JsonElement root, out double value, params string[] keys)
    {
        foreach (var k in keys)
        {
            if (root.TryGetProperty(k, out var el) && el.ValueKind == JsonValueKind.Number && el.TryGetDouble(out value))
            {
                return true;
            }
        }
        value = 0;
        return false;
    }

    private static double ClampWarn(double v) => v is <= 0 or > 1 ? 0.8 : v;
}
