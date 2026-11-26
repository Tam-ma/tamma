using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Tamma.Api.Services.Pricing;
using Tamma.Core.Enums;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-3 — control-plane usage metering service.
///
/// <para><b>Boundary contract:</b></para>
/// <list type="bullet">
///   <item>Consumes <c>billing_mode</c>-tagged <c>LLM.CALL.SUCCESS</c> facts
///     (Story 35-2 / 32-9) and CP <see cref="PlatformAnalyticsHourly"/> fallback
///     rows.</item>
///   <item>Delegates ALL cost→sell markup math exclusively to Story 34-5's
///     <see cref="IUsagePricingEngine.PriceUsage"/> +
///     <see cref="IMarginPolicyResolver"/> — ZERO margin math lives here.</item>
///   <item>BYOK usage increments <c>ByokInputTokens</c>/<c>ByokOutputTokens</c>
///     on <see cref="BillingUsageRollup"/> and is EXPLICITLY SKIPPED when
///     buffering Stripe token meter events.</item>
///   <item>Fail-open for billing: <see cref="UpsertRollupAsync"/> and
///     <see cref="BufferMeterEventsAsync"/> log and swallow failures so billing
///     errors never block LLM calls or tenant workflows.</item>
/// </list>
/// </summary>
public sealed class UsageMeteringService : IUsageMeteringService
{
    private const int EventPageSize = 500;

    private readonly ControlPlaneDbContext _cp;
    private readonly IEventRepository _events;
    private readonly IUsagePricingEngine _pricingEngine;
    private readonly IMarginPolicyResolver _marginResolver;
    private readonly IBillingProvider _billing;
    private readonly TimeProvider _clock;
    private readonly ILogger<UsageMeteringService> _logger;

