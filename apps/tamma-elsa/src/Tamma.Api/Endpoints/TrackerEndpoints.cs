using System.Security.Claims;
using System.Text.Json;
using Microsoft.Net.Http.Headers;
using Tamma.Api.Auth;
using Tamma.Api.Dtos.Tracker;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Services.Tracker;
using Tamma.Core;
using Tamma.Core.Tracking;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Endpoints;

/// <summary>
/// Minimal-API handlers for the native tracker (Story 44-2 AC2):
/// <c>/api/projects</c>, <c>/api/work-items</c> and
/// <c>/api/tracker/preferences</c>.
///
/// <para><b>One class, three nouns</b> (plan D1): projects, work items and — at
/// 44-4 — iterations share one mapping site, so the literal-before-parameterized
/// route ordering is got right in exactly one place rather than three.
/// <c>AcceptanceRulesEndpoints</c> covers rules, defaults and resets in one class
/// for the same reason.</para>
///
/// <para><b>RBAC</b> (AC4): reads and the RECOVERABLE work-item writes (create,
/// patch, status, assign) take <c>TrackerView</c> (<c>tracker:view</c> =
/// member/admin/owner — a tracker in which a member cannot file a bug or move a
/// card is not a tracker); project structure, the preference row and the
/// work-item DELETE take <c>TrackerManage</c> (<c>tracker:manage</c> =
/// admin/owner — a key rename or a project delete changes everyone's
/// identifiers, and in SaaS the preference row is TENANT-wide configuration, so
/// it follows the prompt/convention/acceptance-rules store precedent). Neither
/// reuses <c>SettingsManage</c>, which is owner-only and would 403 every
/// tenant_admin.</para>
///
/// <para><b>There is NO ownership plane</b> (adversarial review, 2026-07-29).
/// Nothing in this class or in <see cref="Services.Tracker.TrackerService"/>
/// checks <c>CreatedByUserId</c> or <c>AssigneeUserId</c> before serving a
/// write: EVERY tenant member can see and edit EVERY work item in the tenant
/// today, and AC7's honest degradation means the list is tenant-wide as well.
/// The handlers below must not be read as scoping anything to a caller's own
/// work. That is tolerated for the recoverable writes; the HARD delete
/// (<see cref="DeleteWorkItem"/>, catalogued Destructive/reversible:false, and
/// emitting no event because 44-5 owns emission — so unrecoverable AND
/// unaudited) is therefore gated at <c>TrackerManage</c> until an ownership
/// plane or the audit trail lands.</para>
///
/// <para><b>Mode branching is INLINE and only in the preference handlers</b>
/// (plan D4), exactly the <c>AcceptanceRulesEndpoints</c> shape. Work items and
/// projects are tenant-schema content; the tenant is already resolved by the
/// connection, so they carry no mode split at all.</para>
///
/// <para><b>Concurrency</b> (AC9): every mutation honours <c>If-Match</c>
/// carrying the row <c>Version</c> and answers <c>409</c> on mismatch; every
/// single-resource response carries an <c>ETag</c>.</para>
/// </summary>
public static class TrackerEndpoints
{
    // ═══════════════════════════ Projects ═══════════════════════════════════

