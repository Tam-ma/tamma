using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-8 (AC5–AC12) — deterministic failed-payment dunning state machine.
/// Keeps <see cref="Next"/> pure and clock-free; persists transitions on
/// <see cref="BillingDunningState"/>, schedules <c>billing.dunning.advance</c>
/// on <see cref="IPlatformQueuedTaskRepository"/>, writes email rows strictly
/// to the store-and-forward outbox (never direct transport), emits DCB events,
/// and invalidates Story 35-6's <see cref="IQuotaService"/> on suspend/reinstate.
/// </summary>
public sealed class DunningStateMachine : IDunningStateMachine
{
    private readonly ControlPlaneDbContext _cp;
    private readonly IPlatformQueuedTaskRepository _tasks;
    private readonly IEventRepository _events;
    private readonly DunningOptions _options;
    private readonly TimeProvider _clock;
    private readonly ILogger<DunningStateMachine> _logger;
    private readonly IQuotaService? _quotaService;
    private readonly ITenantDbContextFactory? _tenantDbFactory;

    public DunningStateMachine(
        ControlPlaneDbContext cp,
        IPlatformQueuedTaskRepository tasks,
        IEventRepository events,
        IOptions<DunningOptions> options,
        TimeProvider clock,
        ILogger<DunningStateMachine> logger,
        IQuotaService? quotaService = null,
        ITenantDbContextFactory? tenantDbFactory = null)
    {
        ArgumentNullException.ThrowIfNull(cp);
        ArgumentNullException.ThrowIfNull(tasks);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(logger);

        _cp = cp;
        _tasks = tasks;
        _events = events;
        _options = options.Value;
        _clock = clock;
        _logger = logger;
        _quotaService = quotaService;
        _tenantDbFactory = tenantDbFactory;
    }

    /// <inheritdoc />
    public DunningTransition Next(string currentStage, int failedAttempts, DunningOptions opts)
    {
        ArgumentNullException.ThrowIfNull(opts);
        var retries = opts.RetryDelaysHours is { Length: > 0 } ? opts.RetryDelaysHours : [24, 72, 120];
        var graceHours = Math.Max(1, opts.GraceHours);
        var attempts = Math.Max(1, failedAttempts);

        return currentStage switch
        {
            DunningStages.Suspended => new DunningTransition(DunningStages.Suspended, null, true),

            DunningStages.Grace => new DunningTransition(DunningStages.Suspended, null, true),

            // Active / PastDue / Flagged: while failedAttempts <= retry schedule length,
            // stay in past_due and schedule the next step; once attempts exceed retries,
            // enter grace for GraceHours before terminal suspension.
            _ when attempts <= retries.Length => new DunningTransition(
                DunningStages.PastDue,
                TimeSpan.FromHours(Math.Max(1, retries[attempts - 1])),
                Suspend: false),

            _ => new DunningTransition(
                DunningStages.Grace,
                TimeSpan.FromHours(graceHours),
                Suspend: false),
        };
    }

    /// <inheritdoc />
    public async Task<BillingDunningState> OnPaymentFailedAsync(
        Guid tenantId, BillingInvoice invoice, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        var now = _clock.GetUtcNow().UtcDateTime;
        var state = await GetOrCreateStateAsync(tenantId, now, ct).ConfigureAwait(false);

        // Idempotency guard: if the exact same (invoiceId, attemptCount) was already
        // processed (replayed webhook), do not double-advance dunning.
        if (state.CurrentInvoiceId == invoice.Id
            && invoice.AttemptCount > 0
            && state.LastObservedAttemptCount >= invoice.AttemptCount)
        {
            _logger.LogDebug(
                "Duplicate payment_failed ignored for tenantId={TenantId} invoiceId={InvoiceId} attemptCount={AttemptCount}",
                tenantId, invoice.Id, invoice.AttemptCount);
            return state;
        }

        var fromStage = state.Stage;
        var nextAttempts = invoice.AttemptCount > state.FailedAttempts
            ? invoice.AttemptCount
            : state.FailedAttempts + 1;

        // If already in grace and another payment fails, stay in grace until timer
        // expires unless grace already elapsed; otherwise compute via Next().
        var transition = fromStage == DunningStages.Grace
            ? (state.NextAdvanceAt.HasValue && now >= state.NextAdvanceAt.Value
                ? new DunningTransition(DunningStages.Suspended, null, true)
                : new DunningTransition(DunningStages.Grace, state.NextAdvanceAt.HasValue ? state.NextAdvanceAt.Value - now : TimeSpan.FromHours(Math.Max(1, _options.GraceHours)), false))
            : Next(fromStage, nextAttempts, _options);

        state.CurrentInvoiceId = invoice.Id;
        state.FailedAttempts = nextAttempts;
        state.LastObservedAttemptCount = Math.Max(state.LastObservedAttemptCount, invoice.AttemptCount);

        await ApplyTransitionAsync(state, fromStage, transition, invoice, now, emitPaymentFailed: true, ct)
            .ConfigureAwait(false);

        return state;
    }

