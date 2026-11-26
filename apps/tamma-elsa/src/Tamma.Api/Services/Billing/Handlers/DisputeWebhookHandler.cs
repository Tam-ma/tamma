using System.Text.Json;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Billing.Handlers;

/// <summary>
/// Story 35-5 / Story 35-8 (AC11) — handler for <c>charge.dispute.created</c>.
/// When <see cref="IDunningStateMachine"/> is wired (SaaS runtime), flips the
/// tenant's <c>BillingDunningState</c> to <c>flagged</c> (never auto-suspending),
/// marks the affected invoice disputed, emits <c>BILLING.INVOICE.DISPUTED</c>,
/// and enqueues a <c>dispute-opened</c> admin notification to
/// <c>PlatformEmailOutbox</c>. Always returns a fast-ack <see cref="BillingFollowup"/>.
/// </summary>
public sealed class DisputeWebhookHandler : IBillingEventHandler
{
    private readonly IEventRepository _events;
    private readonly IDunningStateMachine? _dunning;

    public DisputeWebhookHandler(
        IEventRepository events,
        IDunningStateMachine? dunning = null)
    {
        ArgumentNullException.ThrowIfNull(events);
        _events = events;
        _dunning = dunning;
    }

    public IReadOnlyCollection<string> HandledEventTypes => new[]
    {
        BillingWebhookEventTypes.ChargeDisputeCreated,
    };

    public async Task<BillingFollowup?> HandleAsync(BillingWebhookContext ctx, CancellationToken ct)
    {
        if (_dunning is not null)
        {
            var dispute = ctx.StripeEvent?.Data?.Object as Stripe.Dispute;
            var disputeId = dispute?.Id ?? ctx.StripeObjectId;
            var reason = dispute?.Reason;
            string? stripeInvoiceId = null;
            if (dispute?.Metadata is not null && dispute.Metadata.TryGetValue("stripeInvoiceId", out var metaInv))
            {
                stripeInvoiceId = metaInv;
            }
            stripeInvoiceId ??= TryExtractInvoiceId(ctx.RawPayload);

            await _dunning
                .OnDisputeCreatedAsync(ctx.TenantId, disputeId, stripeInvoiceId, reason, ct)
                .ConfigureAwait(false);
        }
        else
        {
            await _events.AppendAsync(
                BillingWebhookDcbEvents.Projection(BillingWebhookEventTypes.DcbDisputeOpened, ctx))
                .ConfigureAwait(false);
        }

        return new BillingFollowup(
            "charge.dispute.created",
            JsonSerializer.Serialize(new
            {
                reason = "dispute_opened",
                stripeEventId = ctx.StripeEventId,
                stripeObjectId = ctx.StripeObjectId,
            }));
    }

    private static string? TryExtractInvoiceId(string? rawPayload)
    {
        if (string.IsNullOrWhiteSpace(rawPayload)) return null;
        try
        {
            using var doc = JsonDocument.Parse(rawPayload);
            if (doc.RootElement.TryGetProperty("data", out var data)
                && data.TryGetProperty("object", out var obj))
            {
                if (obj.TryGetProperty("invoice", out var inv) && inv.ValueKind == JsonValueKind.String)
                {
                    return inv.GetString();
                }
                if (obj.TryGetProperty("metadata", out var meta)
                    && meta.TryGetProperty("stripeInvoiceId", out var metaInv)
                    && metaInv.ValueKind == JsonValueKind.String)
                {
                    return metaInv.GetString();
                }
            }
        }
        catch (JsonException)
        {
            // Ignore malformed JSON; caller proceeds without invoice id.
        }
        return null;
    }
}
