namespace Tamma.Data.Entities;

/// <summary>
/// Story 35-8 (AC1) — control-plane mirror of a Stripe invoice for a tenant.
/// Upserted idempotently by <see cref="StripeInvoiceId"/> via
/// <c>InvoiceService.ProjectAsync</c>. All monetary amounts are stored in minor
/// units (<c>long</c> cents) exactly as Stripe returns them.
/// </summary>
public class BillingInvoice
{
    public Guid Id { get; set; }

    /// <summary>Owning tenant (FK <c>tenants.Id</c>).</summary>
    public Guid TenantId { get; set; }

    /// <summary>Stripe invoice id (<c>in_...</c>); unique when non-null.</summary>
    public string? StripeInvoiceId { get; set; }

    /// <summary>Stripe subscription id (<c>sub_...</c>) if tied to a subscription.</summary>
    public string? StripeSubscriptionId { get; set; }

    /// <summary>
    /// Invoice lifecycle status: <c>draft | open | paid | uncollectible | void</c>
    /// (enforced by <c>ck_billing_invoices_status</c>).
    /// </summary>
    public string Status { get; set; } = "draft";

    /// <summary>Total amount due in minor units (cents).</summary>
    public long AmountDue { get; set; }

    /// <summary>Total amount paid in minor units (cents).</summary>
    public long AmountPaid { get; set; }

    /// <summary>Remaining unpaid balance in minor units (cents).</summary>
    public long AmountRemaining { get; set; }

    /// <summary>ISO 4217 lowercase currency code (default <c>usd</c>).</summary>
    public string Currency { get; set; } = "usd";

    /// <summary>Stripe hosted invoice view URL (sensitive token — never log).</summary>
    public string? HostedInvoiceUrl { get; set; }

    /// <summary>Stripe downloadable PDF URL (sensitive token — never log).</summary>
    public string? PdfUrl { get; set; }

    public DateTime PeriodStart { get; set; }
    public DateTime PeriodEnd { get; set; }

    /// <summary>Number of payment attempts Stripe has recorded for this invoice.</summary>
    public int AttemptCount { get; set; }

    /// <summary>Next scheduled payment retry timestamp, if unpaid.</summary>
    public DateTime? NextPaymentAttempt { get; set; }

    /// <summary>True when a chargeback/dispute has been opened against this invoice (AC11).</summary>
    public bool IsDisputed { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? FinalizedAt { get; set; }
    public DateTime? PaidAt { get; set; }

    // Navigation
    public Tenant Tenant { get; set; } = null!;
    public ICollection<BillingInvoiceLine> Lines { get; set; } = [];
}
