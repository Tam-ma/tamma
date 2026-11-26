namespace Tamma.Data.Entities;

/// <summary>
/// Story 35-8 (AC1) — one line item on a mirrored <see cref="BillingInvoice"/>,
/// classified into <c>base</c>, <c>metered_overage</c>, or <c>credit</c>.
/// Amounts are stored in minor units (<c>long</c> cents; negative for credits).
/// </summary>
public class BillingInvoiceLine
{
    public Guid Id { get; set; }

    /// <summary>Parent invoice (FK <c>billing_invoices.Id</c>, cascade delete).</summary>
    public Guid InvoiceId { get; set; }

    /// <summary>
    /// Line classification: <c>base | metered_overage | credit</c>
    /// (enforced by <c>ck_billing_invoice_lines_kind</c>).
    /// </summary>
    public string Kind { get; set; } = "base";

    public string Description { get; set; } = string.Empty;

    public long Quantity { get; set; }

    /// <summary>Unit price in minor units (cents).</summary>
    public long UnitAmount { get; set; }

    /// <summary>Line total in minor units (cents; negative for credits).</summary>
    public long Amount { get; set; }

    public string Currency { get; set; } = "usd";

    // Navigation
    public BillingInvoice Invoice { get; set; } = null!;
}
