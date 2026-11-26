using System.Text.Json;
using Tamma.Data.Entities;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-8 (AC10) — canonical 3-segment DCB event-type constants and
/// builders for invoice projection, failed-payment dunning, suspension,
/// reinstatement, and disputes. All constants strictly satisfy the
/// <c>AGGREGATE.ACTION.STATUS</c> naming ratchet.
/// </summary>
public static class BillingInvoiceEvents
{
    public const string InvoiceFinalized = "BILLING.INVOICE.FINALIZED";
    public const string InvoicePaid = "BILLING.INVOICE.PAID";
    public const string InvoiceDisputed = "BILLING.INVOICE.DISPUTED";
    public const string PaymentFailed = "BILLING.PAYMENT.FAILED";
    public const string DunningEscalated = "BILLING.DUNNING.ESCALATED";
    public const string TenantSuspended = "BILLING.TENANT.SUSPENDED";
    public const string TenantReinstated = "BILLING.TENANT.REINSTATED";

    private const string SystemMetadata =
        """{"workflowVersion":"1.0.0","eventSource":"system"}""";

    public static DomainEvent Build(
        string type,
        Guid tenantId,
        Guid? invoiceId,
        string? stripeInvoiceId,
        string stage,
        int? attemptCount,
        object data,
        DateTime occurredAtUtc) =>
        new()
        {
            Id = Guid.NewGuid(),
            Type = type,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(new
            {
                tenantId = tenantId.ToString("D"),
                invoiceId = invoiceId?.ToString("D"),
                stage,
                stripeInvoiceId,
                attemptCount,
            }),
            Metadata = SystemMetadata,
            Data = JsonSerializer.Serialize(data),
            CreatedAt = occurredAtUtc,
        };
}