    public UsageMeteringService(
        ControlPlaneDbContext cp,
        IEventRepository events,
        IUsagePricingEngine pricingEngine,
        IMarginPolicyResolver marginResolver,
        IBillingProvider billing,
        TimeProvider clock,
        ILogger<UsageMeteringService> logger)
    {
        ArgumentNullException.ThrowIfNull(cp);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(pricingEngine);
        ArgumentNullException.ThrowIfNull(marginResolver);
        ArgumentNullException.ThrowIfNull(billing);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(logger);

        _cp = cp;
        _events = events;
        _pricingEngine = pricingEngine;
        _marginResolver = marginResolver;
        _billing = billing;
        _clock = clock;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task UpsertRollupAsync(
        Guid tenantId, BillingPeriod period, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(period);
        if (!_billing.IsEnabled || tenantId == Guid.Empty)
        {
            return;
        }

        var periodStart = EnsureUtc(period.StartUtc);
        var periodEnd = EnsureUtc(period.EndUtc);

        try
        {
            var customer = await _cp.BillingCustomers
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.TenantId == tenantId, ct)
                .ConfigureAwait(false);
            if (customer is null)
            {
                _logger.LogDebug(
                    "Skipping usage rollup for tenant {TenantId}: no BillingCustomer row.",
                    tenantId);
                return;
            }

            var subscription = await FindActiveSubscriptionAsync(tenantId, ct)
                .ConfigureAwait(false);
            var planSlug = subscription?.PlanSlug;
            var seats = subscription?.Seats ?? await CountActiveSeatsAsync(tenantId, ct).ConfigureAwait(false);

            var aggregation = await AggregateFactsAsync(
                tenantId, planSlug, periodStart, periodEnd, ct).ConfigureAwait(false);

            var now = _clock.GetUtcNow().UtcDateTime;
            var roundedCost = Math.Round(aggregation.PlatformCostUsd, 4, MidpointRounding.ToEven);
            var roundedBillable = Math.Round(aggregation.BillableAmountUsd, 4, MidpointRounding.ToEven);

            var existing = await _cp.BillingUsageRollups
                .FirstOrDefaultAsync(
                    r => r.TenantId == tenantId && r.PeriodStart == periodStart, ct)
                .ConfigureAwait(false);

            if (existing is null)
            {
                _cp.BillingUsageRollups.Add(new BillingUsageRollup
                {
                    Id = Guid.NewGuid(),
                    TenantId = tenantId,
                    PeriodStart = periodStart,
                    PeriodEnd = periodEnd,
                    PlatformInputTokens = aggregation.PlatformInputTokens,
                    PlatformOutputTokens = aggregation.PlatformOutputTokens,
                    ByokInputTokens = aggregation.ByokInputTokens,
                    ByokOutputTokens = aggregation.ByokOutputTokens,
                    PlatformCostUsd = roundedCost,
                    BillableAmountUsd = roundedBillable,
                    Seats = seats,
                    LastSourceCursor = aggregation.LastSourceCursor,
                    UpdatedAt = now,
                });
            }
            else
            {
                existing.PeriodEnd = periodEnd;
                existing.PlatformInputTokens = aggregation.PlatformInputTokens;
                existing.PlatformOutputTokens = aggregation.PlatformOutputTokens;
                existing.ByokInputTokens = aggregation.ByokInputTokens;
                existing.ByokOutputTokens = aggregation.ByokOutputTokens;
                existing.PlatformCostUsd = roundedCost;
                existing.BillableAmountUsd = roundedBillable;
                existing.Seats = seats;
                existing.LastSourceCursor = aggregation.LastSourceCursor;
                existing.UpdatedAt = now;
            }

            await _cp.SaveChangesAsync(ct).ConfigureAwait(false);

            await _events.AppendAsync(BillingMeterEventTypes.Recorded(
                tenantId,
                periodStart,
                customer.StripeCustomerId,
                billingMode: null,
                aggregation.PlatformInputTokens,
                aggregation.PlatformOutputTokens,
                aggregation.ByokInputTokens,
                aggregation.ByokOutputTokens,
                roundedCost,
                roundedBillable,
                now)).ConfigureAwait(false);

            _logger.LogInformation(
                "Billing usage rollup upserted: tenantId={TenantId} periodStart={PeriodStart} "
                + "platformTokens={PlatformTokens} byokTokens={ByokTokens} billableUsd={BillableUsd}",
                tenantId,
                periodStart,
                aggregation.PlatformInputTokens + aggregation.PlatformOutputTokens,
                aggregation.ByokInputTokens + aggregation.ByokOutputTokens,
                roundedBillable);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // AC11 — fail-open for billing: log for visibility and swallow so
            // usage metering never blocks workflows or the LLM call path.
            _logger.LogError(
                ex,
                "Failed to recompute billing usage rollup for tenantId={TenantId} periodStart={PeriodStart}; swallowing (fail-open).",
                tenantId, periodStart);
        }
    }

    /// <inheritdoc />
    public async Task<UsageSummaryDto> GetCurrentUsageAsync(
        Guid tenantId, CancellationToken ct = default)
    {
        var now = _clock.GetUtcNow().UtcDateTime;
        var subscription = await FindActiveSubscriptionAsync(tenantId, ct)
            .ConfigureAwait(false);

        var period = ResolveCurrentPeriod(subscription, now);

        var rollup = await _cp.BillingUsageRollups
            .AsNoTracking()
            .FirstOrDefaultAsync(
                r => r.TenantId == tenantId && r.PeriodStart == period.StartUtc, ct)
            .ConfigureAwait(false);

        _logger.LogInformation(
            "Billing usage queried: tenantId={TenantId} periodStart={PeriodStart} hasRollup={HasRollup}",
            tenantId, period.StartUtc, rollup is not null);

        if (rollup is not null)
        {
            return new UsageSummaryDto(
                rollup.PlatformInputTokens,
                rollup.PlatformOutputTokens,
                rollup.ByokInputTokens,
                rollup.ByokOutputTokens,
                rollup.PlatformCostUsd,
                rollup.BillableAmountUsd,
                rollup.Seats,
                rollup.PeriodStart,
                rollup.PeriodEnd);
        }

        var seats = subscription?.Seats ?? await CountActiveSeatsAsync(tenantId, ct).ConfigureAwait(false);
        return new UsageSummaryDto(
            PlatformInputTokens: 0L,
            PlatformOutputTokens: 0L,
            ByokInputTokens: 0L,
            ByokOutputTokens: 0L,
            PlatformCostUsd: 0m,
            BillableUsd: 0m,
            Seats: seats,
            PeriodStart: period.StartUtc,
            PeriodEnd: period.EndUtc);
    }

