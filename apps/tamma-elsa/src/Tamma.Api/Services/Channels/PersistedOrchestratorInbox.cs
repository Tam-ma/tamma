using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Tamma.Api.Services.Orchestrator;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Channels;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Channels;

/// <summary>
/// Story 39-18 (AC4 / AC7) — in-process notification seam bridging
/// <see cref="ChannelOutboxService"/> writes/republishes to the singleton
/// <see cref="PersistedOrchestratorInbox"/> without double-persisting rows.
/// </summary>
public interface IOrchestratorInboxNotifier
{
    /// <summary>
    /// Signal live subscribers and <c>OrchestratorAgentHost</c> that an
    /// orchestrator-audience item has already been persisted to <c>channel_outbox</c>.
    /// </summary>
    void NotifyPersisted(OrchestratorInboxItem item);
}

/// <summary>
/// Story 39-18 + Story 39-17 lockstep — Postgres-persisted
/// <see cref="IOrchestratorInbox"/> backed by <c>channel_outbox</c>
/// (<see cref="IChannelOutboxRepository"/>).
///
/// <para><b>Transport is never the source of truth (AC6):</b> every enqueued
/// item is durably persisted to the tenant's <c>channel_outbox</c> table BEFORE
/// live subscribers or <c>OrchestratorAgentHost</c> are signaled. On restart,
/// <see cref="SubscribeAsync"/> replays every unacked (<c>pending</c> or
/// <c>delivered</c>) inbound orchestrator row in UUID v7 order before tailing
/// live notifications; <see cref="AckAsync"/> flips the outbox row to
/// <c>acked</c> idempotently.</para>
/// </summary>
public sealed class PersistedOrchestratorInbox : IOrchestratorInbox, IOrchestratorInboxNotifier
{
    private const int ReplayBatchLimit = 500;

    private sealed class TenantHub
    {
        public readonly object Gate = new();
        public readonly List<Channel<OrchestratorInboxItem>> Subscribers = new();
    }

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<PersistedOrchestratorInbox> _logger;
    private readonly ConcurrentDictionary<Guid, TenantHub> _hubs = new();
    private readonly Channel<Guid> _activity = Channel.CreateUnbounded<Guid>(
        new UnboundedChannelOptions { SingleReader = false, SingleWriter = false });

