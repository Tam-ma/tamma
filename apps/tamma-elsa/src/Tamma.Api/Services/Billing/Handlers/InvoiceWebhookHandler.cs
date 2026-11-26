using System.Text.Json;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Billing.Handlers;

/// <summary>
/// Story 35-5 / Story 35-8 (AC2, AC3, AC5, AC6) — invoice lifecycle webhook
/// handler. When <see cref="IInvoiceService"/> and <see cref="IDunningStateMachine"/>
/// are wired (SaaS runtime), projects <c>Stripe.Invoice</c> payloads idempotently
/// into <c>billing_invoices</c> / <c>billing_invoice_lines</c>, drives payment
/// failure dunning (<c>invoice.payment_failed</c>) and payment recovery
/// (<c>invoice.paid</c>), and still returns a fast-ack <see cref="BillingFollowup"/>
/// on <c>invoice.payment_failed</c>.
///
/// <para>When constructed with only <see cref="IEventRepository"/> (Story 35-5
/// unit tests), falls back to the lightweight audit-only DCB emission.</para>
/// </summary>
public sealed class InvoiceWebhookHandler : IBillingEventHandler
{
    private readonly IEventRepository _events;
    private readonly IInvoiceService? _invoiceService;
    private readonly IDunningStateMachine? _dunning;

    public InvoiceWebhookHandler(
        IEventRepository events,
        IInvoiceService? invoiceService = null,
        IDunningStateMachine? dunning = null)
    {
        ArgumentNullException.ThrowIfNull(events);
        _events = events;
        _invoiceService = invoiceService;
        _dunning = dunning;
    }

    public IReadOnlyCollection<string> HandledEventTypes => new[]
    {
        BillingWebhookEventTypes.InvoiceCreated,
        BillingWebhookEventTypes.InvoiceFinalized,
        BillingWebhookEventTypes.InvoicePaid,
        BillingWebhookEventTypes.InvoicePaymentFailed,
    };

    public async Task<BillingFollowup?> HandleAsync(BillingWebhookContext ctx, CancellationToken ct)
    {
        // Story 35-8 full projection + dunning path when services are wired and
        // the Stripe event carries a typed Stripe.Invoice payload.
        if (_invoiceService is not null && ctx.StripeEvent?.Data?.Object is Stripe.Invoice stripeInvoice)
        {
            var projected = await _invoiceService
                .ProjectAsync(stripeInvoice, ctx.TenantId, ct)
                .ConfigureAwait(false);

            if (ctx.EventType == BillingWebhookEventTypes.InvoiceCreated)
            {
                await _events.AppendAsync(
                    BillingWebhookDcbEvents.Projection(BillingWebhookEventTypes.DcbInvoiceCreated, ctx))
                    .ConfigureAwait(false);
            }
            else if (ctx.EventType == BillingWebhookEventTypes.InvoicePaid && _dunning is not null)
            {
                await _dunning.OnPaymentRecoveredAsync(ctx.TenantId, projected, ct).ConfigureAwait(false);
            }
            else if (ctx.EventType == BillingWebhookEventTypes.InvoicePaymentFailed && _dunning is not null)
            {
                await _dunning.OnPaymentFailedAsync(ctx.TenantId, projected, ct).ConfigureAwait(false);
                return new BillingFollowup(
                    DunningAdvanceTaskHandler.TaskTypeName,
                    JsonSerializer.Serialize(new
                    {
                        reason = "invoice_payment_failed",
                        tenantId = ctx.TenantId,
                        invoiceId = projected.Id,
                        stripeEventId = ctx.StripeEventId,
                        stripeObjectId = ctx.StripeObjectId,
                    }));
            }

            return null;
        }

        // Story 35-5 fallback path (when unit tests instantiate handler with events only).
        var dcbType = ctx.EventType switch
        {
            BillingWebhookEventTypes.InvoiceCreated => BillingWebhookEventTypes.DcbInvoiceCreated,
            BillingWebhookEventTypes.InvoiceFinalized => BillingWebhookEventTypes.DcbInvoiceFinalized,
            BillingWebhookEventTypes.InvoicePaid => BillingWebhookEventTypes.DcbInvoicePaid,
            BillingWebhookEventTypes.InvoicePaymentFailed => BillingWebhookEventTypes.DcbInvoicePaymentFailed,
            _ => throw new InvalidOperationException(
                $"InvoiceWebhookHandler received unclaimed type '{ctx.EventType}'."),
        };

        await _events.AppendAsync(BillingWebhookDcbEvents.Projection(dcbType, ctx))
            .ConfigureAwait(false);

        if (ctx.EventType == BillingWebhookEventTypes.InvoicePaymentFailed)
        {
            return new BillingFollowup(
                "invoice.payment_failed",
                JsonSerializer.Serialize(new
                {
                    reason = "invoice_payment_failed",
                    stripeEventId = ctx.StripeEventId,
                    stripeObjectId = ctx.StripeObjectId,
                }));
        }

        return null;
    }
}