    /// <inheritdoc />
    public async Task<BillingDunningState> OnPaymentRecoveredAsync(
        Guid tenantId, BillingInvoice invoice, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        var now = _clock.GetUtcNow().UtcDateTime;
        var state = await GetOrCreateStateAsync(tenantId, now, ct).ConfigureAwait(false);

        var wasInDunning = !string.Equals(state.Stage, DunningStages.Active, StringComparison.Ordinal);
        var fromStage = state.Stage;

        if (state.PendingAdvanceTaskId is Guid pendingTaskId)
        {
            await CancelPendingTaskSafeAsync(pendingTaskId, "recovered_by_payment", ct).ConfigureAwait(false);
        }

        state.Stage = DunningStages.Active;
        state.FailedAttempts = 0;
        state.LastObservedAttemptCount = 0;
        state.CurrentInvoiceId = null;
        state.StageEnteredAt = now;
        state.NextAdvanceAt = null;
        state.PendingAdvanceTaskId = null;
        state.SuspendedAt = null;
        state.UpdatedAt = now;

        await _cp.SaveChangesAsync(ct).ConfigureAwait(false);

        if (wasInDunning)
        {
            InvalidateQuotaSafe(tenantId);

            await _events.AppendAsync(BillingInvoiceEvents.Build(
                BillingInvoiceEvents.TenantReinstated,
                tenantId,
                invoice.Id,
                invoice.StripeInvoiceId,
                stage: DunningStages.Active,
                attemptCount: invoice.AttemptCount,
                data: new
                {
                    tenantId,
                    invoiceId = invoice.Id,
                    fromStage,
                    toStage = DunningStages.Active,
                },
                occurredAtUtc: now)).ConfigureAwait(false);

            await EnqueueTenantStageEmailSafeAsync(
                tenantId,
                DunningStages.Active,
                attemptCount: invoice.AttemptCount,
                nextRetryUtc: null,
                amountDueCents: invoice.AmountPaid > 0 ? invoice.AmountPaid : invoice.AmountDue,
                currency: invoice.Currency,
                nowUtc: now,
                ct: ct).ConfigureAwait(false);

            _logger.LogInformation(
                "Billing tenant reinstated tenantId={TenantId} invoiceId={InvoiceId} fromStage={FromStage}",
                tenantId, invoice.Id, fromStage);
        }

        return state;
    }

    /// <inheritdoc />
    public async Task<BillingDunningState?> AdvanceAsync(Guid tenantId, CancellationToken ct = default)
    {
        var now = _clock.GetUtcNow().UtcDateTime;
        var state = await _cp.BillingDunningStates
            .FirstOrDefaultAsync(s => s.TenantId == tenantId, ct)
            .ConfigureAwait(false);

        if (state is null
            || state.Stage is DunningStages.Active or DunningStages.Suspended or DunningStages.Flagged)
        {
            _logger.LogWarning(
                "Dunning advance no-op for tenantId={TenantId} stage={Stage}",
                tenantId, state?.Stage ?? "none");
            return state;
        }

        // Belt-and-suspenders: if the driving invoice is already paid/void, recover instead.
        BillingInvoice? invoice = null;
        if (state.CurrentInvoiceId is Guid invId)
        {
            invoice = await _cp.BillingInvoices
                .FirstOrDefaultAsync(i => i.Id == invId && i.TenantId == tenantId, ct)
                .ConfigureAwait(false);
            if (invoice is { Status: "paid" or "void" })
            {
                return await OnPaymentRecoveredAsync(tenantId, invoice, ct).ConfigureAwait(false);
            }
        }

        // If scheduled time has not arrived yet, leave state untouched (handler can defer or caller called early).
        if (state.NextAdvanceAt.HasValue && now < state.NextAdvanceAt.Value)
        {
            _logger.LogDebug(
                "Dunning advance deferred: tenantId={TenantId} nextAdvanceAt={NextAdvanceAt}",
                tenantId, state.NextAdvanceAt.Value);
            return state;
        }

        var fromStage = state.Stage;
        var nextAttempts = state.FailedAttempts + 1;
        var transition = Next(fromStage, nextAttempts, _options);
        state.FailedAttempts = nextAttempts;

        await ApplyTransitionAsync(state, fromStage, transition, invoice, now, emitPaymentFailed: false, ct)
            .ConfigureAwait(false);

        return state;
    }

