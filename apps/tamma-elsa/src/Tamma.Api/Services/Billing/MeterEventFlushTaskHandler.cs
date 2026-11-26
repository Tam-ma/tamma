using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Tamma.Api.Services.PlatformTasks;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-3 (AC6, AC7) — <see cref="IPlatformTaskHandler"/> for task type
/// <c>billing.meter_flush</c>. Loads a bounded batch of unreported
/// <see cref="BillingMeterEventBuffer"/> rows, reports each to Stripe Billing
/// Meters via <see cref="IBillingProvider.ReportMeterEventAsync"/> with its
/// deterministic <c>IdempotencyKey</c>, marks successes
/// <c>ReportedToStripe = true</c>, and leaves failures pending with incremented
/// <c>AttemptCount</c> + <c>BILLING.USAGE.FLUSH_FAILED</c> DCB event so the
/// next cycle retries without ever blocking LLM calls.
/// </summary>
public sealed class MeterEventFlushTaskHandler : IPlatformTaskHandler
{
    public const string TaskTypeName = "billing.meter_flush";

    private readonly ControlPlaneDbContext _cp;
    private readonly IBillingProvider _billing;
    private readonly IEventRepository _events;
    private readonly IPlatformQueuedTaskRepository _taskQueue;
    private readonly BillingUsageOptions _options;
    private readonly TimeProvider _clock;
    private readonly ILogger<MeterEventFlushTaskHandler> _logger;

    public MeterEventFlushTaskHandler(
        ControlPlaneDbContext cp,
        IBillingProvider billing,
        IEventRepository events,
        IPlatformQueuedTaskRepository taskQueue,
        IOptions<BillingUsageOptions> options,
        TimeProvider clock,
        ILogger<MeterEventFlushTaskHandler> logger)
    {
        ArgumentNullException.ThrowIfNull(cp);
        ArgumentNullException.ThrowIfNull(billing);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(taskQueue);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(logger);

        _cp = cp;
        _billing = billing;
        _events = events;
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
                "Billing provider is disabled (single-user mode); billing.meter_flush cannot run.");
        }

        // Validate payload JSON if non-empty (malformed batch payload → terminal dead-letter).
        if (!string.IsNullOrWhiteSpace(task.Payload))
        {
            try
            {
                using var _ = JsonDocument.Parse(task.Payload);
            }
            catch (JsonException ex)
            {
                throw new PlatformTaskTerminalException(
                    "billing.meter_flush payload is malformed JSON.", ex);
            }
        }

        var now = _clock.GetUtcNow().UtcDateTime;
        var batchSize = Math.Clamp(_options.MeterFlushBatchSize, 1, 1000);

        _logger.LogDebug("Meter flush cycle started (batchSize={BatchSize}).", batchSize);

        var totalPending = await _cp.BillingMeterEventBuffers
            .AsNoTracking()
            .CountAsync(b => !b.ReportedToStripe, ct)
            .ConfigureAwait(false);

        if (totalPending > _options.UnreportedBacklogWarnThreshold)
        {
            _logger.LogWarning(
                "Unreported Stripe meter-event buffer backlog={Backlog} exceeds threshold={Threshold}.",
                totalPending, _options.UnreportedBacklogWarnThreshold);
        }

        var pending = await _cp.BillingMeterEventBuffers
            .Where(b => !b.ReportedToStripe)
            .OrderBy(b => b.CreatedAt)
            .Take(batchSize)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        var succeeded = 0;
        var failed = 0;

        foreach (var row in pending)
        {
            ct.ThrowIfCancellationRequested();

            // Belt-and-suspenders defense against any BYOK row ever entering the flush path.
            if (string.Equals(row.BillingMode, BillingModeTokens.Byok, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning(
                    "Skipping BYOK row {BufferId} in meter flush for tenantId={TenantId} eventName={EventName}.",
                    row.Id, row.TenantId, row.EventName);
                continue;
            }

            row.AttemptCount++;
            row.LastAttemptAt = now;

            try
            {
                var request = new MeterEventReportRequest(
                    row.EventName,
                    row.StripeCustomerId,
                    row.Value,
                    row.IdempotencyKey,
                    row.EventTimestamp);

                var result = await _billing
                    .ReportMeterEventAsync(request, ct)
                    .ConfigureAwait(false);

                row.ReportedToStripe = true;
                row.StripeEventId = result.Identifier;
                row.LastError = null;
                succeeded++;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                failed++;
                row.ReportedToStripe = false;
                row.LastError = TruncateError(ex.Message);

                _logger.LogWarning(
                    "Stripe meter event flush failed: tenantId={TenantId} stripeCustomerId={StripeCustomerId} "
                    + "eventName={EventName} value={Value} attemptCount={AttemptCount} errorClass={ErrorClass}",
                    row.TenantId, row.StripeCustomerId, row.EventName, row.Value,
                    row.AttemptCount, ex.GetType().Name);

                await TryAppendEventAsync(BillingMeterEventTypes.FlushFailure(
                    row.TenantId,
                    row.PeriodStart,
                    row.StripeCustomerId,
                    row.EventName,
                    row.Value,
                    row.AttemptCount,
                    ex.GetType().Name,
                    now)).ConfigureAwait(false);
            }
        }

        if (pending.Count > 0)
        {
            await _cp.SaveChangesAsync(ct).ConfigureAwait(false);

            // Emit BILLING.USAGE.RECORDED per tenant that had rows flushed in this batch.
            foreach (var group in pending.Where(r => r.ReportedToStripe).GroupBy(r => new { r.TenantId, r.PeriodStart, r.StripeCustomerId }))
            {
                long inTokens = 0, outTokens = 0;
                foreach (var r in group)
                {
                    if (!long.TryParse(r.Value, out var val)) continue;
                    if (r.EventName == BillingMeterNames.PlatformTokensInput) inTokens += val;
                    else if (r.EventName == BillingMeterNames.PlatformTokensOutput) outTokens += val;
                }

                await TryAppendEventAsync(BillingMeterEventTypes.Recorded(
                    group.Key.TenantId,
                    group.Key.PeriodStart,
                    group.Key.StripeCustomerId,
                    BillingModeTokens.Platform,
                    inTokens,
                    outTokens,
                    byokInputTokens: 0L,
                    byokOutputTokens: 0L,
                    platformCostUsd: 0m,
                    billableAmountUsd: 0m,
                    now)).ConfigureAwait(false);
            }

            _logger.LogInformation(
                "Stripe meter batch flushed: batchSize={BatchSize} succeeded={Succeeded} failed={Failed}",
                pending.Count, succeeded, failed);
        }

        await TryScheduleNextCycleAsync(now, ct).ConfigureAwait(false);
    }

    private async Task TryScheduleNextCycleAsync(DateTime now, CancellationToken ct)
    {
        var cadenceSeconds = Math.Max(1, _options.MeterFlushIntervalSeconds);
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
                VisibleAt = now.AddSeconds(cadenceSeconds),
            }, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(
                ex, "Failed to self-reschedule next {TaskType} cycle.", TaskTypeName);
        }
    }

    private async Task TryAppendEventAsync(DomainEvent evt)
    {
        try
        {
            await _events.AppendAsync(evt).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex, "Failed to append {EventType} DCB event for tenantId={TenantId}.",
                evt.Type, evt.TenantId);
        }
    }

    private static string TruncateError(string? message)
    {
        if (string.IsNullOrEmpty(message)) return "Unknown error";
        return message.Length <= 2000 ? message : message[..2000];
    }
}
