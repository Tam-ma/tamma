using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (D10) — thread-safe in-memory <see cref="IOrchestratorInbox"/>
/// supporting pending-then-live replay, restart redelivery of unacked items,
/// idempotent <see cref="AckAsync"/>, and on-demand tenant activity signaling.
/// </summary>
public sealed class InMemoryOrchestratorInbox : IOrchestratorInbox
{
    private sealed class TenantQueue
    {
        public readonly object Gate = new();
        public readonly LinkedList<OrchestratorInboxItem> Pending = new();
        public readonly HashSet<Guid> AckedIds = new();
        public readonly List<Channel<OrchestratorInboxItem>> Subscribers = new();
    }

    private readonly ConcurrentDictionary<Guid, TenantQueue> _queues = new();
    private readonly Channel<Guid> _activity = Channel.CreateUnbounded<Guid>(
        new UnboundedChannelOptions { SingleReader = false, SingleWriter = false });

    public Task EnqueueAsync(OrchestratorInboxItem item, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(item);
        if (item.TenantId == Guid.Empty)
            throw new ArgumentException("TenantId is required.", nameof(item));

        var queue = _queues.GetOrAdd(item.TenantId, _ => new TenantQueue());
        List<Channel<OrchestratorInboxItem>> snapshot;
        lock (queue.Gate)
        {
            if (queue.AckedIds.Contains(item.ItemId))
                return Task.CompletedTask;
            if (queue.Pending.All(p => p.ItemId != item.ItemId))
                queue.Pending.AddLast(item);
            snapshot = new List<Channel<OrchestratorInboxItem>>(queue.Subscribers);
        }

        foreach (var ch in snapshot)
            ch.Writer.TryWrite(item);

        _activity.Writer.TryWrite(item.TenantId);
        return Task.CompletedTask;
    }

    public async IAsyncEnumerable<OrchestratorInboxItem> SubscribeAsync(
        Guid tenantId,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("TenantId is required.", nameof(tenantId));

        var queue = _queues.GetOrAdd(tenantId, _ => new TenantQueue());
        var live = Channel.CreateUnbounded<OrchestratorInboxItem>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

        List<OrchestratorInboxItem> initial;
        lock (queue.Gate)
        {
            initial = queue.Pending.ToList();
            queue.Subscribers.Add(live);
        }

        try
        {
            var yielded = new HashSet<Guid>();
            foreach (var item in initial)
            {
                ct.ThrowIfCancellationRequested();
                yielded.Add(item.ItemId);
                yield return item;
            }

            await foreach (var item in live.Reader.ReadAllAsync(ct).ConfigureAwait(false))
            {
                if (!yielded.Add(item.ItemId))
                    continue;
                yield return item;
            }
        }
        finally
        {
            lock (queue.Gate)
            {
                queue.Subscribers.Remove(live);
            }
            live.Writer.TryComplete();
        }
    }

    public Task AckAsync(Guid tenantId, Guid itemId, CancellationToken ct = default)
    {
        if (!_queues.TryGetValue(tenantId, out var queue))
            return Task.CompletedTask;

        lock (queue.Gate)
        {
            queue.AckedIds.Add(itemId);
            var node = queue.Pending.First;
            while (node is not null)
            {
                if (node.Value.ItemId == itemId)
                {
                    queue.Pending.Remove(node);
                    break;
                }
                node = node.Next;
            }
        }

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<Guid>> GetTenantsWithPendingItemsAsync(CancellationToken ct = default)
    {
        var active = new List<Guid>();
        foreach (var kv in _queues)
        {
            lock (kv.Value.Gate)
            {
                if (kv.Value.Pending.Count > 0)
                    active.Add(kv.Key);
            }
        }
        return Task.FromResult<IReadOnlyList<Guid>>(active);
    }

    public async IAsyncEnumerable<Guid> WatchTenantActivityAsync(
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        await foreach (var tid in _activity.Reader.ReadAllAsync(ct).ConfigureAwait(false))
        {
            yield return tid;
        }
    }

    /// <summary>Test helper: count currently pending (unacked) items for a tenant.</summary>
    public int PendingCount(Guid tenantId)
    {
        if (!_queues.TryGetValue(tenantId, out var queue)) return 0;
        lock (queue.Gate) return queue.Pending.Count;
    }
}
