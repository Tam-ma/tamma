namespace Tamma.Api.Services.Pricing;

/// <summary>
/// Story 34-10 (AC1, AC2, AC9, AC10) — re-runnable, idempotent backfill
/// converting legacy <c>Plan.Quotas</c> JSON into structured
/// <c>PlanEntitlement</c> rows and guaranteeing every non-deleted tenant has
/// exactly one <c>active</c> <c>TenantPlanAssignment</c>.
/// </summary>
public interface IPricingBackfillService
{
    /// <summary>
    /// Run the insert-missing-only backfill. A second invocation when already
    /// complete emits <c>PRICING.BACKFILL.SKIPPED</c> and returns
    /// <see cref="BackfillReport.WasNoOp"/> = <c>true</c>.
    /// Throws <see cref="PricingBackfillInProgressException"/> if another run is
    /// currently executing in-process.
    /// </summary>
    Task<BackfillReport> RunAsync(BackfillTrigger trigger, CancellationToken ct = default);
}

/// <summary>
/// Raised when an admin or startup backfill collides with an already-running
/// backfill (maps to HTTP 409 <c>backfill_in_progress</c>).
/// </summary>
public sealed class PricingBackfillInProgressException()
    : InvalidOperationException("A pricing backfill run is already in progress.");
