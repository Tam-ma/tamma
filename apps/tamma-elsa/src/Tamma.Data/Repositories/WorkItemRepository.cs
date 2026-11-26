using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Tamma.Core;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Types;
using Tamma.Core.Tracking;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <summary>
/// Tenant-scoped <c>work_items</c> + <c>work_item_relations</c> repository
/// (Story 44-1). Same seam shape as <see cref="AcceptanceRulesRepository"/>
/// (<see cref="ITenantDbContextFactory"/> + ambient <see cref="ITenantContext"/>).
///
/// <para>Storage-layer invariants owned here: gap-free key minting under the
/// project row lock (AC5); the frozen key + <c>PreviousKeys</c> history
/// (44-0 AC8 — <c>WorkItemKeyHistory</c> is the single implementation);
/// canonical relation-edge form (44-0 AC14 —
/// <c>WorkItemRelationKindExtensions.Canonicalize</c> is the single
/// implementation, called, never reimplemented); vocabulary validation at the
/// write boundary so junk fails as a typed <c>TammaError</c> rather than a DB
/// CHECK violation. Structural hierarchy validation (cycles, depth, the Epic
/// kind rule) is Story 44-3's service, NOT this class.</para>
/// </summary>
public class WorkItemRepository(
    ITenantDbContextFactory tenantDbFactory,
    ITenantContext tenantContext) : IWorkItemRepository
{
    private Guid RequireTenantId() => tenantContext.TenantId
        ?? throw new InvalidOperationException(
            "WorkItemRepository requires an ambient tenant id. Tracker tables are "
            + "tenant-schema resident (Epic 44 D5).");

    public async Task<WorkItemEntity?> GetAsync(Guid id)
    {
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        return await db.WorkItems.FirstOrDefaultAsync(w => w.Id == id);
    }

    public async Task<List<WorkItemEntity>> GetByIdsAsync(IReadOnlyCollection<Guid> ids)
    {
        ArgumentNullException.ThrowIfNull(ids);
        if (ids.Count == 0)
            return [];
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        return await db.WorkItems.Where(w => ids.Contains(w.Id)).ToListAsync();
    }

    public async Task<List<BoardItemRow>> BoardQueryAsync(BoardQuery query)
    {
        ArgumentNullException.ThrowIfNull(query);
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);

        // Exhaustive switch over the closed BoardGroupBy enum (AC6 / D5) —
        // never interpolated from caller input.
        var groupKeyExpr = query.GroupBy switch
        {
            BoardGroupBy.Status => """w."Status" """,
            BoardGroupBy.Kind => """w."Kind" """,
            BoardGroupBy.Priority => """COALESCE(w."Priority", 'unprioritized')""",
            BoardGroupBy.Assignee => """COALESCE(w."AssigneeUserId"::text, 'unassigned')""",
            BoardGroupBy.Iteration => """COALESCE(w."IterationId"::text, 'backlog')""",
            _ => throw new ArgumentOutOfRangeException(nameof(query.GroupBy), query.GroupBy, null),
        };

        var where = new StringBuilder("""WHERE w."ProjectId" = @projectId""");
        var parameters = new List<object>
        {
            new NpgsqlParameter("projectId", query.ProjectId),
        };

        if (query.IterationId is { } iterationId)
        {
            where.Append(""" AND w."IterationId" = @iterationId""");
            parameters.Add(new NpgsqlParameter("iterationId", iterationId));
        }
        if (query.AssigneeUserId is { } assigneeId)
        {
            where.Append(""" AND w."AssigneeUserId" = @assigneeId""");
            parameters.Add(new NpgsqlParameter("assigneeId", assigneeId));
        }
        if (query.Kinds is { Count: > 0 } kinds)
        {
            where.Append(""" AND w."Kind" = ANY(@kinds)""");
            parameters.Add(new NpgsqlParameter("kinds", NpgsqlDbType.Array | NpgsqlDbType.Text)
            {
                Value = kinds.ToArray(),
            });
        }
        if (!string.IsNullOrWhiteSpace(query.ColumnKey))
        {
            where.Append($""" AND ({groupKeyExpr}) = @columnKey""");
            parameters.Add(new NpgsqlParameter("columnKey", query.ColumnKey));
        }

        // Cursor predicate applies ONLY to the ranked slice, AFTER GroupTotal is
        // computed over the full column so totalCount stays honest on page 2+.
        var cursorWhere = new StringBuilder();
        if (query.AfterRank is not null && query.AfterId is { } afterId)
        {
            cursorWhere.Append(""" AND (f."Rank" > @afterRank COLLATE "C" OR (f."Rank" = @afterRank COLLATE "C" AND f."Id" > @afterId))""");
            parameters.Add(new NpgsqlParameter("afterRank", query.AfterRank));
            parameters.Add(new NpgsqlParameter("afterId", afterId));
        }

        var perColumnLimit = query.PerColumnLimit is > 0 and <= 200 ? query.PerColumnLimit : 50;
        // Fetch perColumnLimit + 1 so the projection can tell exact `hasMore` even when paging with a cursor.
        parameters.Add(new NpgsqlParameter("fetchLimit", perColumnLimit + 1));

        // ONE single SQL statement (AC5 / D4): window function partitioned by group_key
        // ordered by (Rank COLLATE "C", Id), plus LEFT JOIN LATERAL direct-child roll-ups.
        var sql = $$"""
            WITH filtered AS (
                SELECT
                    w."Id", w."ProjectId", w."Key",
                    array_to_json(w."PreviousKeys")::text AS "PreviousKeysJson",
                    w."Number", w."Kind", w."Status", w."Priority", w."IssueType",
                    w."Title", w."Description", w."ParentId", w."IterationId",
                    w."Rank", w."SiblingRank", w."AssigneeUserId", w."CreatedByUserId",
                    w."Estimate", w."ExternalRefJson"::text AS "ExternalRefJson",
                    w."CreatedAt", w."UpdatedAt", w."ClosedAt", w."Version",
                    ({{groupKeyExpr}}) AS group_key
                FROM work_items w
                {{where}}
            ),
            totals AS (
                SELECT group_key, COUNT(*)::int AS group_total
                FROM filtered
                GROUP BY group_key
            ),
            ranked AS (
                SELECT
                    f.*,
                    t.group_total AS "GroupTotal",
                    ROW_NUMBER() OVER (
                        PARTITION BY f.group_key
                        ORDER BY f."Rank" COLLATE "C" ASC, f."Id" ASC
                    ) AS rn
                FROM filtered f
                JOIN totals t ON t.group_key = f.group_key
                WHERE TRUE {{cursorWhere}}
            )
            SELECT
                r."Id", r."ProjectId", r."Key", r."PreviousKeysJson",
                r."Number", r."Kind", r."Status", r."Priority", r."IssueType",
                r."Title", r."Description", r."ParentId", r."IterationId",
                r."Rank", r."SiblingRank", r."AssigneeUserId", r."CreatedByUserId",
                r."Estimate", r."ExternalRefJson",
                r."CreatedAt", r."UpdatedAt", r."ClosedAt", r."Version",
                r.group_key AS "GroupKey",
                r."GroupTotal",
                rollups.child_count AS "ChildCount",
                rollups.child_count_by_status_json AS "ChildCountByStatusJson"
            FROM ranked r
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(SUM(c.cnt), 0)::int AS child_count,
                    COALESCE(jsonb_object_agg(c."Status", c.cnt), jsonb_build_object())::text AS child_count_by_status_json
                FROM (
                    SELECT ch."Status", COUNT(*)::int AS cnt
                    FROM work_items ch
                    WHERE ch."ParentId" = r."Id"
                    GROUP BY ch."Status"
                ) c
            ) rollups ON TRUE
            WHERE r.rn <= @fetchLimit
            ORDER BY r.group_key COLLATE "C" ASC, r."Rank" COLLATE "C" ASC, r."Id" ASC
            """;

        var rows = await db.Database
            .SqlQueryRaw<BoardItemSqlRow>(sql, parameters.ToArray())
            .ToListAsync();

        return rows.Select(r => new BoardItemRow(
            ToEntity(r),
            r.GroupKey,
            r.GroupTotal,
            r.ChildCount,
            ParseStatusCounts(r.ChildCountByStatusJson))).ToList();
    }

    public async Task<int> BulkSetIterationAsync(
        Guid projectId, IReadOnlyList<Guid> workItemIds, Guid? iterationId)
    {
        ArgumentNullException.ThrowIfNull(workItemIds);
        if (workItemIds.Count == 0)
            return 0;

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        await using var tx = await db.Database.BeginTransactionAsync();

        const string sql = """
            UPDATE work_items
            SET "IterationId" = @iterationId,
                "UpdatedAt" = now(),
                "Version" = "Version" + 1
            WHERE "ProjectId" = @projectId
              AND "Id" = ANY(@ids)
            """;

        var affected = await db.Database.ExecuteSqlRawAsync(
            sql,
            new NpgsqlParameter("iterationId", NpgsqlDbType.Uuid)
            {
                Value = iterationId.HasValue ? iterationId.Value : DBNull.Value,
            },
            new NpgsqlParameter("projectId", projectId),
            new NpgsqlParameter("ids", NpgsqlDbType.Array | NpgsqlDbType.Uuid)
            {
                Value = workItemIds.ToArray(),
            });

        await tx.CommitAsync();
        return affected;
    }

    public async Task<WorkItemEntity?> GetByKeyAsync(string key)
    {
        if (string.IsNullOrWhiteSpace(key))
            return null;
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        // Current-or-previous (44-0 AC8 / WorkItemKeyHistory.Matches in SQL),
        // resolved DETERMINISTICALLY: the current-Key match (unique index)
        // always wins; only when no row currently holds the key do we fall
        // back to the previous-keys containment on the text[] column. A single
        // OR query with FirstOrDefault is nondeterministic when one row's
        // current key is another row's previous key (a rekey freed the key and
        // a later rekey re-took it).
        var current = await db.WorkItems.FirstOrDefaultAsync(w => w.Key == key);
        if (current is not null)
            return current;
        // Among previous-keys holders the Id order is a stable tie-break (a
        // key can sit in two rows' histories after chained rekeys).
        return await db.WorkItems
            .Where(w => w.PreviousKeys.Contains(key))
            .OrderBy(w => w.Id)
            .FirstOrDefaultAsync();
    }

    public async Task<List<WorkItemEntity>> ListAsync(WorkItemQuery query)
    {
        ArgumentNullException.ThrowIfNull(query);
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);

        var items = db.WorkItems.AsQueryable();
        if (query.ProjectId is { } projectId)
            items = items.Where(w => w.ProjectId == projectId);
        if (query.Statuses is { Count: > 0 } statuses)
            items = items.Where(w => statuses.Contains(w.Status));
        if (query.Kinds is { Count: > 0 } kinds)
            items = items.Where(w => kinds.Contains(w.Kind));
        if (query.AssigneeUserId is { } assignee)
            items = items.Where(w => w.AssigneeUserId == assignee);
        if (query.IterationId is { } iteration)
            items = items.Where(w => w.IterationId == iteration);
        if (query.TopLevelOnly)
            items = items.Where(w => w.ParentId == null);
        else if (query.ParentId is { } parent)
            items = items.Where(w => w.ParentId == parent);
        if (query.ExternalLinked is bool externalLinked)
        {
            items = externalLinked
                ? items.Where(w => w.ExternalRefJson != null)
                : items.Where(w => w.ExternalRefJson == null);
        }
        if (query.HasEstimate is bool hasEstimate)
        {
            items = hasEstimate
                ? items.Where(w => w.Estimate != null)
                : items.Where(w => w.Estimate == null);
        }
        if (!string.IsNullOrWhiteSpace(query.TitleContains))
            items = items.Where(w => EF.Functions.ILike(
                w.Title, $"%{EscapeLike(query.TitleContains)}%"));

        // Keyset cursor over the SQL order itself — (Rank, Id), both
        // DB-side comparisons, so paging can never disagree with the
        // COLLATE "C" ordering (AC4) and immutable UUIDv7 Id ensures a
        // sanctioned RekeyAsync never duplicates or skips rows across a
        // duplicate-rank boundary (Story 44-3 AC12 / D13).
        if (query.AfterRank is not null && query.AfterId is { } afterId)
        {
            items = items.Where(w => EF.Functions.GreaterThan(
                ValueTuple.Create(w.Rank, w.Id),
                ValueTuple.Create(query.AfterRank, afterId)));
        }

        var limit = query.Limit is > 0 and <= 500 ? query.Limit : 100;
        return await items
            .OrderBy(w => w.Rank)
            .ThenBy(w => w.Id)
            .Take(limit)
            .ToListAsync();
    }

    public async Task<List<WorkItemWithRollup>> ListWithRollupsAsync(WorkItemQuery query)
    {
        ArgumentNullException.ThrowIfNull(query);
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);

        var where = new StringBuilder("WHERE TRUE");
        var parameters = new List<object>();

        if (query.ProjectId is { } projectId)
        {
            where.Append(""" AND w."ProjectId" = @projectId""");
            parameters.Add(new NpgsqlParameter("projectId", projectId));
        }
        if (query.Statuses is { Count: > 0 } statuses)
        {
            where.Append(""" AND w."Status" = ANY(@statuses)""");
            parameters.Add(new NpgsqlParameter("statuses", NpgsqlDbType.Array | NpgsqlDbType.Text)
            {
                Value = statuses.ToArray(),
            });
        }
        if (query.Kinds is { Count: > 0 } kinds)
        {
            where.Append(""" AND w."Kind" = ANY(@kinds)""");
            parameters.Add(new NpgsqlParameter("kinds", NpgsqlDbType.Array | NpgsqlDbType.Text)
            {
                Value = kinds.ToArray(),
            });
        }
        if (query.AssigneeUserId is { } assignee)
        {
            where.Append(""" AND w."AssigneeUserId" = @assignee""");
            parameters.Add(new NpgsqlParameter("assignee", assignee));
        }
        if (query.IterationId is { } iteration)
        {
            where.Append(""" AND w."IterationId" = @iteration""");
            parameters.Add(new NpgsqlParameter("iteration", iteration));
        }
        if (query.TopLevelOnly)
        {
            where.Append(""" AND w."ParentId" IS NULL""");
        }
        else if (query.ParentId is { } parent)
        {
            where.Append(""" AND w."ParentId" = @parent""");
            parameters.Add(new NpgsqlParameter("parent", parent));
        }
        if (query.ExternalLinked is bool externalLinked)
        {
            where.Append(externalLinked
                ? """ AND w."ExternalRefJson" IS NOT NULL"""
                : """ AND w."ExternalRefJson" IS NULL""");
        }
        if (query.HasEstimate is bool hasEstimate)
        {
            where.Append(hasEstimate
                ? """ AND w."Estimate" IS NOT NULL"""
                : """ AND w."Estimate" IS NULL""");
        }
        if (!string.IsNullOrWhiteSpace(query.TitleContains))
        {
            where.Append(""" AND w."Title" ILIKE @titlePattern ESCAPE '\'""");
            parameters.Add(new NpgsqlParameter("titlePattern", $"%{EscapeLike(query.TitleContains)}%"));
        }
        if (query.AfterRank is not null && query.AfterId is { } afterId)
        {
            where.Append(""" AND (w."Rank" > @afterRank COLLATE "C" OR (w."Rank" = @afterRank COLLATE "C" AND w."Id" > @afterId))""");
            parameters.Add(new NpgsqlParameter("afterRank", query.AfterRank));
            parameters.Add(new NpgsqlParameter("afterId", afterId));
        }

        var limit = query.Limit is > 0 and <= 500 ? query.Limit : 100;
        parameters.Add(new NpgsqlParameter("limit", limit));

        // ONE single SQL statement (AC6 / D5): the CTE slices the keyset page first
        // and the LEFT JOIN LATERAL computes direct-child counts + per-status breakdown
        // for only the returned rows. Query count is constant (1) regardless of row count.
        var sql = $$"""
            WITH page AS (
                SELECT
                    w."Id", w."ProjectId", w."Key",
                    array_to_json(w."PreviousKeys")::text AS "PreviousKeysJson",
                    w."Number", w."Kind", w."Status", w."Priority", w."IssueType",
                    w."Title", w."Description", w."ParentId", w."IterationId",
                    w."Rank", w."SiblingRank", w."AssigneeUserId", w."CreatedByUserId",
                    w."Estimate", w."ExternalRefJson"::text AS "ExternalRefJson",
                    w."CreatedAt", w."UpdatedAt", w."ClosedAt", w."Version"
                FROM work_items w
                {{where}}
                ORDER BY w."Rank" COLLATE "C" ASC, w."Id" ASC
                LIMIT @limit
            )
            SELECT
                p."Id", p."ProjectId", p."Key", p."PreviousKeysJson",
                p."Number", p."Kind", p."Status", p."Priority", p."IssueType",
                p."Title", p."Description", p."ParentId", p."IterationId",
                p."Rank", p."SiblingRank", p."AssigneeUserId", p."CreatedByUserId",
                p."Estimate", p."ExternalRefJson",
                p."CreatedAt", p."UpdatedAt", p."ClosedAt", p."Version",
                rollups.child_count AS "ChildCount",
                rollups.child_count_by_status_json AS "ChildCountByStatusJson"
            FROM page p
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(SUM(c.cnt), 0)::int AS child_count,
                    COALESCE(jsonb_object_agg(c."Status", c.cnt), jsonb_build_object())::text AS child_count_by_status_json
                FROM (
                    SELECT ch."Status", COUNT(*)::int AS cnt
                    FROM work_items ch
                    WHERE ch."ParentId" = p."Id"
                    GROUP BY ch."Status"
                ) c
            ) rollups ON TRUE
            ORDER BY p."Rank" COLLATE "C" ASC, p."Id" ASC
            """;

        var rows = await db.Database
            .SqlQueryRaw<WorkItemRollupSqlRow>(sql, parameters.ToArray())
            .ToListAsync();

        return rows.Select(MapRollupRow).ToList();
    }

    public async Task<List<WorkItemEntity>> ListAllForProjectAsync(Guid projectId)
    {
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        return await db.WorkItems
            .Where(w => w.ProjectId == projectId)
            .OrderBy(w => w.Rank)
            .ThenBy(w => w.Id)
            .ToListAsync();
    }

    public async Task<List<WorkItemSubtreeNode>> GetSubtreeAsync(Guid id, int maxDepth)
    {
        if (maxDepth < 1)
            throw new ArgumentOutOfRangeException(nameof(maxDepth), maxDepth, "maxDepth must be >= 1.");

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);

        // ONE recursive CTE statement (AC5/AC6/D5):
        // - Depth-bounded by `WHERE t.depth < @maxDepth` (caller passes TrackerHierarchy.MaxDepth).
        // - Cycle belt-and-braces via `visited_ids` so corrupted data cannot loop infinitely.
        // - `sort_path` uses bytea[] (pure unsigned byte order == COLLATE "C" for ASCII base-62
        //   and UUID hex) so ORDER BY produces DFS pre-order with no second client sort.
        // - LEFT JOIN LATERAL computes direct-child roll-ups in the exact same statement.
        const string sql = """
            WITH RECURSIVE tree AS (
                SELECT
                    w."Id", w."ProjectId", w."Key",
                    array_to_json(w."PreviousKeys")::text AS "PreviousKeysJson",
                    w."Number", w."Kind", w."Status", w."Priority", w."IssueType",
                    w."Title", w."Description", w."ParentId", w."IterationId",
                    w."Rank", w."SiblingRank", w."AssigneeUserId", w."CreatedByUserId",
                    w."Estimate", w."ExternalRefJson"::text AS "ExternalRefJson",
                    w."CreatedAt", w."UpdatedAt", w."ClosedAt", w."Version",
                    1 AS depth,
                    ARRAY[w."Id"] AS visited_ids,
                    ARRAY[convert_to(w."SiblingRank", 'UTF8'), convert_to(w."Id"::text, 'UTF8')] AS sort_path
                FROM work_items w
                WHERE w."Id" = @rootId
                UNION ALL
                SELECT
                    c."Id", c."ProjectId", c."Key",
                    array_to_json(c."PreviousKeys")::text AS "PreviousKeysJson",
                    c."Number", c."Kind", c."Status", c."Priority", c."IssueType",
                    c."Title", c."Description", c."ParentId", c."IterationId",
                    c."Rank", c."SiblingRank", c."AssigneeUserId", c."CreatedByUserId",
                    c."Estimate", c."ExternalRefJson"::text AS "ExternalRefJson",
                    c."CreatedAt", c."UpdatedAt", c."ClosedAt", c."Version",
                    t.depth + 1 AS depth,
                    t.visited_ids || c."Id" AS visited_ids,
                    t.sort_path || ARRAY[convert_to(c."SiblingRank", 'UTF8'), convert_to(c."Id"::text, 'UTF8')] AS sort_path
                FROM work_items c
                JOIN tree t ON c."ParentId" = t."Id"
                WHERE t.depth < @maxDepth
                  AND NOT (c."Id" = ANY(t.visited_ids))
            )
            SELECT
                t."Id", t."ProjectId", t."Key", t."PreviousKeysJson",
                t."Number", t."Kind", t."Status", t."Priority", t."IssueType",
                t."Title", t."Description", t."ParentId", t."IterationId",
                t."Rank", t."SiblingRank", t."AssigneeUserId", t."CreatedByUserId",
                t."Estimate", t."ExternalRefJson",
                t."CreatedAt", t."UpdatedAt", t."ClosedAt", t."Version",
                t.depth AS "Depth",
                rollups.child_count AS "ChildCount",
                rollups.child_count_by_status_json AS "ChildCountByStatusJson"
            FROM tree t
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(SUM(c.cnt), 0)::int AS child_count,
                    COALESCE(jsonb_object_agg(c."Status", c.cnt), jsonb_build_object())::text AS child_count_by_status_json
                FROM (
                    SELECT ch."Status", COUNT(*)::int AS cnt
                    FROM work_items ch
                    WHERE ch."ParentId" = t."Id"
                    GROUP BY ch."Status"
                ) c
            ) rollups ON TRUE
            ORDER BY t.sort_path ASC
            """;

        var rows = await db.Database
            .SqlQueryRaw<WorkItemSubtreeSqlRow>(
                sql,
                new NpgsqlParameter("rootId", id),
                new NpgsqlParameter("maxDepth", maxDepth))
            .ToListAsync();

        return rows.Select(MapSubtreeRow).ToList();
    }

    public async Task<string?> GetMaxRankAsync(Guid projectId, Guid? excludeWorkItemId = null)
    {
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        var q = db.WorkItems.Where(w => w.ProjectId == projectId);
        if (excludeWorkItemId is { } excludeId)
            q = q.Where(w => w.Id != excludeId);
        return await q
            .OrderByDescending(w => w.Rank)
            .Select(w => w.Rank)
            .FirstOrDefaultAsync();
    }

    public async Task<WorkItemEntity> CreateAsync(WorkItemEntity item)
    {
        ArgumentNullException.ThrowIfNull(item);
        ValidateVocabulary(item);

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        await using var tx = await db.Database.BeginTransactionAsync();

        // ── The mint (AC5 / plan D6) ──
        // Lock the project row for the duration of the create so two
        // concurrent creates serialize on the counter: gap-free, monotone,
        // no duplicate (ProjectId, Number) possible.
        var project = await db.Projects
            .FromSqlInterpolated(
                $"""SELECT * FROM projects WHERE "Id" = {item.ProjectId} FOR UPDATE""")
            .AsTracking()
            .SingleOrDefaultAsync()
            ?? throw new TammaError(
                "TRACKER.PROJECT_NOT_FOUND",
                $"Project '{item.ProjectId}' does not exist in this tenant.",
                new Dictionary<string, object?> { ["projectId"] = item.ProjectId },
                retryable: false,
                severity: TammaErrorSeverity.High);

        var number = project.NextNumber;
        project.NextNumber = number + 1;

        item.Number = number;
        // The frozen key (44-0 AC8): minted exactly once, via WorkItemRef —
        // never a hand-rolled string. WorkItemRef validates the prefix.
        item.Key = new WorkItemRef(project.Key, number).ToWire();
        if (item.Id == Guid.Empty)
            item.Id = UuidV7.NewGuid();
        item.PreviousKeys ??= [];

        // Ranks: append at the end of each axis when the caller didn't place
        // the item. Append(currentMax) — never a fixed sentinel (44-0 AC9).
        // The ORDER BY ... DESC LIMIT 1 maxima are ordinal because both
        // columns are COLLATE "C".
        if (string.IsNullOrEmpty(item.Rank))
        {
            var maxRank = await db.WorkItems
                .Where(w => w.ProjectId == item.ProjectId)
                .OrderByDescending(w => w.Rank)
                .Select(w => w.Rank)
                .FirstOrDefaultAsync();
            item.Rank = Rank.Append(maxRank);
        }
        else
        {
            ValidateRank(item.Rank, nameof(item.Rank));
        }

        if (string.IsNullOrEmpty(item.SiblingRank))
        {
            var maxSibling = await db.WorkItems
                .Where(w => w.ProjectId == item.ProjectId && w.ParentId == item.ParentId)
                .OrderByDescending(w => w.SiblingRank)
                .Select(w => w.SiblingRank)
                .FirstOrDefaultAsync();
            item.SiblingRank = Rank.Append(maxSibling);
        }
        else
        {
            ValidateRank(item.SiblingRank, nameof(item.SiblingRank));
        }

        var now = DateTime.UtcNow;
        item.CreatedAt = now;
        item.UpdatedAt = now;
        item.ClosedAt = WorkItemStatusExtensions.Parse(item.Status).IsTerminal() ? now : null;
        item.Version = 1;

        db.WorkItems.Add(item);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return item;
    }

    public async Task<WorkItemEntity?> UpdateAsync(WorkItemEntity item, int? expectedVersion = null)
    {
        ArgumentNullException.ThrowIfNull(item);
        ValidateVocabulary(item);

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        var existing = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == item.Id);
        if (existing is null)
            return null;

        // Frozen/owned-elsewhere columns deliberately NOT copied: Key, Number,
        // PreviousKeys (RekeyAsync), Status/ClosedAt (SetStatusAsync),
        // Rank/SiblingRank (SetRanksAsync), ParentId (SetParentAsync),
        // ProjectId (a move seam is 44-2's, and it does NOT re-mint the key).
        existing.Kind = item.Kind;
        existing.Priority = item.Priority;
        existing.IssueType = item.IssueType;
        existing.Title = item.Title;
        existing.Description = item.Description;
        existing.IterationId = item.IterationId;
        existing.AssigneeUserId = item.AssigneeUserId;
        existing.Estimate = item.Estimate;
        existing.ExternalRefJson = item.ExternalRefJson;
        existing.UpdatedAt = DateTime.UtcNow;
        existing.Version += 1;
        PinExpectedVersion(db, existing, expectedVersion);
        await SaveGuardingVersionAsync(db, existing.Id);
        return existing;
    }

    public async Task<WorkItemEntity?> SetStatusAsync(Guid id, string statusWire, int? expectedVersion = null)
    {
        // Parse first — fail-loud on junk (TRACKER.UNKNOWN_STATUS), and the
        // terminal rule stays DERIVED from Category() (44-0 AC3), never a
        // set literal here.
        var status = WorkItemStatusExtensions.Parse(statusWire);

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        var existing = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == id);
        if (existing is null)
            return null;

        existing.Status = status.ToWire();
        existing.ClosedAt = status.IsTerminal() ? DateTime.UtcNow : null;
        existing.UpdatedAt = DateTime.UtcNow;
        existing.Version += 1;
        PinExpectedVersion(db, existing, expectedVersion);
        await SaveGuardingVersionAsync(db, existing.Id);
        return existing;
    }

    public async Task<WorkItemEntity?> SetRanksAsync(
        Guid id, string? rank, string? siblingRank, int? expectedVersion = null)
    {
        if (rank is null && siblingRank is null)
            throw new ArgumentException("At least one of rank / siblingRank must be supplied.");
        if (rank is not null)
            ValidateRank(rank, nameof(rank));
        if (siblingRank is not null)
            ValidateRank(siblingRank, nameof(siblingRank));

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        var existing = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == id);
        if (existing is null)
            return null;

        if (expectedVersion is int expected && existing.Version != expected)
        {
            throw new TammaError(
                "TRACKER.CONCURRENCY_CONFLICT",
                $"Work item '{id}' is at version {existing.Version}, but If-Match asked for {expected}. "
                + "Another writer changed it; re-read the resource and retry against its current state.",
                new Dictionary<string, object?>
                {
                    ["id"] = id,
                    ["expectedVersion"] = expected,
                    ["actualVersion"] = existing.Version,
                },
                retryable: true,
                severity: TammaErrorSeverity.Medium);
        }

        if (rank is not null)
            existing.Rank = rank;
        if (siblingRank is not null)
            existing.SiblingRank = siblingRank;
        existing.UpdatedAt = DateTime.UtcNow;
        existing.Version += 1;
        PinExpectedVersion(db, existing, expectedVersion);
        await SaveGuardingVersionAsync(db, existing.Id);
        return existing;
    }

    public async Task<int> BulkSetRanksAsync(Guid projectId, IReadOnlyList<(Guid Id, string Rank)> updates)
    {
        ArgumentNullException.ThrowIfNull(updates);
        if (updates.Count == 0)
            return 0;

        var ids = new Guid[updates.Count];
        var ranks = new string[updates.Count];
        for (var i = 0; i < updates.Count; i++)
        {
            ValidateRank(updates[i].Rank, $"updates[{i}].Rank");
            ids[i] = updates[i].Id;
            ranks[i] = updates[i].Rank;
        }

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        await using var tx = await db.Database.BeginTransactionAsync();

        // ONE bulk SQL UPDATE inside ONE transaction (AC7/AC8).
        const string sql = """
            UPDATE work_items AS w
            SET "Rank" = v.rank,
                "UpdatedAt" = now(),
                "Version" = w."Version" + 1
            FROM unnest(@ids, @ranks) AS v(id, rank)
            WHERE w."Id" = v.id
              AND w."ProjectId" = @projectId
            """;

        var affected = await db.Database.ExecuteSqlRawAsync(
            sql,
            new NpgsqlParameter("ids", NpgsqlDbType.Array | NpgsqlDbType.Uuid) { Value = ids },
            new NpgsqlParameter("ranks", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = ranks },
            new NpgsqlParameter("projectId", projectId));

        await tx.CommitAsync();
        return affected;
    }

    public async Task<WorkItemEntity?> SetParentAsync(Guid id, Guid? parentId, string? siblingRank = null)
    {
        if (parentId == id)
        {
            throw new TammaError(
                "TRACKER.SELF_RELATION",
                "A work item cannot be its own parent.",
                new Dictionary<string, object?> { ["workItemId"] = id },
                retryable: false,
                severity: TammaErrorSeverity.High);
        }
        if (siblingRank is not null)
            ValidateRank(siblingRank, nameof(siblingRank));

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        var existing = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == id);
        if (existing is null)
            return null;

        existing.ParentId = parentId;
        if (siblingRank is not null)
        {
            existing.SiblingRank = siblingRank;
        }
        else
        {
            // Append among the new siblings — same edge convention as create.
            var maxSibling = await db.WorkItems
                .Where(w => w.ProjectId == existing.ProjectId
                    && w.ParentId == parentId && w.Id != id)
                .OrderByDescending(w => w.SiblingRank)
                .Select(w => w.SiblingRank)
                .FirstOrDefaultAsync();
            existing.SiblingRank = Rank.Append(maxSibling);
        }
        existing.UpdatedAt = DateTime.UtcNow;
        existing.Version += 1;
        await SaveGuardingVersionAsync(db, existing.Id);
        return existing;
    }

    public async Task<WorkItemEntity?> ReparentTransactionalAsync(
        Guid id, Guid? parentId, int? expectedVersion = null)
    {
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        await using var tx = await db.Database.BeginTransactionAsync();

        // Discover the item's project first (ProjectId is immutable here), then
        // lock the project row FOR UPDATE before reading hierarchy state so all
        // concurrent reparents within the project serialize cleanly with ZERO
        // deadlocks and can never jointly form a cycle (AC2 / D1).
        var targetProjectId = await db.WorkItems
            .Where(w => w.Id == id)
            .Select(w => (Guid?)w.ProjectId)
            .FirstOrDefaultAsync();
        if (targetProjectId is null)
            return null;

        await db.Projects
            .FromSqlInterpolated(
                $"""SELECT * FROM projects WHERE "Id" = {targetProjectId.Value} FOR UPDATE""")
            .AsNoTracking()
            .SingleOrDefaultAsync();

        // Re-read the target fresh AFTER acquiring the project row lock so we
        // observe every committed concurrent write.
        var target = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == id);
        if (target is null)
            return null;

        if (expectedVersion is int expected && target.Version != expected)
        {
            throw new TammaError(
                "TRACKER.CONCURRENCY_CONFLICT",
                $"Work item '{id}' is at version {target.Version}, but If-Match asked for {expected}. "
                + "Another writer changed it; re-read the resource and retry against its current state.",
                new Dictionary<string, object?>
                {
                    ["id"] = id,
                    ["expectedVersion"] = expected,
                    ["actualVersion"] = target.Version,
                },
                retryable: true,
                severity: TammaErrorSeverity.Medium);
        }

        if (parentId is Guid pid)
        {
            if (pid == id)
            {
                throw new TammaError(
                    "WOULD_CREATE_CYCLE",
                    $"Work item '{target.Key}' cannot be its own parent (WOULD_CREATE_CYCLE).",
                    new Dictionary<string, object?>
                    {
                        ["workItemId"] = id,
                        ["parentId"] = pid,
                    },
                    retryable: false,
                    severity: TammaErrorSeverity.Medium);
            }

            var parent = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == pid)
                ?? throw new TammaError(
                    "TRACKER.PARENT_NOT_FOUND",
                    $"Parent work item '{pid}' does not exist in this tenant.",
                    new Dictionary<string, object?> { ["parentId"] = pid },
                    retryable: false,
                    severity: TammaErrorSeverity.Medium);

            if (parent.ProjectId != target.ProjectId)
            {
                throw new TammaError(
                    "CROSS_PROJECT_PARENT",
                    $"Cannot reparent '{target.Key}' under '{parent.Key}': parent and child belong to "
                    + "different projects (CROSS_PROJECT_PARENT).",
                    new Dictionary<string, object?>
                    {
                        ["workItemId"] = id,
                        ["workItemProjectId"] = target.ProjectId,
                        ["parentId"] = pid,
                        ["parentProjectId"] = parent.ProjectId,
                    },
                    retryable: false,
                    severity: TammaErrorSeverity.Medium);
            }

            var parentKind = WorkItemKindExtensions.Parse(parent.Kind);
            var childKind = WorkItemKindExtensions.Parse(target.Kind);
            if (!TrackerHierarchy.CanParent(parentKind, childKind))
            {
                throw new TammaError(
                    "KIND_NOT_PERMITTED",
                    $"A '{target.Kind}' ('{target.Key}') cannot be a child of a '{parent.Kind}' "
                    + $"('{parent.Key}') — an epic may not be a child of a non-epic (KIND_NOT_PERMITTED).",
                    new Dictionary<string, object?>
                    {
                        ["workItemId"] = id,
                        ["childKind"] = target.Kind,
                        ["parentId"] = pid,
                        ["parentKind"] = parent.Kind,
                    },
                    retryable: false,
                    severity: TammaErrorSeverity.Medium);
            }

            // Walk the persisted ancestor chain of the prospective parent inside
            // this locked transaction (cycle detection + parent depth).
            const string ancestorSql = """
                WITH RECURSIVE anc AS (
                    SELECT "Id", "ParentId", 1 AS depth, ARRAY["Id"] AS visited
                    FROM work_items
                    WHERE "Id" = @parentId
                    UNION ALL
                    SELECT w."Id", w."ParentId", anc.depth + 1, anc.visited || w."Id"
                    FROM work_items w
                    JOIN anc ON w."Id" = anc."ParentId"
                    WHERE anc.depth < @guard AND NOT (w."Id" = ANY(anc.visited))
                )
                SELECT "Id" AS "Value" FROM anc
                """;

            var ancestors = await db.Database
                .SqlQueryRaw<GuidScalar>(
                    ancestorSql,
                    new NpgsqlParameter("parentId", pid),
                    new NpgsqlParameter("guard", TrackerHierarchy.MaxDepth + 2))
                .Select(r => r.Value)
                .ToListAsync();

            if (ancestors.Contains(id))
            {
                throw new TammaError(
                    "WOULD_CREATE_CYCLE",
                    $"Cannot reparent '{target.Key}' under '{parent.Key}': '{parent.Key}' is a "
                    + $"descendant of '{target.Key}' (WOULD_CREATE_CYCLE).",
                    new Dictionary<string, object?>
                    {
                        ["workItemId"] = id,
                        ["parentId"] = pid,
                    },
                    retryable: false,
                    severity: TammaErrorSeverity.Medium);
            }

            // Compute max subtree depth rooted at target (1 for a leaf).
            const string subtreeHeightSql = """
                WITH RECURSIVE sub AS (
                    SELECT "Id", 1 AS depth, ARRAY["Id"] AS visited
                    FROM work_items
                    WHERE "Id" = @targetId
                    UNION ALL
                    SELECT w."Id", sub.depth + 1, sub.visited || w."Id"
                    FROM work_items w
                    JOIN sub ON w."ParentId" = sub."Id"
                    WHERE sub.depth < @guard AND NOT (w."Id" = ANY(sub.visited))
                )
                SELECT COALESCE(MAX(depth), 1)::int AS "Value" FROM sub
                """;

            var subtreeHeight = await db.Database
                .SqlQueryRaw<IntScalar>(
                    subtreeHeightSql,
                    new NpgsqlParameter("targetId", id),
                    new NpgsqlParameter("guard", TrackerHierarchy.MaxDepth + 2))
                .Select(r => r.Value)
                .FirstAsync();

            var parentDepth = ancestors.Count;
            var resultingMaxDepth = parentDepth + subtreeHeight;
            if (resultingMaxDepth > TrackerHierarchy.MaxDepth)
            {
                throw new TammaError(
                    "MAX_DEPTH_EXCEEDED",
                    $"Cannot reparent '{target.Key}' under '{parent.Key}': resulting hierarchy depth "
                    + $"{resultingMaxDepth} exceeds maximum depth {TrackerHierarchy.MaxDepth} "
                    + "(MAX_DEPTH_EXCEEDED).",
                    new Dictionary<string, object?>
                    {
                        ["workItemId"] = id,
                        ["parentId"] = pid,
                        ["parentDepth"] = parentDepth,
                        ["subtreeHeight"] = subtreeHeight,
                        ["resultingDepth"] = resultingMaxDepth,
                        ["maxDepth"] = TrackerHierarchy.MaxDepth,
                    },
                    retryable: false,
                    severity: TammaErrorSeverity.Medium);
            }
        }

        if (target.ParentId != parentId)
        {
            target.ParentId = parentId;
            var maxSibling = await db.WorkItems
                .Where(w => w.ProjectId == target.ProjectId
                    && w.ParentId == parentId && w.Id != id)
                .OrderByDescending(w => w.SiblingRank)
                .Select(w => w.SiblingRank)
                .FirstOrDefaultAsync();
            target.SiblingRank = Rank.Append(maxSibling);
        }

        target.UpdatedAt = DateTime.UtcNow;
        target.Version += 1;
        PinExpectedVersion(db, target, expectedVersion);
        await SaveGuardingVersionAsync(db, target.Id);
        await tx.CommitAsync();
        return target;
    }

    public async Task<WorkItemEntity?> RekeyAsync(Guid id, string newKey)
    {
        // Strict, non-normalizing parse — a bad key is rejected, never coerced.
        var parsed = WorkItemRef.Parse(newKey);
        var target = parsed.ToWire();

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        await using var tx = await db.Database.BeginTransactionAsync();

        var existing = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == id);
        if (existing is null)
            return null;

        if (string.Equals(existing.Key, target, StringComparison.Ordinal))
            return existing; // no-op re-key: nothing to record

        // Collision guard: the target must not be another row's CURRENT key.
        // Pre-checked here for a typed error; the UX_work_items_key catch
        // below closes the check-then-write race window.
        if (await db.WorkItems.AnyAsync(w => w.Key == target && w.Id != id))
            throw KeyConflict(target, id);

        // Mint-space guard: when the target prefix is an EXISTING project's
        // key, decide whose number space this key lives in.
        //  - A DIFFERENT project's prefix is rejected: a cross-project rekey
        //    is not a rename, it's a move, and a move never re-mints the key
        //    (44-0 AC8) — out of scope for this seam by contract.
        //  - The item's OWN project: a target number at/above NextNumber
        //    would wedge minting forever (when the counter reaches it,
        //    CreateAsync hits UX_work_items_key, rolls back, and NextNumber
        //    never advances) — so advance the counter past it, under the same
        //    FOR UPDATE row-lock discipline as CreateAsync.
        // A prefix that matches NO project (the operator prefix-rename,
        // TAM → TAMMA) has no counter to guard and passes through.
        var targetProject = await db.Projects
            .FromSqlInterpolated(
                $"""SELECT * FROM projects WHERE "Key" = {parsed.ProjectKey} FOR UPDATE""")
            .AsTracking()
            .SingleOrDefaultAsync();
        if (targetProject is not null && targetProject.Id != existing.ProjectId)
        {
            throw new TammaError(
                "TRACKER.CROSS_PROJECT_REKEY",
                $"Cannot rekey to '{target}': prefix '{parsed.ProjectKey}' belongs to a "
                + "different project. A rekey is a rename within the item's own key space; "
                + "moving an item between projects keeps its frozen key (44-0 AC8).",
                new Dictionary<string, object?>
                {
                    ["workItemId"] = id,
                    ["targetKey"] = target,
                    ["targetProjectId"] = targetProject.Id,
                },
                retryable: false,
                severity: TammaErrorSeverity.High);
        }
        if (targetProject is not null && parsed.Number >= targetProject.NextNumber)
            targetProject.NextNumber = parsed.Number + 1;

        // The single implementation of the history rule (44-0 AC8):
        // idempotent, order-preserving, oldest first. A project MOVE never
        // reaches this method — the key is frozen on a move.
        var outgoing = WorkItemRef.Parse(existing.Key);
        existing.PreviousKeys = WorkItemKeyHistory.Record(existing.PreviousKeys, outgoing).ToList();
        existing.Key = target;
        existing.UpdatedAt = DateTime.UtcNow;
        existing.Version += 1;
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException ex)
        {
            // The Version token (44-1 review, 2026-07-29): an interleaved
            // writer bumped Version after our read, so our UPDATE matched no
            // row. Losing silently here would drop the loser's PreviousKeys
            // recording — surface the typed, retryable conflict instead.
            throw ConcurrencyConflict(id, ex);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // A concurrent writer took the key between the pre-check and the
            // save — same fact, typed the same way.
            throw KeyConflict(target, id);
        }
        await tx.CommitAsync();
        return existing;
    }

    private static TammaError KeyConflict(string target, Guid workItemId) => new(
        "TRACKER.KEY_CONFLICT",
        $"Cannot rekey to '{target}': another work item already holds that key.",
        new Dictionary<string, object?>
        {
            ["workItemId"] = workItemId,
            ["targetKey"] = target,
        },
        retryable: false,
        severity: TammaErrorSeverity.High);

    /// <summary>
    /// Save guarding the <c>Version</c> optimistic-concurrency token (44-1
    /// review, 2026-07-29): the caller has already bumped <c>Version</c>; EF
    /// adds <c>WHERE "Version" = &lt;as-read&gt;</c>, so an interleaved writer
    /// surfaces as a typed, RETRYABLE <c>TRACKER.CONCURRENCY_CONFLICT</c> —
    /// never a silent last-write-wins that could lose <c>PreviousKeys</c>
    /// history or a status/rank/parent write.
    /// </summary>
    /// <summary>
    /// Make the caller's <c>If-Match</c> precondition ATOMIC with the write
    /// (44-2 adversarial review, 2026-07-29). The EF token alone closes only the
    /// window INSIDE this repository: the service reads, checks
    /// <c>RequireVersion</c>, and then the repository RE-READS in a fresh
    /// context, so <c>W2.read(v1) → W1 completes(v2) → W2.repo-read(v2) →
    /// W2 writes v3</c> passed the service check and never tripped the token.
    /// Pinning the token's ORIGINAL value to the version the caller asserted
    /// puts <c>WHERE "Version" = @expected</c> in the UPDATE/DELETE itself, so
    /// the stale writer matches no row and loses with the typed conflict.
    /// </summary>
    private static void PinExpectedVersion(TenantDbContext db, WorkItemEntity row, int? expectedVersion)
    {
        if (expectedVersion is int expected)
            db.Entry(row).Property(w => w.Version).OriginalValue = expected;
    }

    private static async Task SaveGuardingVersionAsync(TenantDbContext db, Guid workItemId)
    {
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException ex)
        {
            throw ConcurrencyConflict(workItemId, ex);
        }
    }

    private static TammaError ConcurrencyConflict(Guid workItemId, DbUpdateConcurrencyException ex) => new(
        "TRACKER.CONCURRENCY_CONFLICT",
        $"Work item '{workItemId}' was modified by another writer while this update "
        + "was in flight (optimistic-concurrency Version mismatch). Re-read the item "
        + "and retry the operation against its current state.",
        new Dictionary<string, object?>
        {
            ["workItemId"] = workItemId,
            ["conflictEntries"] = ex.Entries.Count,
        },
        retryable: true,
        severity: TammaErrorSeverity.Medium);

    public async Task<bool> DeleteAsync(Guid id, int? expectedVersion = null)
    {
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        var row = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == id);
        if (row is null)
            return false;
        db.WorkItems.Remove(row);
        PinExpectedVersion(db, row, expectedVersion);
        // Children RESTRICT the parent FK — 44-2 maps SqlState 23503 to the
        // documented 409; relation edges CASCADE away with the item.
        await SaveGuardingVersionAsync(db, id);
        return true;
    }

    // ── Relations (44-0 AC14; canonical form — plan D8) ──

    public async Task<WorkItemRelation> AddRelationAsync(
        Guid sourceId, Guid targetId, WorkItemRelationKind kind, Guid? createdByUserId = null)
    {
        // THE direction convention, exactly once, from Tamma.Core.Tracking:
        // rejects self-relations (TRACKER.SELF_RELATION) and orders symmetric
        // endpoints lower-id-first so a mirror duplicate cannot be stored.
        var (canonicalSource, canonicalTarget) = kind.Canonicalize(sourceId, targetId);
        var wire = kind.ToWire();

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);

        // Story 44-3 (Amendment A6) — reject cross-project relation edges.
        // Self-relations and symmetric lower-id-first canonicalization already
        // run above via WorkItemRelationKindExtensions.Canonicalize.
        var endpoints = await db.WorkItems
            .Where(w => w.Id == canonicalSource || w.Id == canonicalTarget)
            .Select(w => new { w.Id, w.ProjectId })
            .ToListAsync();
        if (endpoints.Count == 2 && endpoints[0].ProjectId != endpoints[1].ProjectId)
        {
            throw new TammaError(
                "TRACKER.CROSS_PROJECT_RELATION",
                $"Cannot add '{wire}' relation between '{canonicalSource}' and '{canonicalTarget}': "
                + "source and target belong to different projects.",
                new Dictionary<string, object?>
                {
                    ["sourceId"] = canonicalSource,
                    ["targetId"] = canonicalTarget,
                    ["kind"] = wire,
                },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        // Insert-first, no check-then-insert window: two concurrent adds of
        // the same canonical edge race the unique index, and the loser's
        // 23505 IS the "already exists" fact — caught below and answered with
        // the stored row, so the documented idempotent contract holds under
        // concurrency, not just in sequence.
        var relation = new WorkItemRelation
        {
            Id = UuidV7.NewGuid(),
            SourceId = canonicalSource,
            TargetId = canonicalTarget,
            Kind = wire,
            CreatedByUserId = createdByUserId,
            CreatedAt = DateTime.UtcNow,
        };
        db.WorkItemRelations.Add(relation);
        try
        {
            await db.SaveChangesAsync();
            return relation;
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // The canonical row already exists (concurrent writer or an
            // earlier add) — UX_work_item_relations_source_target_kind.
            // Detach the failed insert and hand back the winner. A row that
            // vanished between violation and re-read (concurrent remove) means
            // the edge does not exist NOW — rethrow so the caller retries.
            db.Entry(relation).State = EntityState.Detached;
            var winner = await db.WorkItemRelations.FirstOrDefaultAsync(r =>
                r.SourceId == canonicalSource && r.TargetId == canonicalTarget && r.Kind == wire);
            if (winner is null)
                throw;
            return winner;
        }
    }

    public async Task<bool> RemoveRelationAsync(Guid sourceId, Guid targetId, WorkItemRelationKind kind)
    {
        var (canonicalSource, canonicalTarget) = kind.Canonicalize(sourceId, targetId);
        var wire = kind.ToWire();

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        var row = await db.WorkItemRelations.FirstOrDefaultAsync(r =>
            r.SourceId == canonicalSource && r.TargetId == canonicalTarget && r.Kind == wire);
        if (row is null)
            return false;
        db.WorkItemRelations.Remove(row);
        await db.SaveChangesAsync();
        return true;
    }

    public async Task<List<WorkItemRelation>> ListRelationsAsync(Guid workItemId)
    {
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        return await db.WorkItemRelations
            .Where(r => r.SourceId == workItemId || r.TargetId == workItemId)
            .OrderBy(r => r.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Postgres unique-violation (SqlState 23505) — ONLY that; any other
    /// <see cref="DbUpdateException"/> (FK 23503, CHECK 23514, …) propagates.
    /// </summary>
    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException { SqlState: "23505" };

    // ── Validation helpers (wire boundary — fail loud, never coerce) ──

    private static void ValidateVocabulary(WorkItemEntity item)
    {
        _ = WorkItemKindExtensions.Parse(item.Kind);       // TRACKER.UNKNOWN_KIND
        _ = WorkItemStatusExtensions.Parse(item.Status);   // TRACKER.UNKNOWN_STATUS

        if (item.Priority is not null)
        {
            // Alias-aware (critical→urgent, medium→normal via TriageVocabulary),
            // then canonicalized to the wire the CHECK constraint knows.
            if (!TrackerPriority.TryParsePriority(item.Priority, out var priority))
            {
                throw new TammaError(
                    "TRACKER.UNKNOWN_PRIORITY",
                    $"Unknown work item priority: '{item.Priority}'. Valid: "
                    + string.Join(", ", TrackerPriority.AcceptedPriorityWires) + ".",
                    new Dictionary<string, object?> { ["input"] = item.Priority },
                    retryable: false,
                    severity: TammaErrorSeverity.High);
            }
            item.Priority = priority.ToWire();
        }

        if (item.IssueType is not null)
        {
            if (!TrackerPriority.TryParseType(item.IssueType, out var type))
            {
                throw new TammaError(
                    "TRACKER.UNKNOWN_ISSUE_TYPE",
                    $"Unknown work item type: '{item.IssueType}'. Valid: "
                    + string.Join(", ", TrackerPriority.AcceptedTypeWires) + ".",
                    new Dictionary<string, object?> { ["input"] = item.IssueType },
                    retryable: false,
                    severity: TammaErrorSeverity.High);
            }
            item.IssueType = type.ToWire();
        }

        if (string.IsNullOrWhiteSpace(item.Title))
        {
            throw new TammaError(
                "TRACKER.INVALID_TITLE",
                "A work item requires a non-empty title.",
                retryable: false,
                severity: TammaErrorSeverity.High);
        }
    }

    private static void ValidateRank(string candidate, string paramName)
    {
        if (!Rank.IsValid(candidate))
        {
            throw new TammaError(
                "TRACKER.INVALID_RANK",
                $"'{candidate}' is not a canonical rank ({paramName}): non-empty base-62 "
                + "over 0-9A-Za-z with no trailing '0'. Mint ranks via Rank.Between/"
                + "Append/Prepend — never hand-build them.",
                new Dictionary<string, object?> { [paramName] = candidate },
                retryable: false,
                severity: TammaErrorSeverity.High);
        }
    }

    private static string EscapeLike(string input) =>
        input.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_");

    // ── Raw-SQL projection helpers for roll-ups, subtrees, and locking CTEs ──

    private static WorkItemWithRollup MapRollupRow(WorkItemRollupSqlRow r) => new(
        ToEntity(r),
        r.ChildCount,
        ParseStatusCounts(r.ChildCountByStatusJson));

    private static WorkItemSubtreeNode MapSubtreeRow(WorkItemSubtreeSqlRow r) => new(
        ToEntity(r),
        r.Depth,
        r.ChildCount,
        ParseStatusCounts(r.ChildCountByStatusJson));

    private static WorkItemEntity ToEntity(WorkItemRollupSqlRow r) => new()
    {
        Id = r.Id,
        ProjectId = r.ProjectId,
        Key = r.Key,
        PreviousKeys = ParseStringArray(r.PreviousKeysJson),
        Number = r.Number,
        Kind = r.Kind,
        Status = r.Status,
        Priority = r.Priority,
        IssueType = r.IssueType,
        Title = r.Title,
        Description = r.Description,
        ParentId = r.ParentId,
        IterationId = r.IterationId,
        Rank = r.Rank,
        SiblingRank = r.SiblingRank,
        AssigneeUserId = r.AssigneeUserId,
        CreatedByUserId = r.CreatedByUserId,
        Estimate = r.Estimate,
        ExternalRefJson = r.ExternalRefJson,
        CreatedAt = DateTime.SpecifyKind(r.CreatedAt, DateTimeKind.Utc),
        UpdatedAt = DateTime.SpecifyKind(r.UpdatedAt, DateTimeKind.Utc),
        ClosedAt = r.ClosedAt is { } c ? DateTime.SpecifyKind(c, DateTimeKind.Utc) : null,
        Version = r.Version,
    };

    private static List<string> ParseStringArray(string? json) =>
        string.IsNullOrWhiteSpace(json)
            ? []
            : JsonSerializer.Deserialize<List<string>>(json) ?? [];

    private static IReadOnlyDictionary<string, int> ParseStatusCounts(string? json) =>
        string.IsNullOrWhiteSpace(json) || json == "{}"
            ? EmptyStatusCounts
            : JsonSerializer.Deserialize<Dictionary<string, int>>(json) ?? EmptyStatusCounts;

    private static readonly Dictionary<string, int> EmptyStatusCounts = new();

    private sealed class GuidScalar
    {
        public Guid Value { get; set; }
    }

    private sealed class IntScalar
    {
        public int Value { get; set; }
    }

    private class WorkItemRollupSqlRow
    {
        public Guid Id { get; set; }
        public Guid ProjectId { get; set; }
        public string Key { get; set; } = "";
        public string? PreviousKeysJson { get; set; }
        public int Number { get; set; }
        public string Kind { get; set; } = "";
        public string Status { get; set; } = "";
        public string? Priority { get; set; }
        public string? IssueType { get; set; }
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public Guid? ParentId { get; set; }
        public Guid? IterationId { get; set; }
        public string Rank { get; set; } = "";
        public string SiblingRank { get; set; } = "";
        public Guid? AssigneeUserId { get; set; }
        public Guid? CreatedByUserId { get; set; }
        public decimal? Estimate { get; set; }
        public string? ExternalRefJson { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public DateTime? ClosedAt { get; set; }
        public int Version { get; set; }
        public int ChildCount { get; set; }
        public string? ChildCountByStatusJson { get; set; }
    }

    private sealed class WorkItemSubtreeSqlRow : WorkItemRollupSqlRow
    {
        public int Depth { get; set; }
    }

    private sealed class BoardItemSqlRow : WorkItemRollupSqlRow
    {
        public string GroupKey { get; set; } = "";
        public int GroupTotal { get; set; }
    }
}
