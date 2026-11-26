using Tamma.Core.Documents.Channels;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (D10) — one item delivered to a tenant's Orchestrator Agent over
/// <see cref="IOrchestratorInbox"/>.
/// </summary>
public sealed record OrchestratorInboxItem(
    Guid ItemId,
    Guid TenantId,
    ChannelMessage Message,
    DateTimeOffset EnqueuedAt,
    Guid? ActingUserId = null);

/// <summary>
/// Story 39-17 (D10) / Story 39-18 lockstep seam — the in-process inbox each
/// per-tenant <see cref="OrchestratorAgentInstance"/> consumes.
///
/// <para>Story 39-17 ships <see cref="InMemoryOrchestratorInbox"/> for
/// development and deterministic tests; Story 39-18 swaps in
/// <c>PersistedOrchestratorInbox</c> backed by <c>channel_outbox</c> so
/// restarts drain every unacked row without loss.</para>
/// </summary>
public interface IOrchestratorInbox
{
    /// <summary>
    /// Enqueue an item for <paramref name="item"/>.<see cref="OrchestratorInboxItem.TenantId"/>.
    /// Signals live subscribers and wakes <c>OrchestratorAgentHost</c> on-demand.
    /// </summary>
    Task EnqueueAsync(OrchestratorInboxItem item, CancellationToken ct = default);

    /// <summary>
    /// Subscribe to pending (unacked) then live items for <paramref name="tenantId"/>.
    /// Pending items are re-delivered on restart until acknowledged via <see cref="AckAsync"/>.
    /// </summary>
    IAsyncEnumerable<OrchestratorInboxItem> SubscribeAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>
    /// Mark <paramref name="itemId"/> acknowledged for <paramref name="tenantId"/>.
    /// Idempotent — acknowledging an already-acked item is a no-op.
    /// </summary>
    Task AckAsync(Guid tenantId, Guid itemId, CancellationToken ct = default);

    /// <summary>
    /// Return tenants that currently have pending (unacked) items waiting.
    /// Used by <c>OrchestratorAgentHost</c> on startup to bootstrap active tenants.
    /// </summary>
    Task<IReadOnlyList<Guid>> GetTenantsWithPendingItemsAsync(CancellationToken ct = default);

    /// <summary>
    /// Stream tenant IDs as new items arrive so <c>OrchestratorAgentHost</c> can
    /// start per-tenant instances on demand without polling.
    /// </summary>
    IAsyncEnumerable<Guid> WatchTenantActivityAsync(CancellationToken ct = default);
}
