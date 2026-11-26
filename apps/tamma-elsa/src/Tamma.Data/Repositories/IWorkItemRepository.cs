using Tamma.Core.Tracking;
using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <summary>
/// Filter + keyset-paging query for <see cref="IWorkItemRepository.ListAsync"/>
/// and <see cref="IWorkItemRepository.ListWithRollupsAsync"/>.
/// Ordering is always <c>(Rank, Id)</c> ascending — the DB's <c>COLLATE "C"</c>
/// rank order IS the API order (Story 44-1 AC4), with immutable UUIDv7 <c>Id</c>
/// as the tie-break so sanctioned <see cref="IWorkItemRepository.RekeyAsync"/>
/// mutations never duplicate or skip rows across pages (Story 44-3 AC12 / D13).
/// <see cref="AfterRank"/>/<see cref="AfterId"/> are the keyset cursor (the last
/// row of the previous page); both-null = first page.
///
/// <para><b>Deliberately carries NO principal plane</b> — no <c>UserId</c> /
/// <c>TenantId</c> ownership filter exists on any work-item surface (story
/// AC7 / epic D6; pinned by <c>TrackerOwnershipTests</c>).
/// <see cref="AssigneeUserId"/> is assignment, not ownership.</para>
/// </summary>
public sealed record WorkItemQuery
{
    public Guid? ProjectId { get; init; }

    /// <summary><c>WorkItemStatus</c> wire strings; null/empty = all.</summary>
    public IReadOnlyCollection<string>? Statuses { get; init; }

    /// <summary><c>WorkItemKind</c> wire strings; null/empty = all.</summary>
    public IReadOnlyCollection<string>? Kinds { get; init; }

    public Guid? AssigneeUserId { get; init; }
    public Guid? IterationId { get; init; }

    /// <summary>Filter to children of this parent. See <see cref="TopLevelOnly"/> for null-parent.</summary>
    public Guid? ParentId { get; init; }

    /// <summary>True = only items with no parent (top-level).</summary>
    public bool TopLevelOnly { get; init; }

    /// <summary>Case-insensitive substring match over the title.</summary>
    public string? TitleContains { get; init; }

    /// <summary>
    /// Story 44-2 — the external-linked filter: true keeps only items carrying
    /// an <c>ExternalRefJson</c> (imported, 44-8's plane), false keeps only
    /// native items, null does not filter. Expressed here rather than as a
    /// post-query filter in the API so it composes with the keyset cursor —
    /// filtering a page after the fact makes <c>nextCursor</c> lie.
    /// </summary>
    public bool? ExternalLinked { get; init; }

    /// <summary>
    /// Story 44-2 (review MINOR-9, 2026-07-29) — the estimate-presence filter:
    /// true keeps only items carrying an <c>Estimate</c>, false only those
    /// without, null does not filter. Exists so the PROJECT write can enforce
    /// the same estimate/scale coherence rule the work-item write already
    /// enforces: setting a project's scale to <c>not_used</c> while it holds
    /// estimated items would otherwise leave stored estimates that no work-item
    /// write could have created.
    /// </summary>
    public bool? HasEstimate { get; init; }

    public string? AfterRank { get; init; }
    public Guid? AfterId { get; init; }
    public int Limit { get; init; } = 100;
}

/// <summary>
/// Story 44-3 AC6 — one work item paired with its SQL-aggregated direct-child
/// roll-up counts (computed in the same query via <c>LEFT JOIN LATERAL</c>,
/// never N+1).
/// </summary>
public sealed record WorkItemWithRollup(
    WorkItemEntity Item,
    int ChildCount,
    IReadOnlyDictionary<string, int> ChildCountByStatus);

/// <summary>
/// Story 44-3 AC5/AC6 — one node of a work-item subtree returned in DFS
/// pre-order by a single recursive CTE query, including depth (1 = root) and
/// direct-child roll-up counts.
/// </summary>
public sealed record WorkItemSubtreeNode(
    WorkItemEntity Item,
    int Depth,
    int ChildCount,
    IReadOnlyDictionary<string, int> ChildCountByStatus);

