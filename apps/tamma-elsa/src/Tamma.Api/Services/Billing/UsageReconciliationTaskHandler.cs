using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Tamma.Api.Services.Alerts;
using Tamma.Api.Services.PlatformTasks;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-3 (AC9, AC10) — hourly <see cref="IPlatformTaskHandler"/> for task
/// type <c>billing.usage_reconcile</c>. Iterates every active
/// <see cref="BillingCustomer"/> on the control plane, compares local
/// <see cref="BillingUsageRollup"/> platform token totals against Stripe
/// Billing Meter summaries (<c>Stripe.Billing.Meters.ListEventSummaries</c>),
/// and on drift beyond configurable tolerance emits
/// <c>BILLING.USAGE.RECONCILIATION_MISMATCH</c>, raises a tenant-scoped
/// warning alert via <see cref="IAlertSink"/>, and logs a WARN.
/// </summary>
public sealed class UsageReconciliationTaskHandler : IPlatformTaskHandler
{
    public const string TaskTypeName = "billing.usage_reconcile";

    private readonly ControlPlaneDbContext _cp;
    private readonly IBillingProvider _billing;
    private readonly IEventRepository _events;
    private readonly IAlertSink _alerts;
    private readonly IPlatformQueuedTaskRepository _taskQueue;
    private readonly BillingUsageOptions _options;
    private readonly TimeProvider _clock;
    private readonly ILogger<UsageReconciliationTaskHandler> _logger;

    public UsageReconciliationTaskHandler(
        ControlPlaneDbContext cp,
        IBillingProvider billing,
        IEventRepository events,
        IAlertSink alerts,
        IPlatformQueuedTaskRepository taskQueue,
        IOptions<BillingUsageOptions> options,
        TimeProvider clock,
        ILogger<UsageReconciliationTaskHandler> logger)
    {
        ArgumentNullException.ThrowIfNull(cp);
        ArgumentNullException.ThrowIfNull(billing);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(alerts);
        ArgumentNullException.ThrowIfNull(taskQueue);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(logger);

        _cp = cp;
        _billing = billing;
        _events = events;
        _alerts = alerts;
        _taskQueue = taskQueue;
        _options = options.Value;
        _clock = clock;
        _logger = logger;
    }

    /// <inheritdoc />
    public string TaskType => TaskTypeName;

