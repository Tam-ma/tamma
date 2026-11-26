using Microsoft.EntityFrameworkCore;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-8 (AC2, AC4) — EF-backed control-plane invoice mirror and read
/// service. Upserts idempotently on <see cref="BillingInvoice.StripeInvoiceId"/>
/// so replayed webhooks never duplicate rows or re-emit finalized/paid DCB
/// events.
/// </summary>
public sealed class InvoiceService : IInvoiceService
{
    public const string LineKindBase = "base";
    public const string LineKindMeteredOverage = "metered_overage";
    public const string LineKindCredit = "credit";

    private static readonly HashSet<string> ValidStatuses = new(StringComparer.Ordinal)
    {
        "draft", "open", "paid", "uncollectible", "void",
    };

    private readonly ControlPlaneDbContext _cp;
    private readonly IEventRepository _events;
    private readonly TimeProvider _clock;
    private readonly ILogger<InvoiceService> _logger;

    public InvoiceService(
        ControlPlaneDbContext cp,
        IEventRepository events,
        TimeProvider clock,
        ILogger<InvoiceService> logger)
    {
        ArgumentNullException.ThrowIfNull(cp);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(logger);

        _cp = cp;
        _events = events;
        _clock = clock;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<BillingInvoice> ProjectAsync(
        Stripe.Invoice invoice, Guid tenantId, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        if (tenantId == Guid.Empty)
        {
            throw new ArgumentException("TenantId must be non-empty.", nameof(tenantId));
        }

        var now = _clock.GetUtcNow().UtcDateTime;
        var stripeId = string.IsNullOrWhiteSpace(invoice.Id) ? null : invoice.Id.Trim();
        var status = NormalizeStatus(invoice.Status);

        BillingInvoice? existing = null;
        if (stripeId is not null)
        {
            existing = await _cp.BillingInvoices
                .Include(i => i.Lines)
                .FirstOrDefaultAsync(i => i.StripeInvoiceId == stripeId, ct)
                .ConfigureAwait(false);
        }

        var previousStatus = existing?.Status;
        var hadFinalizedAt = existing?.FinalizedAt is not null;
        var hadPaidAt = existing?.PaidAt is not null;

        var periodStart = ToUtc(invoice.PeriodStart, now);
        var periodEnd = ToUtc(invoice.PeriodEnd, now);
        var subscriptionId = invoice.Parent?.SubscriptionDetails?.SubscriptionId
                             ?? invoice.Lines?.Data?.FirstOrDefault(l => !string.IsNullOrWhiteSpace(l.SubscriptionId))?.SubscriptionId;

        var finalizedAt = invoice.StatusTransitions?.FinalizedAt is DateTime fa && fa != default
            ? EnsureUtc(fa)
            : (status is "open" or "paid" or "uncollectible" or "void"
                ? existing?.FinalizedAt ?? now
                : existing?.FinalizedAt);

        var paidAt = invoice.StatusTransitions?.PaidAt is DateTime pa && pa != default
            ? EnsureUtc(pa)
            : (status == "paid" ? existing?.PaidAt ?? now : existing?.PaidAt);

        BillingInvoice entity;
        if (existing is null)
        {
            entity = new BillingInvoice
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                StripeInvoiceId = stripeId,
                StripeSubscriptionId = subscriptionId,
                Status = status,
                AmountDue = invoice.AmountDue,
                AmountPaid = invoice.AmountPaid,
                AmountRemaining = invoice.AmountRemaining,
                Currency = string.IsNullOrWhiteSpace(invoice.Currency) ? "usd" : invoice.Currency.ToLowerInvariant(),
                HostedInvoiceUrl = invoice.HostedInvoiceUrl,
                PdfUrl = invoice.InvoicePdf,
                PeriodStart = periodStart,
                PeriodEnd = periodEnd,
                AttemptCount = (int)Math.Clamp(invoice.AttemptCount, 0, int.MaxValue),
                NextPaymentAttempt = invoice.NextPaymentAttempt.HasValue ? EnsureUtc(invoice.NextPaymentAttempt.Value) : null,
                CreatedAt = invoice.Created != default ? EnsureUtc(invoice.Created) : now,
                UpdatedAt = now,
                FinalizedAt = finalizedAt,
                PaidAt = paidAt,
            };
            _cp.BillingInvoices.Add(entity);
        }
        else
        {
            entity = existing;
            entity.StripeSubscriptionId = subscriptionId ?? entity.StripeSubscriptionId;
            entity.Status = status;
            entity.AmountDue = invoice.AmountDue;
            entity.AmountPaid = invoice.AmountPaid;
            entity.AmountRemaining = invoice.AmountRemaining;
            if (!string.IsNullOrWhiteSpace(invoice.Currency))
            {
                entity.Currency = invoice.Currency.ToLowerInvariant();
            }
            if (!string.IsNullOrWhiteSpace(invoice.HostedInvoiceUrl))
            {
                entity.HostedInvoiceUrl = invoice.HostedInvoiceUrl;
            }
            if (!string.IsNullOrWhiteSpace(invoice.InvoicePdf))
            {
                entity.PdfUrl = invoice.InvoicePdf;
            }
            entity.PeriodStart = periodStart;
            entity.PeriodEnd = periodEnd;
            entity.AttemptCount = (int)Math.Clamp(invoice.AttemptCount, 0, int.MaxValue);
            entity.NextPaymentAttempt = invoice.NextPaymentAttempt.HasValue ? EnsureUtc(invoice.NextPaymentAttempt.Value) : null;
            entity.UpdatedAt = now;
            entity.FinalizedAt = finalizedAt;
            entity.PaidAt = paidAt;
        }

        // Replace mirrored line items cleanly whenever the Stripe payload supplies lines.
        if (invoice.Lines?.Data is { Count: > 0 } stripeLines)
        {
            if (entity.Lines.Count > 0)
            {
                _cp.BillingInvoiceLines.RemoveRange(entity.Lines);
                entity.Lines.Clear();
            }

            foreach (var line in stripeLines)
            {
                var kind = ClassifyLine(line);
                var qty = line.Quantity ?? 1L;
                var unitAmount = ResolveUnitAmount(line, qty);

                var row = new BillingInvoiceLine
                {
                    Id = Guid.NewGuid(),
                    InvoiceId = entity.Id,
                    Kind = kind,
                    Description = line.Description ?? string.Empty,
                    Quantity = qty,
                    UnitAmount = unitAmount,
                    Amount = line.Amount,
                    Currency = string.IsNullOrWhiteSpace(line.Currency) ? entity.Currency : line.Currency.ToLowerInvariant(),
                };
                entity.Lines.Add(row);
                _cp.BillingInvoiceLines.Add(row);
            }
        }

        await _cp.SaveChangesAsync(ct).ConfigureAwait(false);

        _logger.LogInformation(
            "Projected billing invoice invoiceId={InvoiceId} tenantId={TenantId} stripeInvoiceId={StripeInvoiceId} status={Status} lineCount={LineCount}",
            entity.Id, tenantId, stripeId, entity.Status, entity.Lines.Count);

        // Emit DCB events only on genuine state transitions (idempotent on replay).
        var becameFinalized = !hadFinalizedAt && entity.FinalizedAt is not null && status != "draft";
        if (becameFinalized)
        {
            await _events.AppendAsync(BillingInvoiceEvents.Build(
                BillingInvoiceEvents.InvoiceFinalized,
                tenantId,
                entity.Id,
                entity.StripeInvoiceId,
                stage: status,
                attemptCount: entity.AttemptCount,
                data: new
                {
                    invoiceId = entity.Id,
                    stripeInvoiceId = entity.StripeInvoiceId,
                    status = entity.Status,
                    amountDue = entity.AmountDue,
                    currency = entity.Currency,
                    lineCount = entity.Lines.Count,
                },
                occurredAtUtc: now)).ConfigureAwait(false);
        }

        var becamePaid = status == "paid" && (!hadPaidAt || !string.Equals(previousStatus, "paid", StringComparison.Ordinal));
        if (becamePaid)
        {
            await _events.AppendAsync(BillingInvoiceEvents.Build(
                BillingInvoiceEvents.InvoicePaid,
                tenantId,
                entity.Id,
                entity.StripeInvoiceId,
                stage: "paid",
                attemptCount: entity.AttemptCount,
                data: new
                {
                    invoiceId = entity.Id,
                    stripeInvoiceId = entity.StripeInvoiceId,
                    amountPaid = entity.AmountPaid,
                    currency = entity.Currency,
                },
                occurredAtUtc: now)).ConfigureAwait(false);
        }

        return entity;
    }