/// <summary>
/// Story 44-4 AC5/AC6 (D4/D5) — query parameters for the single-statement
/// window-function board read projection.
/// </summary>
public sealed record BoardQuery
{
    public required Guid ProjectId { get; init; }
    public required BoardGroupBy GroupBy { get; init; }
    public Guid? IterationId { get; init; }
    public Guid? AssigneeUserId { get; init; }
    public IReadOnlyCollection<string>? Kinds { get; init; }
    public int PerColumnLimit { get; init; } = 50;

    /// <summary>Optional single-column scope when paging a column's <c>nextCursor</c>.</summary>
    public string? ColumnKey { get; init; }
    public string? AfterRank { get; init; }
    public Guid? AfterId { get; init; }
}

/// <summary>
/// One work item row returned by <see cref="IWorkItemRepository.BoardQueryAsync"/>,
/// carrying its partitioned column key, total column item count, and direct-child roll-ups.
/// </summary>
public sealed record BoardItemRow(
    WorkItemEntity Item,
    string GroupKey,
    int GroupTotal,
    int ChildCount,
    IReadOnlyDictionary<string, int> ChildCountByStatus);

/// <summary>
/// Persistence seam for <c>work_items</c> + <c>work_item_relations</c>
/// (Story 44-1). Tenant-schema resident; <b>no mode split</b> (story AC7 /
/// epic D6 — a work item is content, and no method here filters on a
/// principal ownership plane).
///
/// <para><b>Key minting (AC5):</b> <see cref="CreateAsync"/> mints
/// <c>(Number, Key)</c> from the project's <c>NextNumber</c> counter under a
/// <c>SELECT ... FOR UPDATE</c> row lock inside the create transaction —
/// gap-free, monotone, concurrency-safe. The key string is
/// <c>WorkItemRef.ToWire()</c> and is FROZEN from that moment (44-0 AC8).</para>
///
/// <para><b>Key history:</b> <see cref="RekeyAsync"/> is the one sanctioned
/// exception — it records the outgoing key via
/// <c>WorkItemKeyHistory.Record</c>, and <see cref="GetByKeyAsync"/> resolves
/// current-or-previous so already-written <c>DocumentInstance.IssueId</c> and
/// DCB tags keep finding the item.</para>
///
/// <para><b>Relations:</b> the relation writers are the ONLY writers of
/// <c>work_item_relations</c> and always store the
/// <c>WorkItemRelationKindExtensions.Canonicalize</c> form (symmetric kinds
/// lower-id-first), which the unique index assumes.</para>
/// </summary>
public interface IWorkItemRepository
{
    Task<WorkItemEntity?> GetAsync(Guid id);

    /// <summary>Story 44-4 AC3 — batch load work items by id in one query.</summary>
    Task<List<WorkItemEntity>> GetByIdsAsync(IReadOnlyCollection<Guid> ids);

    /// <summary>
    /// Story 44-4 AC5/AC6 (D4) — single-statement window-function board query
    /// partitioned by <see cref="BoardQuery.GroupBy"/>, ordered by <c>(Rank, Id)</c>
    /// inside Postgres, capped at <c>PerColumnLimit + 1</c> per column (the +1
    /// sentinel computes exact <c>hasMore</c> even under cursor paging).
    /// </summary>
    Task<List<BoardItemRow>> BoardQueryAsync(BoardQuery query);

    /// <summary>
    /// Story 44-4 AC3/AC9 — set <c>IterationId</c> (or clear when null) on a batch
    /// of work items in <paramref name="projectId"/> in ONE SQL <c>UPDATE</c> inside
    /// ONE transaction.
    /// </summary>
    Task<int> BulkSetIterationAsync(
        Guid projectId, IReadOnlyList<Guid> workItemIds, Guid? iterationId);

    /// <summary>
    /// Resolve a wire key (<c>TAM-142</c>) to its item — the CURRENT key or
    /// any recorded previous key (44-0 AC8; ordinal, never normalized).
    /// </summary>
    Task<WorkItemEntity?> GetByKeyAsync(string key);

    /// <summary>List per <see cref="WorkItemQuery"/>, ordered <c>(Rank, Id)</c>, keyset-paged.</summary>
    Task<List<WorkItemEntity>> ListAsync(WorkItemQuery query);