    /// <inheritdoc />
    public async Task HandleAsync(PlatformQueuedTask task, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(task);

        if (!_billing.IsEnabled)
        {
            throw new PlatformTaskTerminalException(
                "Billing provider is disabled (single-user mode); billing.usage_reconcile cannot run.");
        }

        if (!string.IsNullOrWhiteSpace(task.Payload))
        {
            try
            {
                using var _ = JsonDocument.Parse(task.Payload);
            }
            catch (JsonException ex)
            {
                throw new PlatformTaskTerminalException(
                    "billing.usage_reconcile payload is malformed JSON.", ex);
            }
        }

        var now = _clock.GetUtcNow().UtcDateTime;

        var meterCatalog = await _cp.BillingPlanPrices
            .AsNoTracking()
            .FirstOrDefaultAsync(
                p => p.TokensInputMeterId != null || p.TokensOutputMeterId != null, ct)
            .ConfigureAwait(false);

        if (meterCatalog is null)
        {
            _logger.LogWarning(
                "Usage reconciliation skipped: no BillingPlanPrice row has Stripe meter ids configured.");
            await TryScheduleNextCycleAsync(now, ct).ConfigureAwait(false);
            return;
        }

        var customers = await _cp.BillingCustomers
            .AsNoTracking()
            .Where(c => c.StripeCustomerId != null && c.StripeCustomerId != "")
            .OrderBy(c => c.TenantId)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        var customersChecked = 0;
        var mismatches = 0;

        foreach (var customer in customers)
        {
            ct.ThrowIfCancellationRequested();
            customersChecked++;

            try
            {
                var subscription = await _cp.BillingSubscriptions
                    .AsNoTracking()
                    .Where(s => s.TenantId == customer.TenantId
                                && s.Status != "canceled"
                                && s.Status != "incomplete_expired")
                    .OrderByDescending(s => s.UpdatedAt)
                    .FirstOrDefaultAsync(ct)
                    .ConfigureAwait(false);

                var period = UsageMeteringService.ResolveCurrentPeriod(subscription, now);

                var rollup = await _cp.BillingUsageRollups
                    .AsNoTracking()
                    .FirstOrDefaultAsync(
                        r => r.TenantId == customer.TenantId && r.PeriodStart == period.StartUtc, ct)
                    .ConfigureAwait(false);

                var localInput = rollup?.PlatformInputTokens ?? 0L;
                var localOutput = rollup?.PlatformOutputTokens ?? 0L;
                var localTotalTokens = localInput + localOutput;
                var localBillableUsd = rollup?.BillableAmountUsd ?? 0m;

                if (!string.IsNullOrWhiteSpace(meterCatalog.TokensInputMeterId))
                {
                    var stripeInput = await _billing.GetMeterEventSummaryTotalAsync(
                        meterCatalog.TokensInputMeterId,
                        customer.StripeCustomerId!,
                        period.StartUtc,
                        period.EndUtc,
                        ct).ConfigureAwait(false);

                    if (await CheckAndEmitDriftAsync(
                        customer,
                        period,
                        BillingMeterNames.PlatformTokensInput,
                        localInput,
                        stripeInput,
                        localTotalTokens,
                        localBillableUsd,
                        now,
                        ct).ConfigureAwait(false))
                    {
                        mismatches++;
                    }
                }

                if (!string.IsNullOrWhiteSpace(meterCatalog.TokensOutputMeterId))
                {
                    var stripeOutput = await _billing.GetMeterEventSummaryTotalAsync(
                        meterCatalog.TokensOutputMeterId,
                        customer.StripeCustomerId!,
                        period.StartUtc,
                        period.EndUtc,
                        ct).ConfigureAwait(false);

                    if (await CheckAndEmitDriftAsync(
                        customer,
                        period,
                        BillingMeterNames.PlatformTokensOutput,
                        localOutput,
                        stripeOutput,
                        localTotalTokens,
                        localBillableUsd,
                        now,
                        ct).ConfigureAwait(false))
                    {
                        mismatches++;
                    }
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                // Fail-open per customer so one Stripe outage never aborts
                // reconciliation for the remaining tenants.
                _logger.LogError(
                    ex,
                    "Usage reconciliation failed for tenantId={TenantId} stripeCustomerId={StripeCustomerId}; continuing.",
                    customer.TenantId, customer.StripeCustomerId);
            }
        }

        _logger.LogInformation(
            "Billing usage reconciliation completed: customersChecked={CustomersChecked} mismatches={Mismatches}",
            customersChecked, mismatches);

        await TryScheduleNextCycleAsync(now, ct).ConfigureAwait(false);
    }

    private async Task<bool> CheckAndEmitDriftAsync(
        BillingCustomer customer,
        BillingPeriod period,
        string meterName,
        long localTotal,
        long stripeTotal,
        long localCombinedTokens,
        decimal localBillableUsd,
        DateTime now,
        CancellationToken ct)
    {
        var tokenDrift = Math.Abs(localTotal - stripeTotal);
        var estimatedDriftUsd = localCombinedTokens > 0 && localBillableUsd > 0m
            ? Math.Round((tokenDrift / (decimal)localCombinedTokens) * localBillableUsd, 4, MidpointRounding.ToEven)
            : 0m;

        var exceedsTokenTolerance = tokenDrift > Math.Max(0L, _options.DriftToleranceTokens);
        var exceedsUsdTolerance = estimatedDriftUsd > Math.Max(0m, _options.DriftToleranceUsd);

        if (!exceedsTokenTolerance && !exceedsUsdTolerance)
        {
            return false;
        }

        _logger.LogWarning(
            "Billing usage reconciliation mismatch: tenantId={TenantId} stripeCustomerId={StripeCustomerId} "
            + "periodStart={PeriodStart} meter={Meter} local={Local} stripe={Stripe} "
            + "tokenDrift={TokenDrift} estimatedDriftUsd={EstimatedDriftUsd}",
            customer.TenantId, customer.StripeCustomerId, period.StartUtc,
            meterName, localTotal, stripeTotal, tokenDrift, estimatedDriftUsd);

        await _events.AppendAsync(BillingMeterEventTypes.DriftDetected(
            customer.TenantId,
            period.StartUtc,
            customer.StripeCustomerId!,
            meterName,
            localTotal,
            stripeTotal,
            estimatedDriftUsd,
            now)).ConfigureAwait(false);

        await _alerts.RaiseAsync(new AlertPayload(
            Severity: AlertSeverity.Warning,
            Title: $"Billing meter drift detected ({meterName})",
            Description: $"Local rollup ({localTotal}) diverges from Stripe meter summary ({stripeTotal}) "
                         + $"by {tokenDrift} tokens (~${estimatedDriftUsd:F4} USD) for period {period.StartUtc:O}.",
            CorrelationId: $"billing-reconcile:{customer.TenantId:D}:{period.StartUtc:yyyyMMdd}:{meterName}",
            TenantId: customer.TenantId,
            Metadata: new Dictionary<string, object?>
            {
                ["tenantId"] = customer.TenantId.ToString("D"),
                ["stripeCustomerId"] = customer.StripeCustomerId,
                ["periodStart"] = period.StartUtc.ToString("O"),
                ["meter"] = meterName,
                ["local"] = localTotal,
                ["stripe"] = stripeTotal,
                ["tokenDrift"] = tokenDrift,
                ["estimatedDriftUsd"] = estimatedDriftUsd,
            }), ct).ConfigureAwait(false);

        return true;
    }

    private async Task TryScheduleNextCycleAsync(DateTime now, CancellationToken ct)
    {
        var cadenceMinutes = Math.Max(1, _options.ReconcileIntervalMinutes);
        try
        {
            var alreadyPending = await _cp.PlatformQueuedTasks
                .AsNoTracking()
                .AnyAsync(t => t.Type == TaskTypeName && t.Status == "pending", ct)
                .ConfigureAwait(false);
            if (alreadyPending)
            {
                return;
            }

            await _taskQueue.EnqueueAsync(new PlatformQueuedTask
            {
                Type = TaskTypeName,
                Payload = "{}",
                VisibleAt = now.AddMinutes(cadenceMinutes),
            }, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(
                ex, "Failed to self-reschedule next {TaskType} cycle.", TaskTypeName);
        }
    }
}