    /// <inheritdoc />
    public async Task<(IReadOnlyList<BillingInvoice> Items, int Total)> ListAsync(
        Guid tenantId, int limit = 50, int offset = 0, CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty)
        {
            return ([], 0);
        }

        var clampedLimit = Math.Clamp(limit, 1, 200);
        var clampedOffset = Math.Max(0, offset);

        var query = _cp.BillingInvoices
            .AsNoTracking()
            .Where(i => i.TenantId == tenantId);

        var total = await query.CountAsync(ct).ConfigureAwait(false);
        var items = await query
            .OrderByDescending(i => i.CreatedAt)
            .ThenByDescending(i => i.Id)
            .Skip(clampedOffset)
            .Take(clampedLimit)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        return (items, total);
    }

    /// <inheritdoc />
    public async Task<BillingInvoice?> GetAsync(
        Guid tenantId, Guid invoiceId, CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty || invoiceId == Guid.Empty)
        {
            return null;
        }

        return await _cp.BillingInvoices
            .AsNoTracking()
            .Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.TenantId == tenantId && i.Id == invoiceId, ct)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Pure helper (Story 35-8 AC2) classifying a Stripe invoice line into
    /// <c>credit</c>, <c>metered_overage</c>, or <c>base</c>. Negative amounts
    /// ALWAYS win for <c>credit</c> even when attached to a base price id.
    /// </summary>
    public static string ClassifyLine(Stripe.InvoiceLineItem line)
    {
        ArgumentNullException.ThrowIfNull(line);

        // 1. Negative amount or credit/discount metadata always wins as credit.
        if (line.Amount < 0)
        {
            return LineKindCredit;
        }

        if (line.Metadata is not null)
        {
            if (HasTruthyMeta(line.Metadata, "tamma_credit")
                || HasTruthyMeta(line.Metadata, "credit_note")
                || (line.Metadata.TryGetValue("kind", out var metaKind)
                    && string.Equals(metaKind, LineKindCredit, StringComparison.OrdinalIgnoreCase)))
            {
                return LineKindCredit;
            }

            if (HasTruthyMeta(line.Metadata, "tamma_meter")
                || HasTruthyMeta(line.Metadata, "metered_overage")
                || (line.Metadata.TryGetValue("usage_type", out var usageType)
                    && string.Equals(usageType, "metered", StringComparison.OrdinalIgnoreCase))
                || (line.Metadata.TryGetValue("kind", out var meterKind)
                    && string.Equals(meterKind, LineKindMeteredOverage, StringComparison.OrdinalIgnoreCase)))
            {
                return LineKindMeteredOverage;
            }
        }

        if (!string.IsNullOrWhiteSpace(line.Description)
            && (line.Description.Contains("credit", StringComparison.OrdinalIgnoreCase)
                || line.Description.Contains("discount", StringComparison.OrdinalIgnoreCase)))
        {
            if (line.Amount <= 0)
            {
                return LineKindCredit;
            }
        }

        var price = line.Pricing?.PriceDetails?.Price;
        if (price is not null)
        {
            if (string.Equals(price.Recurring?.UsageType, "metered", StringComparison.OrdinalIgnoreCase))
            {
                return LineKindMeteredOverage;
            }

            if (!string.IsNullOrWhiteSpace(price.Id)
                && (price.Id.Contains("meter", StringComparison.OrdinalIgnoreCase)
                    || price.Id.Contains("overage", StringComparison.OrdinalIgnoreCase)
                    || price.Id.Contains("tokens", StringComparison.OrdinalIgnoreCase)))
            {
                return LineKindMeteredOverage;
            }
        }

        return LineKindBase;
    }

    private static long ResolveUnitAmount(Stripe.InvoiceLineItem line, long quantity)
    {
        if (line.Pricing?.UnitAmountDecimal is decimal unitDec)
        {
            return (long)Math.Round(unitDec, MidpointRounding.AwayFromZero);
        }

        return quantity > 0 ? line.Amount / quantity : line.Amount;
    }

    private static bool HasTruthyMeta(IDictionary<string, string> meta, string key) =>
        meta.TryGetValue(key, out var val)
        && (string.Equals(val, "true", StringComparison.OrdinalIgnoreCase)
            || string.Equals(val, "1", StringComparison.Ordinal));

    private static string NormalizeStatus(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "draft";
        var lower = raw.Trim().ToLowerInvariant();
        return ValidStatuses.Contains(lower) ? lower : "open";
    }

    private static DateTime ToUtc(DateTime dt, DateTime fallback) =>
        dt == default ? fallback : EnsureUtc(dt);

    private static DateTime EnsureUtc(DateTime dt) =>
        dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
}
