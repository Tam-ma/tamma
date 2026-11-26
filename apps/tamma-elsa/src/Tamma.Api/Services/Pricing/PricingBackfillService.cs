using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Tamma.Api.Services.PromptStore;
using Tamma.Core;
using Tamma.Core.Enums;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;

namespace Tamma.Api.Services.Pricing;

/// <summary>
/// Story 34-10 (AC1, AC2, AC9, AC10) — idempotent, insert-missing-only backfill
/// from legacy <c>Plan.Quotas</c> JSON / <c>Tenant.Plan</c> strings to
/// structured <see cref="PlanEntitlement"/> and
/// <see cref="TenantPlanAssignment"/> rows, guarded by a single-flight lock and
/// verified by the zero-unassigned-tenant invariant.
/// </summary>
public sealed class PricingBackfillService : IPricingBackfillService
{
    public const string BackfillReason = "backfill: 34-10";
    public const string IncompleteErrorCode = "PRICING.BACKFILL.INCOMPLETE";

    private const string SystemMetadata =
        """{"workflowVersion":"1.0.0","eventSource":"system"}""";

    private static readonly SemaphoreSlim SingleFlight = new(1, 1);

    private readonly ControlPlaneDbContext _cp;
    private readonly IPlatformEventPublisher _events;
    private readonly ITammaModeProvider _modeProvider;
    private readonly TimeProvider _clock;
    private readonly ILogger<PricingBackfillService> _logger;