    /// <inheritdoc />
    public async Task BufferMeterEventsAsync(
        Guid tenantId, BillingPeriod period, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(period);
        if (!_billing.IsEnabled || tenantId == Guid.Empty)
        {
            return;
        }

        var periodStart = EnsureUtc(period.StartUtc);

        try
        {
            var customer = await _cp.BillingCustomers
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.TenantId == tenantId, ct)
                .ConfigureAwait(false);
            if (customer is null || string.IsNullOrWhiteSpace(customer.StripeCustomerId))
            {
                _logger.LogDebug(
                    "Skipping meter event buffering for tenant {TenantId}: no StripeCustomerId.",
                    tenantId);
                return;
            }

            var rollup = await _cp.BillingUsageRollups
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    r => r.TenantId == tenantId && r.PeriodStart == periodStart, ct)
                .ConfigureAwait(false);
            if (rollup is null)
            {
                return;
            }

            var now = _clock.GetUtcNow().UtcDateTime;
            var added = 0;

            // AC3 — ONLY platform tokens are buffered to Stripe Billing Meters.
            // BYOK tokens (ByokInputTokens / ByokOutputTokens) are EXPLICITLY
            // SKIPPED here and never written to BillingMeterEventBuffers.
            added += await TryBufferTokenDeltaAsync(
                tenantId,
                customer.StripeCustomerId,
                periodStart,
                BillingMeterNames.PlatformTokensInput,
                rollup.PlatformInputTokens,
                rollup.LastSourceCursor,
                now,
                ct).ConfigureAwait(false);

            added += await TryBufferTokenDeltaAsync(
                tenantId,
                customer.StripeCustomerId,
                periodStart,
                BillingMeterNames.PlatformTokensOutput,
                rollup.PlatformOutputTokens,
                rollup.LastSourceCursor,
                now,
                ct).ConfigureAwait(false);