    /// <summary>
    /// Story 44-3 AC6 — list per <see cref="WorkItemQuery"/>, ordered <c>(Rank, Id)</c>,
    /// keyset-paged, with direct-child roll-up counts (<c>ChildCount</c>,
    /// <c>ChildCountByStatus</c>) computed in the SAME SQL statement via
    /// <c>LEFT JOIN LATERAL</c> (constant query count regardless of page size).
    /// </summary>
    Task<List<WorkItemWithRollup>> ListWithRollupsAsync(WorkItemQuery query);

    /// <summary>
    /// Story 44-3 AC7/AC8 — all work items in a project ordered <c>(Rank, Id)</c>,
    /// unbounded, used by the <c>BacklogOrdering</c> apply seam so unreferenced
    /// items beyond page 1 are never truncated when re-ranking a full project.
    /// </summary>
    Task<List<WorkItemEntity>> ListAllForProjectAsync(Guid projectId);

    /// <summary>
    /// Story 44-3 AC5/AC6 — return the work item and all descendants up to
    /// <paramref name="maxDepth"/> (always <see cref="TrackerHierarchy.MaxDepth"/>)
    /// in ONE recursive CTE query with SQL-computed roll-up counts, ordered in
    /// DFS pre-order by <c>(SiblingRank, Id)</c> so a client renders a tree
    /// without a second sort. Empty list when <paramref name="id"/> does not exist.
    /// </summary>
    Task<List<WorkItemSubtreeNode>> GetSubtreeAsync(Guid id, int maxDepth);

    /// <summary>
    /// Story 44-3 AC3 — current maximum <c>Rank</c> in <paramref name="projectId"/>
    /// (optionally excluding <paramref name="excludeWorkItemId"/>), or null when
    /// none exists. Used to place an item at the end of a project backlog.
    /// </summary>
    Task<string?> GetMaxRankAsync(Guid projectId, Guid? excludeWorkItemId = null);

    /// <summary>
    /// Create a work item. Mints <c>Number</c>/<c>Key</c> under the project
    /// row lock; assigns a UUIDv7 id when unset; appends <c>Rank</c> /
    /// <c>SiblingRank</c> via <c>Rank.Append</c> over the current maxima when
    /// unset; validates every vocabulary column against the Core wire sets
    /// (fail-loud <c>TammaError</c> before the DB CHECK ever fires).
    /// </summary>
    Task<WorkItemEntity> CreateAsync(WorkItemEntity item);

    /// <summary>
    /// Update title/description/kind/priority/type/assignee/estimate/external
    /// ref. Bumps <see cref="WorkItemEntity.Version"/>. Never touches
    /// <c>Key</c>/<c>Number</c>/<c>PreviousKeys</c> (frozen — see
    /// <see cref="RekeyAsync"/>), <c>Status</c> (<see cref="SetStatusAsync"/>),
    /// or the rank columns (<see cref="SetRanksAsync"/>).
    /// </summary>
    /// <param name="expectedVersion">
    /// The caller's <c>If-Match</c> precondition, applied ATOMICALLY with the
    /// write as <c>WHERE "Version" = @expected</c> (44-2 review 2026-07-29 —
    /// the service check and this write happen in DIFFERENT contexts, so a
    /// service-level check alone leaves a real lost-update window). A mismatch
    /// raises the typed, retryable <c>TRACKER.CONCURRENCY_CONFLICT</c>. Null
    /// means "no precondition".
    /// </param>
    Task<WorkItemEntity?> UpdateAsync(WorkItemEntity item, int? expectedVersion = null);

    /// <summary>
    /// Transition status (wire string, validated). Stamps
    /// <see cref="WorkItemEntity.ClosedAt"/> when the new status is terminal
    /// (derived via <c>WorkItemStatus.IsTerminal()</c> — never a set literal)
    /// and clears it on reopen.
    /// </summary>
    /// <param name="expectedVersion">See <see cref="UpdateAsync"/>.</param>
    Task<WorkItemEntity?> SetStatusAsync(Guid id, string statusWire, int? expectedVersion = null);