    /// <inheritdoc />
    public async Task<BillingDunningState> OnDisputeCreatedAsync(
        Guid tenantId,
        string? stripeDisputeId,
        string? stripeInvoiceId,
        string? reason,
        CancellationToken ct = default)
    {
        var now = _clock.GetUtcNow().UtcDateTime;
        var state = await GetOrCreateStateAsync(tenantId, now, ct).ConfigureAwait(false);

        BillingInvoice? invoice = null;
        if (!string.IsNullOrWhiteSpace(stripeInvoiceId))
        {
            invoice = await _cp.BillingInvoices
                .FirstOrDefaultAsync(i => i.TenantId == tenantId && i.StripeInvoiceId == stripeInvoiceId, ct)
                .ConfigureAwait(false);
        }

        if (invoice is not null)
        {
            invoice.IsDisputed = true;
            invoice.UpdatedAt = now;
        }

        // AC11: Dispute flips tenant to 'flagged' — NEVER auto-suspends!
        if (state.PendingAdvanceTaskId is Guid pendingTaskId)
        {
            await CancelPendingTaskSafeAsync(pendingTaskId, "dispute_flagged_for_review", ct).ConfigureAwait(false);
            state.PendingAdvanceTaskId = null;
        }

        state.Stage = DunningStages.Flagged;
        state.StageEnteredAt = now;
        state.NextAdvanceAt = null;
        state.UpdatedAt = now;
        if (invoice is not null)
        {
            state.CurrentInvoiceId = invoice.Id;
        }

        await _cp.SaveChangesAsync(ct).ConfigureAwait(false);

        await _events.AppendAsync(BillingInvoiceEvents.Build(
            BillingInvoiceEvents.InvoiceDisputed,
            tenantId,
            invoice?.Id,
            stripeInvoiceId ?? invoice?.StripeInvoiceId,
            stage: DunningStages.Flagged,
            attemptCount: state.FailedAttempts,
            data: new
            {
                tenantId,
                invoiceId = invoice?.Id,
                stripeInvoiceId = stripeInvoiceId ?? invoice?.StripeInvoiceId,
                stripeDisputeId,
                reason,
                stage = DunningStages.Flagged,
            },
            occurredAtUtc: now)).ConfigureAwait(false);

        // Enqueue platform-admin dispute alert strictly to PlatformEmailOutbox (never direct transport).
        try
        {
            var composed = BillingDunningEmailComposer.ComposeDisputeAdminAlert(
                tenantId, stripeDisputeId, stripeInvoiceId ?? invoice?.StripeInvoiceId, reason);
            var row = BillingDunningEmailComposer.ToPlatformOutboxRow(
                tenantId, _options.AdminNotificationEmail, _options.FromAddress, composed, now);
            _cp.PlatformEmailOutbox.Add(row);
            await _cp.SaveChangesAsync(ct).ConfigureAwait(false);
            _logger.LogDebug(
                "Dispute admin email enqueued template={Template} outboxId={OutboxId} tenantId={TenantId}",
                composed.Template, row.Id, tenantId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to enqueue dispute-opened outbox email for tenantId={TenantId}", tenantId);
        }

        _logger.LogInformation(
            "Billing dispute opened: tenantId={TenantId} invoiceId={InvoiceId} stage=flagged",
            tenantId, invoice?.Id);

        return state;
    }

    /// <inheritdoc />
    public async Task<BillingDunningState?> GetStateAsync(Guid tenantId, CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty) return null;
        return await _cp.BillingDunningStates
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId, ct)
            .ConfigureAwait(false);
    }

    private async Task ApplyTransitionAsync(
        BillingDunningState state,
        string fromStage,
        DunningTransition transition,
        BillingInvoice? invoice,
        DateTime now,
        bool emitPaymentFailed,
        CancellationToken ct)
    {
        // Cancel superseded pending advance task before scheduling a new one.
        if (state.PendingAdvanceTaskId is Guid oldTaskId)
        {
            await CancelPendingTaskSafeAsync(oldTaskId, "superseded_by_next_transition", ct).ConfigureAwait(false);
            state.PendingAdvanceTaskId = null;
        }

        state.Stage = transition.NextStage;
        state.StageEnteredAt = now;
        state.UpdatedAt = now;

        DateTime? nextAdvanceAt = null;
        if (transition.Suspend)
        {
            state.SuspendedAt ??= now;
            state.NextAdvanceAt = null;
        }
        else if (transition.DelayUntilNext is TimeSpan delay)
        {
            nextAdvanceAt = now.Add(delay);
            state.NextAdvanceAt = nextAdvanceAt;
            var task = await _tasks.EnqueueAsync(new PlatformQueuedTask
            {
                Id = Guid.NewGuid(),
                Type = DunningAdvanceTaskHandler.TaskTypeName,
                TenantId = state.TenantId,
                Payload = JsonSerializer.Serialize(new
                {
                    tenantId = state.TenantId,
                    invoiceId = invoice?.Id ?? state.CurrentInvoiceId,
                    expectedStage = transition.NextStage,
                    scheduledAtUtc = nextAdvanceAt.Value,
                }),
                VisibleAt = nextAdvanceAt.Value,
                Status = "pending",
                CreatedAt = now,
            }, ct).ConfigureAwait(false);

            state.PendingAdvanceTaskId = task.Id;
            _logger.LogDebug(
                "Scheduled billing.dunning.advance taskId={TaskId} tenantId={TenantId} runAt={RunAt}",
                task.Id, state.TenantId, nextAdvanceAt.Value);
        }

        await _cp.SaveChangesAsync(ct).ConfigureAwait(false);

        if (emitPaymentFailed)
        {
            await _events.AppendAsync(BillingInvoiceEvents.Build(
                BillingInvoiceEvents.PaymentFailed,
                state.TenantId,
                invoice?.Id ?? state.CurrentInvoiceId,
                invoice?.StripeInvoiceId,
                stage: state.Stage,
                attemptCount: state.FailedAttempts,
                data: new
                {
                    tenantId = state.TenantId,
                    invoiceId = invoice?.Id ?? state.CurrentInvoiceId,
                    stripeInvoiceId = invoice?.StripeInvoiceId,
                    attemptCount = state.FailedAttempts,
                    stage = state.Stage,
                    nextAdvanceAt,
                },
                occurredAtUtc: now)).ConfigureAwait(false);
        }

        await _events.AppendAsync(BillingInvoiceEvents.Build(
            BillingInvoiceEvents.DunningEscalated,
            state.TenantId,
            invoice?.Id ?? state.CurrentInvoiceId,
            invoice?.StripeInvoiceId,
            stage: state.Stage,
            attemptCount: state.FailedAttempts,
            data: new
            {
                tenantId = state.TenantId,
                invoiceId = invoice?.Id ?? state.CurrentInvoiceId,
                fromStage,
                toStage = state.Stage,
                attemptCount = state.FailedAttempts,
                nextAdvanceAt,
            },
            occurredAtUtc: now)).ConfigureAwait(false);

        if (transition.Suspend)
        {
            InvalidateQuotaSafe(state.TenantId);

            await _events.AppendAsync(BillingInvoiceEvents.Build(
                BillingInvoiceEvents.TenantSuspended,
                state.TenantId,
                invoice?.Id ?? state.CurrentInvoiceId,
                invoice?.StripeInvoiceId,
                stage: DunningStages.Suspended,
                attemptCount: state.FailedAttempts,
                data: new
                {
                    tenantId = state.TenantId,
                    invoiceId = invoice?.Id ?? state.CurrentInvoiceId,
                    attemptCount = state.FailedAttempts,
                    suspendedAt = state.SuspendedAt,
                },
                occurredAtUtc: now)).ConfigureAwait(false);
        }

        await EnqueueTenantStageEmailSafeAsync(
            state.TenantId,
            state.Stage,
            state.FailedAttempts,
            nextAdvanceAt,
            invoice?.AmountRemaining > 0 ? invoice.AmountRemaining : (invoice?.AmountDue ?? 0L),
            invoice?.Currency ?? "usd",
            now,
            ct).ConfigureAwait(false);

        _logger.LogInformation(
            "Dunning transition tenantId={TenantId} invoiceId={InvoiceId} fromStage={FromStage} toStage={ToStage} attemptCount={AttemptCount}",
            state.TenantId, invoice?.Id ?? state.CurrentInvoiceId, fromStage, state.Stage, state.FailedAttempts);
    }

    private async Task<BillingDunningState> GetOrCreateStateAsync(
        Guid tenantId, DateTime now, CancellationToken ct)
    {
        var state = await _cp.BillingDunningStates
            .FirstOrDefaultAsync(s => s.TenantId == tenantId, ct)
            .ConfigureAwait(false);
        if (state is not null) return state;

        state = new BillingDunningState
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            Stage = DunningStages.Active,
            FailedAttempts = 0,
            LastObservedAttemptCount = 0,
            UpdatedAt = now,
        };
        _cp.BillingDunningStates.Add(state);
        return state;
    }

    private async Task EnqueueTenantStageEmailSafeAsync(
        Guid tenantId,
        string stage,
        int attemptCount,
        DateTime? nextRetryUtc,
        long amountDueCents,
        string currency,
        DateTime nowUtc,
        CancellationToken ct)
    {
        try
        {
            var recipient = await ResolveTenantOwnerEmailAsync(tenantId, ct).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(recipient))
            {
                return;
            }

            var composed = BillingDunningEmailComposer.ComposeForStage(
                stage, attemptCount, nextRetryUtc, amountDueCents, currency);

            // Prefer tenant EmailOutbox when tenant DB factory is available; fall back
            // to control-plane PlatformEmailOutbox (with TenantId stamped) when no
            // tenant DB is reachable (e.g. unit tests or pre-provisioned tenant).
            if (_tenantDbFactory is not null)
            {
                try
                {
                    await using var tenantDb = await _tenantDbFactory
                        .CreateAsync(tenantId, ct)
                        .ConfigureAwait(false);
                    var row = BillingDunningEmailComposer.ToTenantOutboxRow(
                        tenantId, recipient, _options.FromAddress, composed, nowUtc);
                    tenantDb.EmailOutbox.Add(row);
                    await tenantDb.SaveChangesAsync(ct).ConfigureAwait(false);
                    _logger.LogDebug(
                        "Dunning email enqueued to tenant outbox template={Template} outboxId={OutboxId} tenantId={TenantId}",
                        composed.Template, row.Id, tenantId);
                    return;
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Tenant email outbox unavailable for tenantId={TenantId}; falling back to platform outbox.", tenantId);
                }
            }

            var platformRow = BillingDunningEmailComposer.ToPlatformOutboxRow(
                tenantId, recipient, _options.FromAddress, composed, nowUtc);
            _cp.PlatformEmailOutbox.Add(platformRow);
            await _cp.SaveChangesAsync(ct).ConfigureAwait(false);
            _logger.LogDebug(
                "Dunning email enqueued to platform outbox template={Template} outboxId={OutboxId} tenantId={TenantId}",
                composed.Template, platformRow.Id, tenantId);
        }
        catch (Exception ex)
        {
            // Dev Notes: outbox failure must never block the dunning transition or webhook ack.
            _logger.LogWarning(ex, "Failed to enqueue dunning email for tenantId={TenantId} stage={Stage}", tenantId, stage);
        }
    }

    private async Task<string?> ResolveTenantOwnerEmailAsync(Guid tenantId, CancellationToken ct)
    {
        var ownerEmail = await _cp.TenantMemberships
            .AsNoTracking()
            .Where(m => m.TenantId == tenantId && (m.Role == "owner" || m.Role == "admin"))
            .OrderBy(m => m.Role == "owner" ? 0 : 1)
            .Select(m => m.User.Email)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);

        if (!string.IsNullOrWhiteSpace(ownerEmail))
        {
            return ownerEmail;
        }

        return await _cp.Users
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId)
            .Select(u => u.Email)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);
    }

    private async Task CancelPendingTaskSafeAsync(Guid taskId, string reason, CancellationToken ct)
    {
        try
        {
            await _tasks.DeadLetterAsync(taskId, reason, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Pending advance task {TaskId} could not be cancelled (may already be terminal).", taskId);
        }
    }

    private void InvalidateQuotaSafe(Guid tenantId)
    {
        try
        {
            _quotaService?.Invalidate(tenantId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "QuotaService.Invalidate failed after suspend/reinstate for tenantId={TenantId}", tenantId);
        }
    }
}
