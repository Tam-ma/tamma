using Tamma.Data.Entities;

namespace Tamma.Api.Services.Billing;

/// <summary>Canonical wire values for <see cref="BillingDunningState.Stage"/>.</summary>
public static class DunningStages
{
    public const string Active = "active";
    public const string PastDue = "past_due";
    public const string Grace = "grace";
    public const string Suspended = "suspended";
    public const string Flagged = "flagged";
}

/// <summary>
/// Story 35-8 (AC5, AC12) — output of the pure <see cref="IDunningStateMachine.Next"/>
/// transition function.
/// </summary>
public sealed record DunningTransition(
    string NextStage,
    TimeSpan? DelayUntilNext,
    bool Suspend);

/// <summary>
/// Story 35-8 (AC5–AC12) — manages a tenant's failed-payment dunning lifecycle
/// (<c>active → past_due → grace → suspended</c>), payment recovery back to
/// <c>active</c> (including from <c>suspended</c>), and dispute flagging.
/// </summary>
public interface IDunningStateMachine
{
    /// <summary>
    /// Pure, clock-free transition rule given current stage, cumulative failed
    /// attempts, and configured schedule.
    /// </summary>
    DunningTransition Next(string currentStage, int failedAttempts, DunningOptions opts);

    /// <summary>
    /// Apply an <c>invoice.payment_failed</c> event: idempotently bump attempts,
    /// advance stage, schedule <c>billing.dunning.advance</c>, enqueue stage
    /// email into the outbox, and emit <c>BILLING.PAYMENT.FAILED</c> +
    /// <c>BILLING.DUNNING.ESCALATED</c>.
    /// </summary>
    Task<BillingDunningState> OnPaymentFailedAsync(
        Guid tenantId, BillingInvoice invoice, CancellationToken ct = default);

    /// <summary>
    /// Apply a payment recovery (<c>invoice.paid</c>): reset to <c>active</c>,
    /// cancel pending advance task, invalidate quota cache, enqueue
    /// <c>dunning-recovered</c> email, and emit <c>BILLING.TENANT.REINSTATED</c>.
    /// </summary>
    Task<BillingDunningState> OnPaymentRecoveredAsync(
        Guid tenantId, BillingInvoice invoice, CancellationToken ct = default);

    /// <summary>
    /// Advance one scheduled step (invoked by <see cref="DunningAdvanceTaskHandler"/>
    /// when <see cref="BillingDunningState.NextAdvanceAt"/> fires).
    /// </summary>
    Task<BillingDunningState?> AdvanceAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>
    /// Apply a <c>charge.dispute.created</c> event: flip the tenant to
    /// <c>flagged</c> (never auto-suspend), mark the matching invoice disputed,
    /// emit <c>BILLING.INVOICE.DISPUTED</c>, and enqueue a platform-admin
    /// <c>dispute-opened</c> outbox email.
    /// </summary>
    Task<BillingDunningState> OnDisputeCreatedAsync(
        Guid tenantId,
        string? stripeDisputeId,
        string? stripeInvoiceId,
        string? reason,
        CancellationToken ct = default);

    /// <summary>Read the tenant's current dunning state, if any.</summary>
    Task<BillingDunningState?> GetStateAsync(Guid tenantId, CancellationToken ct = default);
}