    public static async Task<IResult> ListProjects(
        bool? includeArchived,
        ITrackerService tracker)
    {
        try
        {
            var list = await tracker.ListProjectsAsync(includeArchived ?? false);
            return Results.Ok(list.Select(Map).ToList());
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> GetProject(
        Guid projectId, ITrackerService tracker, HttpContext http)
    {
        try
        {
            var project = await tracker.GetProjectAsync(projectId);
            if (project is null)
                return NotFound("project", projectId);
            SetETag(http, project.Version);
            return Results.Ok(Map(project));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> CreateProject(
        CreateProjectRequest request,
        ITrackerService tracker,
        ClaimsPrincipal principal,
        HttpContext http)
    {
        try
        {
            var project = await tracker.CreateProjectAsync(request, principal.GetUserId());
            SetETag(http, project.Version);
            return Results.Created($"/api/projects/{project.Id}", Map(project));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
        catch (Microsoft.EntityFrameworkCore.DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            return Results.Conflict(new
            {
                error = $"A project with key '{request?.Key}' already exists in this tenant.",
                code = "TRACKER.KEY_CONFLICT",
                retryable = false,
            });
        }
    }

    public static async Task<IResult> PatchProject(
        Guid projectId,
        PatchProjectRequest request,
        ITrackerService tracker,
        HttpContext http)
    {
        if (!TryReadIfMatch(http, out var ifMatch, out var precondition))
            return precondition!;
        try
        {
            var project = await tracker.PatchProjectAsync(projectId, request, ifMatch);
            if (project is null)
                return NotFound("project", projectId);
            SetETag(http, project.Version);
            return Results.Ok(Map(project));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> DeleteProject(
        Guid projectId,
        ITrackerService tracker,
        HttpContext http)
    {
        if (!TryReadIfMatch(http, out var ifMatch, out var precondition))
            return precondition!;

        try
        {
            // A non-empty project trips the work_items FK RESTRICT. Naming the
            // blockers is the whole point — "409" with no list forces the
            // operator to go hunting (plan D11, same posture as the child guard).
            var blockers = await tracker.ProjectWorkItemsAsync(projectId, BlockerListLimit);
            if (blockers.Count > 0)
            {
                return Results.Conflict(new
                {
                    error = $"Project '{projectId}' still holds {blockers.Count} work item(s); "
                        + "move or delete them first. Deleting a project's backlog on one click "
                        + "is unrecoverable, so the FK is RESTRICT and this is a refusal, not a cascade.",
                    code = "TRACKER.PROJECT_NOT_EMPTY",
                    retryable = false,
                    workItems = blockers.Select(w => new { id = w.Id, key = w.Key, title = w.Title }).ToList(),
                    truncated = blockers.Count == BlockerListLimit,
                });
            }

            var deleted = await tracker.DeleteProjectAsync(projectId, ifMatch);
            return deleted ? Results.NoContent() : NotFound("project", projectId);
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
        catch (Microsoft.EntityFrameworkCore.DbUpdateException ex) when (IsForeignKeyViolation(ex))
        {
            // The pre-check above is a COURTESY, not the guard: a work item
            // created after it and before the DELETE trips the work_items FK
            // RESTRICT in the database. Before this catch that surfaced as a
            // raw 500 (44-2 review 2026-07-29) even though ProjectRepository's
            // own comment already promised "the caller maps the constraint
            // violation to a 409". Now it does. The body cannot list the
            // blockers — the row set is whatever raced in — so it names the
            // constraint and tells the caller to re-read.
            return ProjectNotEmptyRace(projectId);
        }
    }

    // ═══════════════════════════ Work items ═════════════════════════════════

    /// <summary>
    /// The workhorse list (story technical notes): filter by project, status
    /// set, kind set, assignee, iteration, parent, external-linked and free text
    /// over the title; ordered by <c>Rank</c>; KEYSET-paged. Offset paging is
    /// deliberately not offered — a board reorders constantly, and offset paging
    /// over a mutating ordered set duplicates and skips rows intermittently.
    /// </summary>
    public static async Task<IResult> ListWorkItems(
        Guid? projectId,
        string? status,
        string? kind,
        Guid? assigneeUserId,
        Guid? iterationId,
        Guid? parentId,
        bool? topLevel,
        bool? externalLinked,
        string? q,
        string? cursor,
        int? limit,
        ITrackerService tracker,
        ClaimsPrincipal principal)
    {
        try
        {
            var page = await tracker.ListWorkItemsAsync(new WorkItemListQuery
            {
                ProjectId = projectId,
                Statuses = SplitCsv(status),
                Kinds = SplitCsv(kind),
                AssigneeUserId = assigneeUserId,
                IterationId = iterationId,
                ParentId = parentId,
                TopLevelOnly = topLevel ?? false,
                ExternalLinked = externalLinked,
                TitleContains = q,
                Cursor = cursor,
                Limit = limit ?? 100,
            }, principal.GetUserId());

            return Results.Ok(new WorkItemListResponse(
                page.Items.Select(w =>
                {
                    if (page.Rollups is not null && page.Rollups.TryGetValue(w.Id, out var r))
                        return Map(w, r.ChildCount, r.ChildCountByStatus);
                    return Map(w);
                }).ToList(),
                page.NextCursor,
                page.VisibilityMode));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> GetWorkItem(
        Guid id, ITrackerService tracker, HttpContext http)
    {
        try
        {
            var item = await tracker.GetWorkItemAsync(id);
            if (item is null)
                return NotFound("work item", id);
            SetETag(http, item.Version);
            return Results.Ok(Map(item));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    /// <summary>Resolve a wire key — current OR previously-held (44-0 AC8).</summary>
    public static async Task<IResult> GetWorkItemByKey(
        string key, ITrackerService tracker, HttpContext http)
    {
        try
        {
            var item = await tracker.GetWorkItemByKeyAsync(key);
            if (item is null)
            {
                return Results.NotFound(new
                {
                    error = $"No work item holds (or previously held) the key '{key}'.",
                    code = "TRACKER.NOT_FOUND",
                });
            }
            SetETag(http, item.Version);
            return Results.Ok(Map(item));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> CreateWorkItem(
        CreateWorkItemRequest request,
        ITrackerService tracker,
        ClaimsPrincipal principal,
        HttpContext http)
    {
        try
        {
            var item = await tracker.CreateWorkItemAsync(request, principal.GetUserId());
            SetETag(http, item.Version);
            return Results.Created($"/api/work-items/{item.Id}", Map(item));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> PatchWorkItem(
        Guid id,
        PatchWorkItemRequest request,
        ITrackerService tracker,
        HttpContext http)
    {
        if (!TryReadIfMatch(http, out var ifMatch, out var precondition))
            return precondition!;
        try
        {
            var item = await tracker.PatchWorkItemAsync(id, request, ifMatch);
            if (item is null)
                return NotFound("work item", id);
            SetETag(http, item.Version);
            return Results.Ok(Map(item));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> SetWorkItemStatus(
        Guid id,
        SetStatusRequest request,
        ITrackerService tracker,
        HttpContext http)
    {
        if (!TryReadIfMatch(http, out var ifMatch, out var precondition))
            return precondition!;
        try
        {
            var item = await tracker.SetWorkItemStatusAsync(id, request?.Status!, ifMatch);
            if (item is null)
                return NotFound("work item", id);
            SetETag(http, item.Version);
            return Results.Ok(Map(item));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> AssignWorkItem(
        Guid id,
        AssignRequest request,
        ITrackerService tracker,
        HttpContext http)
    {
        if (!TryReadIfMatch(http, out var ifMatch, out var precondition))
            return precondition!;

        // Single-field write with explicit nullability: an ABSENT
        // assigneeUserId is a 400, never a silent unassign; an explicit null
        // unassigns (Story 43-6 AC2's shape, the 43-0 bug class).
        if (request is null || !request.AssigneeUserId.IsSet)
        {
            return Results.BadRequest(new
            {
                error = "Body field 'assigneeUserId' is required (send null to unassign). "
                    + "A missing field is never defaulted — Story 44-2 AC3.",
                code = "TRACKER.MISSING_FIELD",
            });
        }

        try
        {
            var item = await tracker.AssignWorkItemAsync(id, request.AssigneeUserId.Value, ifMatch);
            if (item is null)
                return NotFound("work item", id);
            SetETag(http, item.Version);
            return Results.Ok(Map(item));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> DeleteWorkItem(
        Guid id,
        ITrackerService tracker,
        HttpContext http)
    {
        if (!TryReadIfMatch(http, out var ifMatch, out var precondition))
            return precondition!;

        try
        {
            // Plan D11 — 44-1's ParentId FK is RESTRICT, deliberately: cascading
            // an epic's whole subtree on one click is unrecoverable. The 409
            // NAMES the blocking children so the UI can offer "reparent" or
            // "delete N children" explicitly.
            var children = await tracker.ChildrenAsync(id, BlockerListLimit);
            if (children.Count > 0)
            {
                return Results.Conflict(new
                {
                    error = $"Work item '{id}' has {children.Count} child item(s); reparent or "
                        + "delete them first. The parent FK is RESTRICT — deleting a subtree "
                        + "implicitly is unrecoverable.",
                    code = "TRACKER.HAS_CHILDREN",
                    retryable = false,
                    children = children.Select(c => new { id = c.Id, key = c.Key, title = c.Title }).ToList(),
                    truncated = children.Count == BlockerListLimit,
                });
            }

            var deleted = await tracker.DeleteWorkItemAsync(id, ifMatch);
            return deleted ? Results.NoContent() : NotFound("work item", id);
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
        catch (Microsoft.EntityFrameworkCore.DbUpdateException ex) when (IsForeignKeyViolation(ex))
        {
            // Same race as DeleteProject: a child reparented onto this item
            // after the pre-check trips the RESTRICT FK. 409, never a 500.
            return HasChildrenRace(id);
        }
    }

    /// <summary>
    /// AC6 — the assignee picker source, with its <c>source</c> discriminator.
    /// See <see cref="TrackerAssigneeResolver"/> for why it must never render
    /// an empty picker.
    /// </summary>
    public static async Task<IResult> ListAssignable(
        TrackerAssigneeResolver assignees,
        ClaimsPrincipal principal,
        ITenantContext tenantContext)
    {
        try
        {
            return Results.Ok(await assignees.ResolveAsync(
                tenantContext.TenantId, principal.GetUserId()));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    // ══════════ Story 44-3 — Hierarchy, ranking, subtree & apply seam ════════

    /// <summary>
    /// Story 44-3 AC1/AC2 — reparent a work item (null detaches to top-level)
    /// inside one serialized transaction against persisted state.
    /// </summary>
    public static async Task<IResult> SetParent(
        Guid id,
        SetParentRequest request,
        TrackerHierarchyService hierarchy,
        HttpContext http)
    {
        if (!TryReadIfMatch(http, out var ifMatch, out var precondition))
            return precondition!;

        if (request is null || !request.ParentId.IsSet)
        {
            return Results.BadRequest(new
            {
                error = "Body field 'parentId' is required (send null to make top-level). "
                    + "A missing field is never defaulted — Story 44-2 AC3.",
                code = "TRACKER.MISSING_FIELD",
            });
        }

        try
        {
            var item = await hierarchy.ReparentAsync(id, request.ParentId.Value, ifMatch);
            if (item is null)
                return NotFound("work item", id);
            SetETag(http, item.Version);
            return Results.Ok(Map(item));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    /// <summary>
    /// Story 44-3 AC3 — neighbour-addressed move writing exactly one row
    /// (<c>Rank = Rank.Between(after, before)</c>).
    /// </summary>
    public static async Task<IResult> MoveWorkItem(
        Guid id,
        MoveWorkItemRequest? request,
        TrackerHierarchyService hierarchy,
        HttpContext http)
    {
        if (!TryReadIfMatch(http, out var ifMatch, out var precondition))
            return precondition!;

        try
        {
            var item = await hierarchy.MoveAsync(id, request?.AfterId, request?.BeforeId, ifMatch);
            if (item is null)
                return NotFound("work item", id);
            SetETag(http, item.Version);
            return Results.Ok(Map(item));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    /// <summary>
    /// Story 44-3 AC5/AC6 — return the work item and all descendants up to
    /// <see cref="TrackerHierarchy.MaxDepth"/> in ONE recursive CTE query with
    /// SQL-computed direct-child roll-up counts, ordered in DFS pre-order.
    /// </summary>
    public static async Task<IResult> GetSubtree(
        Guid id,
        TrackerHierarchyService hierarchy)
    {
        try
        {
            var nodes = await hierarchy.GetSubtreeAsync(id);
            if (nodes.Count == 0)
                return NotFound("work item", id);
            return Results.Ok(new WorkItemSubtreeResponse(
                id,
                TrackerHierarchy.MaxDepth,
                nodes.Select(MapSubtreeNode).ToList()));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    /// <summary>
    /// Story 44-3 AC7/AC8 — apply an accepted <c>BacklogOrdering</c> document to
    /// a project's backlog order in one idempotent transaction.
    /// </summary>
    public static async Task<IResult> ApplyOrdering(
        Guid projectId,
        ApplyOrderingRequest? request,
        OrderingApplyService orderingApply,
        CancellationToken ct)
    {
        if (request is null || request.DocumentId is not Guid documentId || documentId == Guid.Empty)
        {
            return Results.BadRequest(new
            {
                error = "Body field 'documentId' is required.",
                code = "TRACKER.MISSING_FIELD",
            });
        }

        try
        {
            var result = await orderingApply.ApplyAsync(projectId, documentId, ct);
            return Results.Ok(result);
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    // ══════ Story 44-4 — Iterations, Board Projection & SprintPlan Apply ═════

    public static async Task<IResult> ListIterations(
        Guid projectId,
        IterationService iterations)
    {
        try
        {
            var list = await iterations.ListByProjectAsync(projectId);
            return Results.Ok(list.Select(i => MapIteration(i)).ToList());
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> GetIteration(
        Guid id,
        IterationService iterations,
        HttpContext http)
    {
        try
        {
            var iteration = await iterations.GetAsync(id);
            if (iteration is null)
                return NotFound("iteration", id);
            SetETag(http, iteration.Version);
            return Results.Ok(MapIteration(iteration));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> CreateIteration(
        Guid projectId,
        CreateIterationRequest request,
        IterationService iterations,
        HttpContext http)
    {
        try
        {
            var created = await iterations.CreateAsync(projectId, request);
            SetETag(http, created.Version);
            return Results.Created($"/api/iterations/{created.Id}", MapIteration(created));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> PatchIteration(
        Guid id,
        PatchIterationRequest request,
        IterationService iterations,
        HttpContext http)
    {
        if (!TryReadIfMatch(http, out var ifMatch, out var precondition))
            return precondition!;

        try
        {
            var result = await iterations.PatchAsync(id, request, ifMatch);
            if (result is null)
                return NotFound("iteration", id);
            SetETag(http, result.Iteration.Version);
            var isClose = string.Equals(result.Iteration.Status, IterationRepository.StatusClosed, StringComparison.Ordinal)
                && request.Status.IsSet;
            return Results.Ok(MapIteration(
                result.Iteration,
                isClose ? result.MovedCount : null,
                isClose ? result.LeftCount : null));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> DeleteIteration(
        Guid id,
        IterationService iterations,
        HttpContext http)
    {
        if (!TryReadIfMatch(http, out var ifMatch, out var precondition))
            return precondition!;

        try
        {
            var deleted = await iterations.DeleteAsync(id, ifMatch);
            return deleted ? Results.NoContent() : NotFound("iteration", id);
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> CommitIterationItems(
        Guid id,
        CommitIterationItemsRequest? request,
        IterationService iterations)
    {
        if (request?.WorkItemIds is null)
        {
            return Results.BadRequest(new
            {
                error = "Body field 'workItemIds' is required.",
                code = "TRACKER.MISSING_FIELD",
            });
        }

        try
        {
            var response = await iterations.CommitItemsAsync(id, request.WorkItemIds);
            return Results.Ok(response);
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> UncommitIterationItem(
        Guid id,
        Guid workItemId,
        IterationService iterations)
    {
        try
        {
            var ok = await iterations.UncommitItemAsync(id, workItemId);
            return ok ? Results.NoContent() : NotFound("work item", workItemId);
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> GetIterationSummary(
        Guid id,
        IterationService iterations)
    {
        try
        {
            var summary = await iterations.GetSummaryAsync(id);
            return summary is null ? NotFound("iteration", id) : Results.Ok(summary);
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> GetBoard(
        Guid projectId,
        string? groupBy,
        Guid? iterationId,
        Guid? assigneeId,
        string? kind,
        int? limit,
        string? column,
        string? cursor,
        BoardProjectionService board)
    {
        try
        {
            var response = await board.GetBoardAsync(
                projectId,
                groupBy,
                iterationId,
                assigneeId,
                SplitCsv(kind),
                limit,
                column,
                cursor);
            return Results.Ok(response);
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> ApplySprintPlan(
        Guid id,
        ApplySprintPlanRequest? request,
        SprintPlanApplyService sprintPlanApply,
        CancellationToken ct)
    {
        if (request is null || request.DocumentId is not Guid documentId || documentId == Guid.Empty)
        {
            return Results.BadRequest(new
            {
                error = "Body field 'documentId' is required.",
                code = "TRACKER.MISSING_FIELD",
            });
        }

        try
        {
            var result = await sprintPlanApply.ApplyAsync(id, documentId, ct);
            return Results.Ok(result);
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    // ═══════════════════════════ Preferences ════════════════════════════════
    // The ONE place a mode branch appears (plan D4): the preference row is
    // per-principal configuration, keyed on user_id in single-user and
    // tenant_id in SaaS, over 44-1's parallel never-joined repository surfaces.

    public static async Task<IResult> GetPreferences(
        ITrackerService tracker,
        ClaimsPrincipal principal,
        ITenantContext tenantContext,
        ITammaModeProvider modeProvider,
        HttpContext http)
    {
        try
        {
            var resolved = modeProvider.Mode == TammaMode.SaaS && tenantContext.TenantId is Guid tenantId
                ? await tracker.GetPreferencesForTenantAsync(tenantId)
                : await tracker.GetPreferencesAsync(principal.GetUserId());
            SetETag(http, resolved.Version);
            return Results.Ok(Map(resolved));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    public static async Task<IResult> PutPreferences(
        UpsertTrackerPreferencesRequest request,
        ITrackerService tracker,
        ClaimsPrincipal principal,
        ITenantContext tenantContext,
        ITammaModeProvider modeProvider,
        HttpContext http)
    {
        if (!TryReadIfMatch(http, out var ifMatch, out var precondition))
            return precondition!;
        try
        {
            var userId = principal.GetUserId();
            var saas = modeProvider.Mode == TammaMode.SaaS && tenantContext.TenantId is Guid;

            // The eager check gives the caller the ACTUAL current version in the
            // 409 body (the atomic guard below can only say "you lost"). It is
            // NOT the guard itself: the read and the write are separate
            // contexts, so `ifMatch` also rides into the repository, where it
            // becomes `WHERE "Version" = @expected` on the UPDATE (44-2 review
            // 2026-07-29 — before that, two concurrent PUTs both carrying
            // `If-Match: 1` both returned 200).
            if (ifMatch is int expected)
            {
                var current = saas
                    ? await tracker.GetPreferencesForTenantAsync((Guid)tenantContext.TenantId!)
                    : await tracker.GetPreferencesAsync(userId);
                if (current.Version != expected)
                    return Conflict(TrackerVersionConflict("tracker preferences", expected, current.Version));
            }

            var resolved = saas
                ? await tracker.UpsertPreferencesForTenantAsync(
                    (Guid)tenantContext.TenantId!, request, userId, ifMatch)
                : await tracker.UpsertPreferencesAsync(userId, request, userId, ifMatch);
            SetETag(http, resolved.Version);
            return Results.Ok(Map(resolved));
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    /// <summary>
    /// Delete the principal's override so the shipped defaults take over (AC8).
    ///
    /// <para>Honours <c>If-Match</c> like every other mutation (AC9). Until the
    /// 44-2 conformance round (2026-07-29) this route was the single carve-out:
    /// it never read the header, so a reset raced against a concurrent save
    /// discarded that save with no 409. Absent header still means "no
    /// precondition"; <c>*</c> passes; junk is a 400; a stale version is a
    /// retryable 409.</para>
    /// </summary>
    public static async Task<IResult> DeletePreferences(
        ITrackerService tracker,
        ClaimsPrincipal principal,
        ITenantContext tenantContext,
        ITammaModeProvider modeProvider,
        HttpContext http)
    {
        if (!TryReadIfMatch(http, out var ifMatch, out var precondition))
            return precondition!;
        try
        {
            var deleted = modeProvider.Mode == TammaMode.SaaS && tenantContext.TenantId is Guid tenantId
                ? await tracker.DeletePreferencesForTenantAsync(tenantId, ifMatch)
                : await tracker.DeletePreferencesAsync(principal.GetUserId(), ifMatch);

            if (!deleted)
                return Results.NotFound(new { error = "No tracker-preferences override to delete" });
            return Results.Ok(new { message = "Tracker-preferences override deleted; the defaults apply." });
        }
        catch (TammaError te)
        {
            return MapError(te);
        }
    }

    // ═══════════════════════════ Helpers ════════════════════════════════════

    /// <summary>Cap on the blocking-row list carried in a 409 body.</summary>
    private const int BlockerListLimit = 50;

    private static ProjectResponse Map(ProjectEntity p) => new(
        p.Id, p.Key, p.Name, p.Description, p.RepositoryId, p.EstimateScale, p.NextNumber,
        p.ArchivedAt, p.CreatedByUserId, p.CreatedAt, p.UpdatedAt, p.Version);

    private static IterationResponse MapIteration(
        IterationEntity i, int? carryOverMovedCount = null, int? carryOverLeftCount = null) => new(
        i.Id, i.ProjectId, i.Name, i.StartsOn, i.EndsOn, i.Status, i.CapacityPoints,
        i.CreatedAt, i.UpdatedAt, i.Version, carryOverMovedCount, carryOverLeftCount);

    private static readonly IReadOnlyDictionary<string, int> EmptyStatusCounts =
        new Dictionary<string, int>();

    private static WorkItemResponse Map(WorkItemEntity w) =>
        Map(w, 0, EmptyStatusCounts);

    private static WorkItemResponse Map(
        WorkItemEntity w, int childCount, IReadOnlyDictionary<string, int> childCountByStatus) => new(
        w.Id, w.ProjectId, w.Key, w.PreviousKeys, w.Number, w.Kind, w.Status,
        // Derived ONCE, by the Core extension — never a set literal here (44-0 AC3).
        WorkItemStatusExtensions.Parse(w.Status).Category().ToWire(),
        w.Priority, w.IssueType, w.Title, w.Description, w.ParentId, w.IterationId,
        w.Rank, w.SiblingRank, w.AssigneeUserId, w.CreatedByUserId, w.Estimate,
        TrackerService.ParseExternalRef(w.ExternalRefJson),
        w.CreatedAt, w.UpdatedAt, w.ClosedAt, w.Version,
        childCount, childCountByStatus);

    private static WorkItemSubtreeNodeResponse MapSubtreeNode(WorkItemSubtreeNode n)
    {
        var w = n.Item;
        return new WorkItemSubtreeNodeResponse(
            w.Id, w.ProjectId, w.Key, w.PreviousKeys, w.Number, w.Kind, w.Status,
            WorkItemStatusExtensions.Parse(w.Status).Category().ToWire(),
            w.Priority, w.IssueType, w.Title, w.Description, w.ParentId, w.IterationId,
            w.Rank, w.SiblingRank, w.AssigneeUserId, w.CreatedByUserId, w.Estimate,
            TrackerService.ParseExternalRef(w.ExternalRefJson),
            w.CreatedAt, w.UpdatedAt, w.ClosedAt, w.Version,
            n.Depth, n.ChildCount, n.ChildCountByStatus);
    }

    private static TrackerPreferencesResponse Map(ResolvedTrackerPreferences r) => new(
        r.DefaultProjectId, r.DefaultKind, r.BoardGroupBy,
        r.IsOverride ? "principal-override" : "system-default",
        r.Version, r.UpdatedAt);

    private static IReadOnlyCollection<string>? SplitCsv(string? csv) =>
        string.IsNullOrWhiteSpace(csv)
            ? null
            : csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>
    /// AC9 — the <c>ETag</c> carried by every single-resource response. The
    /// entity <c>Version</c> IS the token (44-1 D10); quoting it keeps the
    /// header a well-formed strong ETag so a stock HTTP client round-trips it
    /// into <c>If-Match</c> unmodified.
    /// </summary>
    private static void SetETag(HttpContext http, int version) =>
        http.Response.Headers[HeaderNames.ETag] = $"\"{version}\"";

    /// <summary>
    /// Parse <c>If-Match</c>. Absent means "no precondition" (the caller opts
    /// out; work items still carry the in-repository EF concurrency token).
    /// <c>*</c> means "any existing version". Anything else must be the integer
    /// <c>Version</c>, quoted or bare — junk is a 400, never a silently ignored
    /// precondition, because ignoring it is exactly the lost update the header
    /// exists to prevent.
    /// </summary>
    private static bool TryReadIfMatch(HttpContext http, out int? version, out IResult? error)
    {
        version = null;
        error = null;
        var raw = http.Request.Headers[HeaderNames.IfMatch].ToString();
        if (string.IsNullOrWhiteSpace(raw))
            return true;
        raw = raw.Trim();
        if (raw == "*")
            return true;
        var unquoted = raw.Trim('"');
        if (unquoted.StartsWith("W/", StringComparison.Ordinal))
            unquoted = unquoted[2..].Trim('"');
        if (int.TryParse(unquoted, out var parsed) && parsed >= 0)
        {
            version = parsed;
            return true;
        }
        error = Results.BadRequest(new
        {
            error = $"If-Match '{raw}' is not a version token this API issued. Send the ETag "
                + "from the last read verbatim, or `*`, or omit the header.",
            code = "TRACKER.INVALID_IF_MATCH",
        });
        return false;
    }

    private static IResult NotFound(string noun, Guid id) => Results.NotFound(new
    {
        error = $"No {noun} '{id}' in this tenant.",
        code = "TRACKER.NOT_FOUND",
    });

    private static IResult Conflict(object body) => Results.Conflict(body);

    private static object TrackerVersionConflict(string noun, int expected, int actual) => new
    {
        error = $"The {noun} is at version {actual}, but If-Match asked for {expected}. "
            + "Another writer changed it; re-read and retry.",
        code = "TRACKER.CONCURRENCY_CONFLICT",
        retryable = true,
        expectedVersion = expected,
        actualVersion = actual,
    };

    /// <summary>
    /// The single <c>TammaError</c> → HTTP mapping for this surface. Codes are
    /// carried through verbatim so a client can branch on the code, not the
    /// prose, and <c>retryable</c> rides along because 44-1 types the
    /// concurrency conflict as retryable and a caller needs to know.
    /// </summary>
    private static IResult MapError(TammaError te)
    {
        if (te.Code == "KIND_NOT_PERMITTED"
            && te.Context is not null
            && te.Context.TryGetValue("violations", out var violations))
        {
            return Results.BadRequest(new
            {
                error = te.Message,
                code = te.Code,
                retryable = te.Retryable,
                violations,
            });
        }

        var body = new
        {
            error = te.Message,
            code = te.Code,
            retryable = te.Retryable,
        };
        return te.Code switch
        {
            // The resource moved under the caller — authorized and well-formed,
            // so 409 rather than 412 (plan D8; Epic 43 already establishes 409
            // as this codebase's "the system will not do that right now").
            "TRACKER.CONCURRENCY_CONFLICT" => Results.Conflict(body),
            "TRACKER.KEY_CONFLICT" => Results.Conflict(body),
            "TRACKER.CROSS_PROJECT_REKEY" => Results.Conflict(body),
            // Story 44-3 AC7 / D7 & Story 44-4 AC9 / D7: well-formed & authorized,
            // but the document or iteration is not in a state the system will act on → 409.
            "DOCUMENT_NOT_BACKLOG_ORDERING" => Results.Conflict(body),
            "DOCUMENT_NOT_SPRINT_PLAN" => Results.Conflict(body),
            "DOCUMENT_NOT_ACCEPTED" => Results.Conflict(body),
            "ITERATION_ALREADY_ACTIVE" => Results.Conflict(body),
            "ITERATION_INVALID_TRANSITION" => Results.Conflict(body),
            "ITERATION_CLOSED" => Results.Conflict(body),
            "ITERATION_INVALID_CARRYOVER_TARGET" => Results.Conflict(body),
            "TRACKER.ITERATION_NAME_CONFLICT" => Results.Conflict(body),
            "TRACKER.PROJECT_NOT_FOUND" => Results.NotFound(body),
            "TRACKER.ITERATION_NOT_FOUND" => Results.NotFound(body),
            "TRACKER.DOCUMENT_NOT_FOUND" => Results.NotFound(body),
            "TRACKER.PARENT_NOT_FOUND" => Results.NotFound(body),
            "TRACKER.NOT_FOUND" => Results.NotFound(body),
            "TRACKER.PRINCIPAL_UNRESOLVED" => Results.Conflict(body),
            // Authenticated and well-formed, but there is no tenant to answer
            // for — 409, never an unhandled 500 out of a repository.
            "TRACKER.TENANT_UNRESOLVED" => Results.Conflict(body),
            "GOVERNANCE.PRINCIPAL.NO_SOLE_USER" => Results.Conflict(body),
            // Every remaining TRACKER.* / hierarchy code (KIND_NOT_PERMITTED,
            // MAX_DEPTH_EXCEEDED, WOULD_CREATE_CYCLE, CROSS_PROJECT_PARENT,
            // TRACKER.CROSS_PROJECT_RELATION, TRACKER.INVALID_MOVE_NEIGHBOR, …)
            // is a caller error → 400.
            _ => Results.BadRequest(body),
        };
    }

    private static bool IsUniqueViolation(Microsoft.EntityFrameworkCore.DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException { SqlState: "23505" };

    /// <summary>
    /// PostgreSQL <c>foreign_key_violation</c>. The two deletes pre-query their
    /// blocking children and answer 409 with the list, but that pre-check is
    /// inherently racy — a row created in the gap trips the RESTRICT FK at
    /// SaveChanges. Same shape as <see cref="IsUniqueViolation"/>'s 23505 use in
    /// <see cref="CreateProject"/>.
    /// </summary>
    private static bool IsForeignKeyViolation(Microsoft.EntityFrameworkCore.DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException { SqlState: "23503" };

    /// <summary>The 409 for a project that gained a work item after the pre-check.</summary>
    internal static IResult ProjectNotEmptyRace(Guid projectId) => Results.Conflict(new
    {
        error = $"Project '{projectId}' gained at least one work item after this request's "
            + "emptiness check and the database refused the delete (work_items FK RESTRICT). "
            + "Re-read the project's work items, move or delete them, and retry.",
        code = "TRACKER.PROJECT_NOT_EMPTY",
        retryable = true,
    });

    /// <summary>The 409 for a work item that gained a child after the pre-check.</summary>
    internal static IResult HasChildrenRace(Guid id) => Results.Conflict(new
    {
        error = $"Work item '{id}' gained at least one child after this request's child check "
            + "and the database refused the delete (parent FK RESTRICT). Re-read the children, "
            + "reparent or delete them, and retry.",
        code = "TRACKER.HAS_CHILDREN",
        retryable = true,
    });
}
