using Tamma.Data.Entities;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-8 (AC2, AC4) — projects Stripe invoice payloads into the control-plane
/// <see cref="BillingInvoice"/> + <see cref="BillingInvoiceLine"/> mirror idempotently
/// and serves tenant-scoped read queries for the invoice history API.
/// </summary>
public interface IInvoiceService
{
    /// <summary>
    /// Idempotent upsert of a Stripe invoice into the control-plane mirror,
    /// classifying line items into <c>base | metered_overage | credit</c> and
    /// emitting <c>BILLING.INVOICE.FINALIZED</c> / <c>BILLING.INVOICE.PAID</c>
    /// on status transitions.
    /// </summary>
    Task<BillingInvoice> ProjectAsync(Stripe.Invoice invoice, Guid tenantId, CancellationToken ct = default);

    /// <summary>
    /// Paged newest-first list of invoices strictly scoped to <paramref name="tenantId"/>.
    /// </summary>
    Task<(IReadOnlyList<BillingInvoice> Items, int Total)> ListAsync(
        Guid tenantId, int limit = 50, int offset = 0, CancellationToken ct = default);

    /// <summary>
    /// Single invoice with its <see cref="BillingInvoice.Lines"/>, strictly scoped
    /// to <paramref name="tenantId"/> (returns <c>null</c> for foreign/unknown ids).
    /// </summary>
    Task<BillingInvoice?> GetAsync(Guid tenantId, Guid invoiceId, CancellationToken ct = default);
}
