namespace Tamma.Data.Entities;

/// <summary>
/// Story 35-8 (AC8) — one-per-tenant control-plane dunning and billing
/// suspension state. Written by <c>DunningStateMachine</c> and read by Story
/// 35-6's <c>QuotaService</c> to hard-block platform-provided usage when
/// <see cref="Stage"/> is <c>suspended</c> (BYOK token calls remain exempt).
/// </summary>
public class BillingDunningState
{
    public Guid Id { get; set; }

    /// <summary>Owning tenant (UNIQUE FK <c>tenants.Id</c>).</summary>
    public Guid TenantId { get; set; }

    /// <summary>
    /// Current dunning stage: <c>active | past_due | grace | suspended | flagged</c>
    /// (enforced by <c>ck_billing_dunning_states_stage</c>).
    /// </summary>
    public string Stage { get; set; } = "active";

    /// <summary>Cumulative failed payment attempts for the current dunning episode.</summary>
    public int FailedAttempts { get; set; }

    /// <summary>The <see cref="BillingInvoice.Id"/> currently driving dunning, if any.</summary>
    public Guid? CurrentInvoiceId { get; set; }

    /// <summary>
    /// Last Stripe <c>AttemptCount</c> observed for <see cref="CurrentInvoiceId"/>
    /// so replayed <c>invoice.payment_failed</c> webhooks do not double-advance.
    /// </summary>
    public int LastObservedAttemptCount { get; set; }

    /// <summary>UTC timestamp when the tenant entered the current <see cref="Stage"/>.</summary>
    public DateTime? StageEnteredAt { get; set; }

    /// <summary>UTC timestamp when the scheduled <c>billing.dunning.advance</c> task should fire.</summary>
    public DateTime? NextAdvanceAt { get; set; }

    /// <summary>
    /// Pending <see cref="PlatformQueuedTask.Id"/> for <c>billing.dunning.advance</c>
    /// to cancel on payment recovery.
    /// </summary>
    public Guid? PendingAdvanceTaskId { get; set; }

    /// <summary>UTC timestamp when the tenant entered <c>suspended</c>, or null when active.</summary>
    public DateTime? SuspendedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    // Navigation
    public Tenant Tenant { get; set; } = null!;
}