    /// <summary>
    /// Move the item in either ordering axis. A drag is ONE UPDATE (44-0 D7 /
    /// 44-3 AC3). Null leaves that axis unchanged; ranks are validated canonical
    /// (<c>Rank.IsValid</c>).
    /// </summary>
    /// <param name="expectedVersion">See <see cref="UpdateAsync"/>.</param>
    Task<WorkItemEntity?> SetRanksAsync(
        Guid id, string? rank, string? siblingRank, int? expectedVersion = null);

    /// <summary>
    /// Story 44-3 AC7/AC8 — update <c>Rank</c> for many items in
    /// <paramref name="projectId"/> in ONE bulk SQL <c>UPDATE</c> inside ONE
    /// transaction. Validates every rank via <c>Rank.IsValid</c> before touching
    /// the database. Returns the number of rows updated.
    /// </summary>
    Task<int> BulkSetRanksAsync(Guid projectId, IReadOnlyList<(Guid Id, string Rank)> updates);

    /// <summary>
    /// Reparent (null = make top-level) and place among the new siblings.
    /// Structural validation (cycles, depth, the Epic kind rule) is Story
    /// 44-3's transactional seam (<see cref="ReparentTransactionalAsync"/>) —
    /// this is the bare storage seam kept for low-level callers.
    /// </summary>
    Task<WorkItemEntity?> SetParentAsync(Guid id, Guid? parentId, string? siblingRank = null);

    /// <summary>
    /// Story 44-3 AC1/AC2 (D1/D2) — validate and apply a reparent inside ONE
    /// Postgres transaction under a <c>SELECT ... FOR UPDATE</c> lock over the
    /// project row (serializing concurrent reparents with zero deadlocks so two
    /// simultaneous reparents can never jointly form a cycle). Checks:
    /// <c>CROSS_PROJECT_PARENT</c>, <c>KIND_NOT_PERMITTED</c>,
    /// <c>WOULD_CREATE_CYCLE</c>, and <c>MAX_DEPTH_EXCEEDED</c> against
    /// persisted state inside the write transaction, and honours
    /// <paramref name="expectedVersion"/> atomically. Returns null when
    /// <paramref name="id"/> does not exist.
    /// </summary>
    Task<WorkItemEntity?> ReparentTransactionalAsync(
        Guid id, Guid? parentId, int? expectedVersion = null);

    /// <summary>
    /// The one sanctioned key change (44-0 AC8): a deliberate operator
    /// re-key. Parses + validates <paramref name="newKey"/>, appends the
    /// outgoing key to <c>PreviousKeys</c> via
    /// <c>WorkItemKeyHistory.Record</c> (idempotent, order-preserving), and
    /// swaps the current key. A project MOVE must NOT call this — the key is
    /// frozen on a move.
    /// </summary>
    Task<WorkItemEntity?> RekeyAsync(Guid id, string newKey);

    /// <summary>
    /// Delete an item. Children RESTRICT the parent FK (44-2 maps to 409);
    /// the item's relation edges cascade away.
    /// </summary>
    /// <param name="expectedVersion">See <see cref="UpdateAsync"/>.</param>
    Task<bool> DeleteAsync(Guid id, int? expectedVersion = null);

    // ── Relations (44-0 AC14; stored canonical — D8) ──

    /// <summary>
    /// Add a relation edge. Canonicalizes via the shipped
    /// <c>WorkItemRelationKindExtensions.Canonicalize</c> (self-relation
    /// throws <c>TRACKER.SELF_RELATION</c>; symmetric kinds stored
    /// lower-id-first so a mirror insert collides with the original).
    /// Idempotent: re-adding an existing edge returns the stored row.
    /// </summary>
    Task<WorkItemRelation> AddRelationAsync(
        Guid sourceId, Guid targetId, WorkItemRelationKind kind, Guid? createdByUserId = null);

    /// <summary>Remove an edge (canonicalized before lookup). False when absent.</summary>
    Task<bool> RemoveRelationAsync(Guid sourceId, Guid targetId, WorkItemRelationKind kind);

    /// <summary>Every edge touching the item, in either endpoint position.</summary>
    Task<List<WorkItemRelation>> ListRelationsAsync(Guid workItemId);
}