    public PricingBackfillService(
        ControlPlaneDbContext cp,
        IPlatformEventPublisher events,
        ITammaModeProvider modeProvider,
        TimeProvider clock,
        ILogger<PricingBackfillService> logger)
    {
        ArgumentNullException.ThrowIfNull(cp);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(modeProvider);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(logger);

        _cp = cp;
        _events = events;
        _modeProvider = modeProvider;
        _clock = clock;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<BackfillReport> RunAsync(
        BackfillTrigger trigger, CancellationToken ct = default)
    {
        if (!await SingleFlight.WaitAsync(0, ct).ConfigureAwait(false))
        {
            _logger.LogWarning(
                "Pricing backfill requested (source={Source}) while another run is in progress.",
                trigger);
            throw new PricingBackfillInProgressException();
        }

        var sw = Stopwatch.StartNew();
        var runId = Guid.NewGuid();
        var now = _clock.GetUtcNow().UtcDateTime;
        var source = trigger == BackfillTrigger.Admin ? "admin" : "startup";
        var mode = _modeProvider.Mode == TammaMode.SaaS ? "saas" : "single-user";

        try
        {
            // Step 1: Detect prior completed run + already-complete state (AC9/AC10).
            var hasPriorCompleted = await _cp.PlatformEvents
                .AsNoTracking()
                .AnyAsync(e => e.Type == PricingBackfillEventTypes.Completed, ct)
                .ConfigureAwait(false);

            var activePlans = await _cp.Plans
                .Include(p => p.Entitlements)
                .Where(p => p.Status == "active")
                .ToListAsync(ct)
                .ConfigureAwait(false);

            var plansNeedingQuotas = activePlans
                .Where(p => p.Entitlements.Count == 0
                            && !string.IsNullOrWhiteSpace(p.Quotas)
                            && p.Quotas.Trim() != "{}")
                .ToList();

            var liveTenants = await _cp.Tenants
                .Where(t => t.DeletedAt == null)
                .ToListAsync(ct)
                .ConfigureAwait(false);

            var activeAssignmentTenantIds = (await _cp.TenantPlanAssignments
                .AsNoTracking()
                .Where(a => a.Status == "active")
                .Select(a => a.TenantId)
                .ToListAsync(ct)
                .ConfigureAwait(false))
                .ToHashSet();

            var tenantsNeedingAssignment = liveTenants
                .Where(t => !activeAssignmentTenantIds.Contains(t.Id))
                .ToList();

            if (hasPriorCompleted
                && plansNeedingQuotas.Count == 0
                && tenantsNeedingAssignment.Count == 0)
            {
                sw.Stop();
                await EmitAsync(
                    PricingBackfillEventTypes.Skipped,
                    new { runId = runId.ToString("D"), reason = "already_complete", source, mode },
                    new { runId, reason = "already_complete", skippedTenants = liveTenants.Count },
                    now,
                    ct).ConfigureAwait(false);

                _logger.LogInformation(
                    "Pricing backfill skipped (already complete) runId={RunId} source={Source}",
                    runId, source);

                return new BackfillReport(
                    RunId: runId,
                    PlansConverted: 0,
                    EntitlementsCreated: 0,
                    TenantsAssigned: 0,
                    SkippedTenants: liveTenants.Count,
                    WasNoOp: true,
                    DurationMs: sw.ElapsedMilliseconds);
            }

            // Emit STARTED once work begins (or initial verification run).
            await EmitAsync(
                PricingBackfillEventTypes.Started,
                new { runId = runId.ToString("D"), mode, source },
                new { runId, mode, source },
                now,
                ct).ConfigureAwait(false);

            _logger.LogInformation(
                "Pricing backfill started runId={RunId} source={Source} mode={Mode}",
                runId, source, mode);

            // Step 2: Convert legacy Plan.Quotas JSON -> PlanEntitlement (insert-missing-only, AC1).
            var plansConverted = 0;
            var entitlementsCreated = 0;

            foreach (var plan in plansNeedingQuotas)
            {
                var specs = LegacyQuotaMap.Parse(plan.Slug, plan.Quotas, _logger);
                if (specs.Count == 0)
                {
                    continue;
                }

                var addedForPlan = 0;
                foreach (var spec in specs)
                {
                    if (plan.Entitlements.Any(e => e.MetricKey == spec.MetricKey))
                    {
                        continue;
                    }

                    var row = new PlanEntitlement
                    {
                        Id = Guid.NewGuid(),
                        PlanId = plan.Id,
                        MetricKey = spec.MetricKey,
                        LimitValue = spec.LimitValue,
                        Period = spec.Period,
                        OverageMode = spec.OverageMode,
                    };
                    plan.Entitlements.Add(row);
                    _cp.PlanEntitlements.Add(row);
                    entitlementsCreated++;
                    addedForPlan++;
                }

                if (addedForPlan > 0)
                {
                    plansConverted++;
                    _logger.LogDebug(
                        "Converted legacy Plan.Quotas for slug={Slug} entitlements={Count}",
                        plan.Slug, addedForPlan);
                }
            }

            // Step 3: Create one active TenantPlanAssignment per unassigned non-deleted tenant (AC2).
            var allPlansById = (await _cp.Plans
                .AsNoTracking()
                .ToListAsync(ct)
                .ConfigureAwait(false))
                .ToDictionary(p => p.Id);

            var activePlansBySlug = activePlans
                .GroupBy(p => p.Slug, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(p => p.Version).First(), StringComparer.OrdinalIgnoreCase);

            activePlansBySlug.TryGetValue("free", out var freePlan);

            var tenantsAssigned = 0;
            foreach (var tenant in tenantsNeedingAssignment)
            {
                Plan? resolvedPlan = null;
                var resolvedFrom = "free";

                var shadowPlanId = _cp.Entry(tenant).Property<Guid?>("PlanId").CurrentValue;
                if (shadowPlanId is Guid pid && pid != Guid.Empty && allPlansById.TryGetValue(pid, out var byId))
                {
                    resolvedPlan = byId;
                    resolvedFrom = "planId";
                }
                else if (!string.IsNullOrWhiteSpace(tenant.Plan)
                         && activePlansBySlug.TryGetValue(tenant.Plan, out var bySlug))
                {
                    resolvedPlan = bySlug;
                    resolvedFrom = "slug";
                }
                else if (freePlan is not null)
                {
                    resolvedPlan = freePlan;
                    resolvedFrom = "free";
                }

                if (resolvedPlan is null)
                {
                    continue;
                }

                var assignment = new TenantPlanAssignment
                {
                    Id = Guid.NewGuid(),
                    TenantId = tenant.Id,
                    PlanId = resolvedPlan.Id,
                    PlanVersion = resolvedPlan.Version,
                    Status = "active",
                    EffectiveFrom = now,
                    EffectiveTo = null,
                    AssignedByUserId = null,
                    Reason = BackfillReason,
                    CreatedAt = now,
                    UpdatedAt = now,
                };
                _cp.TenantPlanAssignments.Add(assignment);

                // Keep lockstep shadow PlanId + Plan slug in sync.
                _cp.Entry(tenant).Property<Guid?>("PlanId").CurrentValue = resolvedPlan.Id;
                tenant.Plan = resolvedPlan.Slug;
                tenantsAssigned++;

                _logger.LogDebug(
                    "Backfilled active plan assignment tenantId={TenantId} planId={PlanId} planVersion={PlanVersion} source={Source}",
                    tenant.Id, resolvedPlan.Id, resolvedPlan.Version, resolvedFrom);
            }

            if (entitlementsCreated > 0 || tenantsAssigned > 0)
            {
                // Insert-missing-only backfill of typed PlanEntitlement rows onto an
                // already-active legacy plan (identical pattern to PlansSeeder.SeedAsync):
                // suppress the Story 34-1 immutability interceptor only for this save
                // when adding missing legacy entitlement rows.
                using var _ = entitlementsCreated > 0 ? _cp.SuppressPlanImmutabilityGuard() : null;
                await _cp.SaveChangesAsync(ct).ConfigureAwait(false);
            }

            // Step 4: Verify AC2 zero-unassigned-tenant invariant.
            var unassignedCount = await CountUnassignedLiveTenantsAsync(ct).ConfigureAwait(false);
            if (unassignedCount > 0)
            {
                _logger.LogError(
                    "{ErrorCode}: {Count} non-deleted tenant(s) still lack an active plan assignment after backfill runId={RunId}.",
                    IncompleteErrorCode, unassignedCount, runId);
                throw new TammaError(
                    IncompleteErrorCode,
                    $"Pricing backfill incomplete: {unassignedCount} non-deleted tenant(s) still lack an active plan assignment.",
                    new Dictionary<string, object?>
                    {
                        ["runId"] = runId.ToString("D"),
                        ["unassignedTenants"] = unassignedCount,
                    },
                    retryable: false,
                    severity: TammaErrorSeverity.Critical);
            }

            sw.Stop();
            var skippedTenants = liveTenants.Count - tenantsAssigned;
            await EmitAsync(
                PricingBackfillEventTypes.Completed,
                new
                {
                    runId = runId.ToString("D"),
                    plansConverted,
                    tenantsAssigned,
                    entitlementsCreated,
                    durationMs = sw.ElapsedMilliseconds,
                },
                new
                {
                    runId,
                    plansConverted,
                    entitlementsCreated,
                    tenantsAssigned,
                    skippedTenants,
                    durationMs = sw.ElapsedMilliseconds,
                },
                now,
                ct).ConfigureAwait(false);

            _logger.LogInformation(
                "Pricing backfill completed runId={RunId} plansConverted={PlansConverted} entitlementsCreated={EntitlementsCreated} tenantsAssigned={TenantsAssigned} durationMs={DurationMs}",
                runId, plansConverted, entitlementsCreated, tenantsAssigned, sw.ElapsedMilliseconds);

            return new BackfillReport(
                RunId: runId,
                PlansConverted: plansConverted,
                EntitlementsCreated: entitlementsCreated,
                TenantsAssigned: tenantsAssigned,
                SkippedTenants: skippedTenants,
                WasNoOp: false,
                DurationMs: sw.ElapsedMilliseconds);
        }
        finally
        {
            SingleFlight.Release();
        }
    }

    /// <summary>
    /// AC2 verification query: returns the count of non-deleted tenants that
    /// have no <c>active</c> <see cref="TenantPlanAssignment"/> row.
    /// </summary>
    public async Task<int> CountUnassignedLiveTenantsAsync(CancellationToken ct = default)
    {
        var activeSet = (await _cp.TenantPlanAssignments
            .AsNoTracking()
            .Where(a => a.Status == "active")
            .Select(a => a.TenantId)
            .ToListAsync(ct)
            .ConfigureAwait(false))
            .ToHashSet();

        var liveIds = await _cp.Tenants
            .AsNoTracking()
            .Where(t => t.DeletedAt == null)
            .Select(t => t.Id)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        return liveIds.Count(id => !activeSet.Contains(id));
    }

    private async Task EmitAsync(
        string type,
        object tags,
        object data,
        DateTime now,
        CancellationToken ct)
    {
        var evt = new PlatformEvent
        {
            Id = Guid.NewGuid(),
            Type = type,
            Tags = JsonSerializer.Serialize(tags),
            Metadata = SystemMetadata,
            Data = JsonSerializer.Serialize(data),
            CreatedAt = now,
        };
        await _events.AppendAndPublishAsync(evt, ct).ConfigureAwait(false);
    }
}