    public PersistedOrchestratorInbox(
        IServiceScopeFactory scopeFactory,
        ILogger<PersistedOrchestratorInbox> logger)
    {
        _scopeFactory = scopeFactory ?? throw new ArgumentNullException(nameof(scopeFactory));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <summary>
    /// Returns <c>true</c> for message kinds the Orchestrator Agent consumes
    /// inbound (excludes outbound agent replies like <see cref="GuidanceReply"/>
    /// or <see cref="DecisionProvided"/>).
    /// </summary>
    public static bool IsInboundForOrchestrator(ChannelMessage message) =>
        message is AcceptanceRequested or EscalationRaised or GuidanceQuery;

    public async Task EnqueueAsync(OrchestratorInboxItem item, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(item);
        if (item.TenantId == Guid.Empty)
            throw new ArgumentException("TenantId is required.", nameof(item));
        if (item.ItemId == Guid.Empty)
            throw new ArgumentException("ItemId is required.", nameof(item));

        var envelope = new ChannelEnvelope(
            MessageId: item.ItemId,
            TenantId: item.TenantId,
            Audience: ChannelAudience.Orchestrator,
            RecipientUserId: null,
            Message: item.Message,
            CreatedAt: item.EnqueuedAt == default ? DateTimeOffset.UtcNow : item.EnqueuedAt);

        var row = new ChannelOutboxMessage
        {
            Id = envelope.MessageId,
            TenantId = envelope.TenantId,
            Audience = ChannelAudience.Orchestrator.ToWire(),
            RecipientUserId = null,
            Kind = ChannelMessageKinds.KindOf(item.Message),
            PayloadJson = JsonSerializer.Serialize(envelope, DocumentJson.Options),
            DecisionSessionId = item.Message is AcceptanceRequested acc ? acc.Request.DecisionSessionId : null,
            CreatedAt = envelope.CreatedAt.UtcDateTime,
        };

        await using (var scope = _scopeFactory.CreateAsyncScope())
        {
            scope.ServiceProvider.GetService<ITenantContext>()?.SetTenantId(item.TenantId);
            var repo = scope.ServiceProvider.GetRequiredService<IChannelOutboxRepository>();
            await repo.EnqueueAsync(row, ct).ConfigureAwait(false);
        }

        NotifyPersisted(item);
    }

    public void NotifyPersisted(OrchestratorInboxItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        if (item.TenantId == Guid.Empty || !IsInboundForOrchestrator(item.Message))
            return;

        var hub = _hubs.GetOrAdd(item.TenantId, _ => new TenantHub());
        List<Channel<OrchestratorInboxItem>> snapshot;
        lock (hub.Gate)
        {
            snapshot = new List<Channel<OrchestratorInboxItem>>(hub.Subscribers);
        }

        foreach (var ch in snapshot)
            ch.Writer.TryWrite(item);

        _activity.Writer.TryWrite(item.TenantId);
    }

    public async IAsyncEnumerable<OrchestratorInboxItem> SubscribeAsync(
        Guid tenantId,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("TenantId is required.", nameof(tenantId));

        var hub = _hubs.GetOrAdd(tenantId, _ => new TenantHub());
        var live = Channel.CreateUnbounded<OrchestratorInboxItem>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

        // Register BEFORE scanning DB so no item persisted concurrently is missed.
        lock (hub.Gate)
        {
            hub.Subscribers.Add(live);
        }

        try
        {
            var yielded = new HashSet<Guid>();

            // 1. Replay all unacked orchestrator rows in UUID v7 time order.
            List<ChannelOutboxMessage> pendingRows;
            await using (var scope = _scopeFactory.CreateAsyncScope())
            {
                scope.ServiceProvider.GetService<ITenantContext>()?.SetTenantId(tenantId);
                var repo = scope.ServiceProvider.GetRequiredService<IChannelOutboxRepository>();
                pendingRows = await repo.ListUnackedAsync(
                    tenantId,
                    ChannelAudience.Orchestrator.ToWire(),
                    recipientUserId: null,
                    ReplayBatchLimit,
                    ct).ConfigureAwait(false);
            }

            foreach (var row in pendingRows)
            {
                ct.ThrowIfCancellationRequested();
                var item = TryDeserializeInbound(row);
                if (item is null) continue;

                yielded.Add(item.ItemId);
                await MarkDeliveredBestEffortAsync(tenantId, row.Id, ct).ConfigureAwait(false);
                yield return item;
            }

            // 2. Tail live persisted notifications (deduplicated against initial replay).
            await foreach (var item in live.Reader.ReadAllAsync(ct).ConfigureAwait(false))
            {
                if (item.TenantId != tenantId || !IsInboundForOrchestrator(item.Message))
                    continue;
                if (!yielded.Add(item.ItemId))
                    continue;

                await MarkDeliveredBestEffortAsync(tenantId, item.ItemId, ct).ConfigureAwait(false);
                yield return item;
            }
        }
        finally
        {
            lock (hub.Gate)
            {
                hub.Subscribers.Remove(live);
            }
            live.Writer.TryComplete();
        }
    }

    public async Task AckAsync(Guid tenantId, Guid itemId, CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty || itemId == Guid.Empty)
            return;

        await using var scope = _scopeFactory.CreateAsyncScope();
        scope.ServiceProvider.GetService<ITenantContext>()?.SetTenantId(tenantId);
        var repo = scope.ServiceProvider.GetRequiredService<IChannelOutboxRepository>();
        await repo.AckAsync(tenantId, itemId, recipientUserId: null, ct).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<Guid>> GetTenantsWithPendingItemsAsync(CancellationToken ct = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<IChannelOutboxRepository>();
        return await repo.ListTenantsWithPendingAsync(ct).ConfigureAwait(false);
    }

    public async IAsyncEnumerable<Guid> WatchTenantActivityAsync(
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        await foreach (var tenantId in _activity.Reader.ReadAllAsync(ct).ConfigureAwait(false))
        {
            yield return tenantId;
        }
    }

    private OrchestratorInboxItem? TryDeserializeInbound(ChannelOutboxMessage row)
    {
        try
        {
            var envelope = JsonSerializer.Deserialize<ChannelEnvelope>(row.PayloadJson, DocumentJson.Options);
            if (envelope is null || !IsInboundForOrchestrator(envelope.Message))
                return null;

            return new OrchestratorInboxItem(
                ItemId: row.Id,
                TenantId: row.TenantId,
                Message: envelope.Message,
                EnqueuedAt: envelope.CreatedAt,
                ActingUserId: null);
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex,
                "PersistedOrchestratorInbox: row {MessageId} for tenant {TenantId} has undeserializable payload; skipping.",
                row.Id, row.TenantId);
            return null;
        }
    }

    private async Task MarkDeliveredBestEffortAsync(Guid tenantId, Guid messageId, CancellationToken ct)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            scope.ServiceProvider.GetService<ITenantContext>()?.SetTenantId(tenantId);
            var repo = scope.ServiceProvider.GetRequiredService<IChannelOutboxRepository>();
            await repo.MarkDeliveredAsync(tenantId, messageId, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex,
                "PersistedOrchestratorInbox: MarkDeliveredAsync failed for row {MessageId} (tenant {TenantId}); delivery proceeds.",
                messageId, tenantId);
        }
    }
}