            if (added > 0)
            {
                await _cp.SaveChangesAsync(ct).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Failed to buffer Stripe meter events for tenantId={TenantId} periodStart={PeriodStart}; swallowing (fail-open).",
                tenantId, periodStart);
        }
    }

    internal static BillingPeriod ResolveCurrentPeriod(BillingSubscription? subscription, DateTime utcNow)
    {
        if (subscription is not null &&
            subscription.CurrentPeriodStart != default &&
            subscription.CurrentPeriodEnd > subscription.CurrentPeriodStart)
        {
            return new BillingPeriod(
                EnsureUtc(subscription.CurrentPeriodStart),
                EnsureUtc(subscription.CurrentPeriodEnd));
        }

        return BillingPeriod.ForUtcMonth(utcNow);
    }

    private async Task<int> TryBufferTokenDeltaAsync(
        Guid tenantId,
        string stripeCustomerId,
        DateTime periodStart,
        string eventName,
        long currentTotal,
        long watermark,
        DateTime now,
        CancellationToken ct)
    {
        if (currentTotal <= 0)
        {
            return 0;
        }

        var existingValues = await _cp.BillingMeterEventBuffers
            .AsNoTracking()
            .Where(b => b.TenantId == tenantId
                        && b.PeriodStart == periodStart
                        && b.EventName == eventName)
            .Select(b => b.Value)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        long alreadyBuffered = 0;
        foreach (var raw in existingValues)
        {
            if (long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
            {
                alreadyBuffered += parsed;
            }
        }

        var delta = currentTotal - alreadyBuffered;
        if (delta <= 0)
        {
            return 0;
        }

        var idempotencyKey = BuildIdempotencyKey(tenantId, periodStart, eventName, watermark, currentTotal);
        var keyExists = await _cp.BillingMeterEventBuffers
            .AsNoTracking()
            .AnyAsync(b => b.IdempotencyKey == idempotencyKey, ct)
            .ConfigureAwait(false);
        if (keyExists)
        {
            return 0;
        }

        var valueStr = delta.ToString(CultureInfo.InvariantCulture);
        _cp.BillingMeterEventBuffers.Add(new BillingMeterEventBuffer
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            StripeCustomerId = stripeCustomerId,
            EventName = eventName,
            BillingMode = BillingModeTokens.Platform,
            Value = valueStr,
            IdempotencyKey = idempotencyKey,
            PeriodStart = periodStart,
            EventTimestamp = now,
            ReportedToStripe = false,
            CreatedAt = now,
            AttemptCount = 0,
        });

        _logger.LogDebug(
            "Buffered Stripe meter event: tenantId={TenantId} stripeCustomerId={StripeCustomerId} "
            + "eventName={EventName} value={Value} billingMode={BillingMode}",
            tenantId, stripeCustomerId, eventName, valueStr, BillingModeTokens.Platform);

        return 1;
    }

    internal static string BuildIdempotencyKey(
        Guid tenantId, DateTime periodStart, string eventName, long watermark, long cumulativeTotal) =>
        $"{tenantId:D}:{EnsureUtc(periodStart):yyyyMMddHHmmss}:{eventName}:{watermark}:{cumulativeTotal}";

    private async Task<RollupAggregation> AggregateFactsAsync(
        Guid tenantId,
        string? planSlug,
        DateTime periodStart,
        DateTime periodEnd,
        CancellationToken ct)
    {
        var events = await FetchLlmSuccessEventsAsync(tenantId, periodStart, periodEnd, ct)
            .ConfigureAwait(false);

        if (events.Count > 0)
        {
            return await AggregateFromEventsAsync(tenantId, planSlug, events, ct)
                .ConfigureAwait(false);
        }

        // Fallback to CP PlatformAnalyticsHourly when event stream has no rows
        // for this window (e.g. pre-aggregated CP fact rows).
        var hourlyRows = await _cp.PlatformAnalyticsHourly
            .AsNoTracking()
            .Where(h => h.TenantId == tenantId && h.Hour >= periodStart && h.Hour < periodEnd)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        long platformIn = 0, platformOut = 0, byokIn = 0, byokOut = 0;
        decimal costUsd = 0m;
        foreach (var row in hourlyRows)
        {
            var hasSplit = row.PlatformTokensIn > 0 || row.PlatformTokensOut > 0
                           || row.ByokTokensIn > 0 || row.ByokTokensOut > 0;
            if (hasSplit)
            {
                platformIn += row.PlatformTokensIn;
                platformOut += row.PlatformTokensOut;
                byokIn += row.ByokTokensIn;
                byokOut += row.ByokTokensOut;
            }
            else if (row.TokensIn > 0 || row.TokensOut > 0)
            {
                // Legacy row predating the billing_mode split: treat as platform and WARN.
                _logger.LogWarning(
                    "PlatformAnalyticsHourly row missing billing_mode token split for tenantId={TenantId} hour={Hour}; treating as platform.",
                    tenantId, row.Hour);
                platformIn += row.TokensIn;
                platformOut += row.TokensOut;
            }

            costUsd += row.CostUsd;
        }

        return new RollupAggregation(
            platformIn, platformOut, byokIn, byokOut,
            PlatformCostUsd: costUsd,
            BillableAmountUsd: costUsd,
            LastSourceCursor: hourlyRows.Count);
    }

    private async Task<List<DomainEvent>> FetchLlmSuccessEventsAsync(
        Guid tenantId, DateTime periodStart, DateTime periodEnd, CancellationToken ct)
    {
        var all = new List<DomainEvent>();
        long? cursor = null;

        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var (page, _) = await _events.QueryEventsAsync(
                tenantId,
                type: BillingModeEvents.LlmCallSuccess,
                typeIsPrefix: false,
                correlationId: null,
                actor: null,
                from: new DateTimeOffset(periodStart, TimeSpan.Zero),
                to: new DateTimeOffset(periodEnd, TimeSpan.Zero),
                cursor: cursor,
                limit: EventPageSize,
                includeTotal: false).ConfigureAwait(false);

            if (page.Count == 0)
            {
                break;
            }

            all.AddRange(page);

            if (page.Count < EventPageSize)
            {
                break;
            }

            var nextCursor = page.Min(e => e.SequenceNumber);
            if (cursor.HasValue && nextCursor >= cursor.Value)
            {
                break;
            }
            cursor = nextCursor;
        }

        return all;
    }

    private async Task<RollupAggregation> AggregateFromEventsAsync(
        Guid tenantId,
        string? planSlug,
        IReadOnlyList<DomainEvent> events,
        CancellationToken ct)
    {
        long platformIn = 0, platformOut = 0, byokIn = 0, byokOut = 0;
        decimal platformCostUsd = 0m, billableAmountUsd = 0m;
        long maxCursor = 0;

        foreach (var evt in events)
        {
            if (evt.SequenceNumber > maxCursor)
            {
                maxCursor = evt.SequenceNumber;
            }

            var parsed = ParseUsageEvent(evt);
            var isByok = false;

            if (string.IsNullOrWhiteSpace(parsed.BillingMode))
            {
                // Integration point: missing billing_mode tag → treat as platform + WARN
                // so a 35-2 wiring gap surfaces instead of silently zeroing revenue.
                _logger.LogWarning(
                    "LLM.CALL.SUCCESS event {EventId} for tenantId={TenantId} is missing billing_mode tag; treating as platform.",
                    evt.Id, tenantId);
            }
            else if (string.Equals(parsed.BillingMode, BillingModeTokens.Byok, StringComparison.OrdinalIgnoreCase))
            {
                isByok = true;
            }
            else if (!string.Equals(parsed.BillingMode, BillingModeTokens.Platform, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning(
                    "LLM.CALL.SUCCESS event {EventId} for tenantId={TenantId} has unknown billing_mode={BillingMode}; treating as platform.",
                    evt.Id, tenantId, parsed.BillingMode);
            }

            if (isByok)
            {
                byokIn += parsed.InputTokens;
                byokOut += parsed.OutputTokens;
                continue;
            }

            platformIn += parsed.InputTokens;
            platformOut += parsed.OutputTokens;

            // AC4 — Delegate ALL pricing/markup math to 34-5's IUsagePricingEngine.
            // Never implement margin math here.
            var provider = string.IsNullOrWhiteSpace(parsed.Provider) ? "unknown" : parsed.Provider;
            var occurredAt = EnsureUtc(evt.CreatedAt);
            var policy = await _marginResolver
                .ResolveAsync(provider, planSlug, occurredAt, ct)
                .ConfigureAwait(false);

            var line = new UsageLine(
                provider,
                parsed.Model,
                ClampToInt(parsed.InputTokens),
                ClampToInt(parsed.OutputTokens),
                PricingMode.PlatformProvided,
                occurredAt);

            var priced = _pricingEngine.PriceUsage(line, policy);

            _logger.LogDebug(
                "Priced platform usage line: tenantId={TenantId} provider={Provider} model={Model} "
                + "costBasisUsd={CostBasisUsd} sellPriceUsd={SellPriceUsd}",
                tenantId, provider, parsed.Model ?? "", priced.CostBasisUsd, priced.SellPriceUsd);

            platformCostUsd += priced.CostBasisUsd;
            billableAmountUsd += priced.SellPriceUsd;
        }

        if (maxCursor == 0 && events.Count > 0)
        {
            maxCursor = events.Count;
        }

        return new RollupAggregation(
            platformIn, platformOut, byokIn, byokOut,
            platformCostUsd, billableAmountUsd, maxCursor);
    }

    private async Task<BillingSubscription?> FindActiveSubscriptionAsync(
        Guid tenantId, CancellationToken ct) =>
        await _cp.BillingSubscriptions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId
                        && s.Status != "canceled"
                        && s.Status != "incomplete_expired")
            .OrderByDescending(s => s.UpdatedAt)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);

    private async Task<int> CountActiveSeatsAsync(Guid tenantId, CancellationToken ct) =>
        await _cp.TenantMemberships
            .AsNoTracking()
            .CountAsync(m => m.TenantId == tenantId, ct)
            .ConfigureAwait(false);

    private static ParsedUsageEvent ParseUsageEvent(DomainEvent evt)
    {
        string? billingMode = null;
        string? provider = null;
        string? model = null;
        long inputTokens = 0;
        long outputTokens = 0;

        if (!string.IsNullOrWhiteSpace(evt.Tags))
        {
            try
            {
                using var doc = JsonDocument.Parse(evt.Tags);
                if (doc.RootElement.ValueKind == JsonValueKind.Object)
                {
                    if (doc.RootElement.TryGetProperty("billing_mode", out var bmEl) ||
                        doc.RootElement.TryGetProperty("billingMode", out bmEl))
                    {
                        billingMode = bmEl.ValueKind == JsonValueKind.String ? bmEl.GetString() : null;
                    }
                    if (doc.RootElement.TryGetProperty("provider", out var pEl) && pEl.ValueKind == JsonValueKind.String)
                    {
                        provider = pEl.GetString();
                    }
                    if (doc.RootElement.TryGetProperty("model", out var mEl) && mEl.ValueKind == JsonValueKind.String)
                    {
                        model = mEl.GetString();
                    }
                }
            }
            catch (JsonException)
            {
                // Tolerate malformed tags; missing billing_mode will be warned and treated as platform.
            }
        }

        if (!string.IsNullOrWhiteSpace(evt.Data))
        {
            try
            {
                using var doc = JsonDocument.Parse(evt.Data);
                if (doc.RootElement.ValueKind == JsonValueKind.Object)
                {
                    if (doc.RootElement.TryGetProperty("inputTokens", out var inEl))
                    {
                        inputTokens = ReadLong(inEl);
                    }
                    if (doc.RootElement.TryGetProperty("outputTokens", out var outEl))
                    {
                        outputTokens = ReadLong(outEl);
                    }
                    if (string.IsNullOrWhiteSpace(billingMode) &&
                        (doc.RootElement.TryGetProperty("billingMode", out var dbmEl) ||
                         doc.RootElement.TryGetProperty("billing_mode", out dbmEl)) &&
                        dbmEl.ValueKind == JsonValueKind.String)
                    {
                        billingMode = dbmEl.GetString();
                    }
                    if (string.IsNullOrWhiteSpace(provider) &&
                        doc.RootElement.TryGetProperty("provider", out var dpEl) &&
                        dpEl.ValueKind == JsonValueKind.String)
                    {
                        provider = dpEl.GetString();
                    }
                    if (string.IsNullOrWhiteSpace(model) &&
                        doc.RootElement.TryGetProperty("model", out var dmEl) &&
                        dmEl.ValueKind == JsonValueKind.String)
                    {
                        model = dmEl.GetString();
                    }
                }
            }
            catch (JsonException)
            {
                // Tolerate malformed event payloads.
            }
        }

        return new ParsedUsageEvent(
            billingMode,
            provider,
            model,
            Math.Max(0, inputTokens),
            Math.Max(0, outputTokens));
    }

    private static long ReadLong(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.Number => el.TryGetInt64(out var n) ? n : 0L,
        JsonValueKind.String => long.TryParse(
            el.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0L,
        _ => 0L,
    };

    private static int ClampToInt(long value) =>
        value <= 0 ? 0 : value >= int.MaxValue ? int.MaxValue : (int)value;

    private static DateTime EnsureUtc(DateTime dt) =>
        dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);

    private sealed record ParsedUsageEvent(
        string? BillingMode,
        string? Provider,
        string? Model,
        long InputTokens,
        long OutputTokens);

    private sealed record RollupAggregation(
        long PlatformInputTokens,
        long PlatformOutputTokens,
        long ByokInputTokens,
        long ByokOutputTokens,
        decimal PlatformCostUsd,
        decimal BillableAmountUsd,
        long LastSourceCursor);
}
