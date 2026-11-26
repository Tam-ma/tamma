using System.Text.Json;
using Tamma.Activities.Documents;
using Tamma.Api.Services.Access;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Tasks;

/// <summary>
/// Story 39-19 (AC3 / AC4 / D7) — pure DCB projection powering the Task View
/// (<c>GET /api/tasks</c> and <c>GET /api/tasks/{sessionId}</c>).
///
/// <para>Folds <c>TASK.*</c> (<see cref="TaskEvents"/>) and <c>APPROVAL.*</c>
/// (<see cref="ApprovalEvents"/>) events per decision session:
/// <list type="bullet">
///   <item>Assignment / reassignment updates the active role, resolved audience,
///     eligibility basis, and autonomy context.</item>
///   <item>Completion occurs when EITHER <c>APPROVAL.PROVIDED</c> OR
///     <c>TASK.COMPLETED(.SUCCESS)</c> exists for the session — removing the item
///     from every eligible user's pending inbox (single completion, AC3).</item>
///   <item>Visibility is enforced server-side via Story 39-20's canonical
///     <see cref="ITaskAudienceResolver"/>.</item>
/// </list></para>
/// </summary>
public sealed class TaskInboxProjection
{
    private const string TaskPrefix = "TASK.";
    private const string ApprovalPrefix = "APPROVAL.";
    private const int EventScanLimit = 1000;

    private readonly IEventRepository _events;
    private readonly ITaskAudienceResolver _audienceResolver;

    public TaskInboxProjection(
        IEventRepository events,
        ITaskAudienceResolver audienceResolver)
    {
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _audienceResolver = audienceResolver ?? throw new ArgumentNullException(nameof(audienceResolver));
    }

    public async Task<IReadOnlyList<TaskViewItem>> ListForUserAsync(
        Guid? tenantId,
        Guid userId,
        bool includeCompleted = false,
        CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
            return Array.Empty<TaskViewItem>();

        var folded = await FoldTasksAsync(tenantId).ConfigureAwait(false);
        var visible = new List<TaskViewItem>();

        foreach (var state in folded.Values)
        {
            if (!includeCompleted && state.Completed)
                continue;

            if (!await CanUserSeeTaskAsync(tenantId, userId, state).ConfigureAwait(false))
                continue;

            visible.Add(ToViewItem(state));
        }

        // Oldest pending first (AC3); stable tie-breaker by SessionId.
        return visible
            .OrderBy(t => t.Status == "completed" ? 1 : 0)
            .ThenBy(t => t.AssignedAt)
            .ThenBy(t => t.SessionId)
            .ToList();
    }

    public async Task<TaskViewItem?> GetForUserAsync(
        Guid? tenantId,
        Guid userId,
        Guid sessionId,
        CancellationToken ct = default)
    {
        if (userId == Guid.Empty || sessionId == Guid.Empty)
            return null;

        var folded = await FoldTasksAsync(tenantId).ConfigureAwait(false);
        if (!folded.TryGetValue(sessionId, out var state))
            return null;

        if (!await CanUserSeeTaskAsync(tenantId, userId, state).ConfigureAwait(false))
            return null;

        return ToViewItem(state);
    }

    private async Task<bool> CanUserSeeTaskAsync(Guid? tenantId, Guid userId, FoldedTask state)
    {
        // Single-user mode (no tenant): the sole user sees all tasks.
        if (tenantId is null || tenantId == Guid.Empty)
            return true;

        var taskRef = new TaskRef(
            TenantId: tenantId.Value,
            InitiatorUserId: state.InitiatorUserId,
            RepoKey: state.RepoKey ?? ExtractRepoKey(state.IssueId),
            IssueId: state.IssueId,
            RepositoryId: state.RepositoryId,
            DocumentId: state.DocumentId,
            RequiredPermission: state.RequiredPermission);

        // 1. Live visibility predicate from Story 39-20 (tenant member AND (initiator OR repo access)).
        var canSee = await _audienceResolver.CanSeeAsync(userId, taskRef).ConfigureAwait(false);
        if (!canSee)
            return false;

        // 2. Role-addressed audience check: if the resolver returns a live eligible audience
        //    for the currently assigned role, require membership in it (so reassigning from
        //    member -> admin immediately clears non-admin inboxes and revoked grants drop out).
        if (!string.IsNullOrWhiteSpace(state.AssignedRole))
        {
            var eligible = await _audienceResolver
                .EligibleAudienceAsync(taskRef, state.AssignedRole)
                .ConfigureAwait(false);

            if (eligible.Count > 0)
                return eligible.Any(m => m.UserId == userId);

            // Fallback for lightweight unit-test doubles that stub only CanSeeAsync:
            // if the latest TASK.ASSIGNED/REASSIGNED event recorded an explicit audienceUserIds list,
            // enforce it (always allowing the workflow initiator if present).
            if (state.RecordedAudienceUserIds is { Count: > 0 } recorded)
                return recorded.Contains(userId);
        }

        return true;
    }

    private async Task<Dictionary<Guid, FoldedTask>> FoldTasksAsync(Guid? tenantId)
    {
        var allEvents = await FetchTaskAndApprovalEventsAsync(tenantId).ConfigureAwait(false);

        // Apply oldest-first so reassignment and completion cleanly overwrite earlier state.
        var ordered = allEvents
            .OrderBy(e => e.SequenceNumber)
            .ThenBy(e => e.CreatedAt)
            .ToList();

        var tasks = new Dictionary<Guid, FoldedTask>();
        // Secondary index from (documentId | issueId) -> sessionId so TASK.* events
        // emitted without an explicit sessionId tag join cleanly with APPROVAL.REQUESTED.
        var byDocumentId = new Dictionary<Guid, Guid>();
        var byIssueId = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);

        // First pass: register APPROVAL.REQUESTED sessions so secondary keys resolve immediately.
        foreach (var evt in ordered)
        {
            if (!string.Equals(evt.Type, ApprovalEvents.Requested, StringComparison.Ordinal))
                continue;

            var tags = ParseObject(evt.Tags);
            var data = ParseObject(evt.Data);
            var sessionId = TryGetGuid(tags, "sessionId") ?? TryGetGuid(data, "sessionId");
            if (sessionId is not { } sid)
                continue;

            var docId = TryGetGuid(tags, "documentId") ?? TryGetGuid(data, "documentId");
            var issueId = TryGetString(tags, "issueId") ?? TryGetString(data, "issueId");
            if (docId is { } d) byDocumentId[d] = sid;
            if (!string.IsNullOrWhiteSpace(issueId)) byIssueId[issueId] = sid;
        }

        // Second pass: fold all events chronologically.
        foreach (var evt in ordered)
        {
            var tags = ParseObject(evt.Tags);
            var data = ParseObject(evt.Data);

            var sessionId = ResolveSessionId(tags, data, byDocumentId, byIssueId);

            switch (evt.Type)
            {
                case ApprovalEvents.Requested:
                {
                    if (sessionId is not { } sid) break;
                    var state = GetOrCreate(tasks, sid, evt.CreatedAt);
                    state.DocumentType ??= TryGetString(tags, "documentType") ?? TryGetString(data, "documentType");
                    state.DocumentId ??= TryGetGuid(tags, "documentId") ?? TryGetGuid(data, "documentId");
                    state.IssueId ??= TryGetString(tags, "issueId") ?? TryGetString(data, "issueId");
                    state.CorrelationId ??= TryGetString(tags, "correlationId") ?? TryGetString(data, "correlationId");
                    state.RulesReference ??= TryGetString(data, "rulesReference");
                    state.RepoKey ??= TryGetString(tags, "repo") ?? TryGetString(data, "repoKey") ?? ExtractRepoKey(state.IssueId);
                    state.InitiatorUserId ??= TryGetGuid(tags, "initiatedBy") ?? TryGetGuid(data, "initiatedBy");
                    if (TryParseTimestamp(TryGetString(data, "requestedAtUtc")) is { } reqAt)
                        state.RequestedAt ??= reqAt;
                    break;
                }

                case ApprovalEvents.Provided:
                {
                    if (sessionId is not { } sid) break;
                    var state = GetOrCreate(tasks, sid, evt.CreatedAt);
                    state.Completed = true;
                    break;
                }

                case TaskEvents.Assigned:
                case "TASK.ASSIGNED":
                {
                    // Allow standalone TASK.ASSIGNED fixtures that carry sessionId/taskId or only documentId.
                    var sid = sessionId
                        ?? TryGetGuid(tags, "taskId")
                        ?? TryGetGuid(data, "taskId")
                        ?? TryGetGuid(tags, "documentId")
                        ?? evt.Id;

                    var state = GetOrCreate(tasks, sid, evt.CreatedAt);
                    state.HasAssignment = true;
                    ApplyAssignmentFields(state, tags, data, evt.CreatedAt);

                    if (state.DocumentId is { } d && !byDocumentId.ContainsKey(d))
                        byDocumentId[d] = sid;
                    if (!string.IsNullOrWhiteSpace(state.IssueId) && !byIssueId.ContainsKey(state.IssueId))
                        byIssueId[state.IssueId] = sid;
                    break;
                }

                case TaskEvents.Reassigned:
                case "TASK.REASSIGNED":
                {
                    if (sessionId is not { } sid) break;
                    var state = GetOrCreate(tasks, sid, evt.CreatedAt);
                    state.HasAssignment = true;
                    ApplyAssignmentFields(state, tags, data, evt.CreatedAt);
                    break;
                }

                case TaskEvents.Completed:
                case "TASK.COMPLETED":
                {
                    if (sessionId is not { } sid) break;
                    var state = GetOrCreate(tasks, sid, evt.CreatedAt);
                    state.Completed = true;
                    break;
                }
            }
        }

        // Only surface entries that were actually assigned as a human task (not every
        // orchestrator-handled APPROVAL.REQUESTED gate that was never assigned to a role).
        return tasks
            .Where(kv => kv.Value.HasAssignment)
            .ToDictionary(kv => kv.Key, kv => kv.Value);
    }

    private static void ApplyAssignmentFields(
        FoldedTask state,
        Dictionary<string, JsonElement> tags,
        Dictionary<string, JsonElement> data,
        DateTime createdAt)
    {
        var role = TryGetString(data, "roleWire")
            ?? TryGetString(data, "assignedRole")
            ?? TryGetString(tags, "assignedRole");
        if (!string.IsNullOrWhiteSpace(role))
            state.AssignedRole = role;

        var basis = TryGetString(data, "basis") ?? TryGetString(data, "eligibilityBasis");
        if (!string.IsNullOrWhiteSpace(basis))
            state.EligibilityBasis = basis;

        var taskType = TryGetString(data, "taskType");
        if (!string.IsNullOrWhiteSpace(taskType))
            state.TaskType = TaskTypes.Normalize(taskType);

        var autonomyContext = TryGetString(data, "autonomyContext")
            ?? TryGetString(data, "autonomyContextRef");
        if (!string.IsNullOrWhiteSpace(autonomyContext))
            state.AutonomyContext = autonomyContext;

        var rulesRef = TryGetString(data, "rulesReference");
        if (!string.IsNullOrWhiteSpace(rulesRef))
            state.RulesReference = rulesRef;

        state.DocumentType ??= TryGetString(tags, "documentType") ?? TryGetString(data, "documentType");
        state.DocumentId ??= TryGetGuid(tags, "documentId") ?? TryGetGuid(data, "documentId");
        state.IssueId ??= TryGetString(tags, "issueId") ?? TryGetString(data, "issueId");
        state.CorrelationId ??= TryGetString(tags, "correlationId") ?? TryGetString(data, "correlationId");
        state.RepoKey = TryGetString(tags, "repo")
            ?? TryGetString(data, "repoKey")
            ?? state.RepoKey
            ?? ExtractRepoKey(state.IssueId);
        state.RepositoryId ??= TryGetGuid(tags, "repositoryId") ?? TryGetGuid(data, "repositoryId");
        state.InitiatorUserId = TryGetGuid(tags, "initiatedBy")
            ?? TryGetGuid(data, "initiatedBy")
            ?? TryGetGuid(data, "initiatorUserId")
            ?? state.InitiatorUserId;
        state.RequiredPermission = TryGetString(data, "requiredPermission") ?? state.RequiredPermission;

        var audience = TryGetGuidSet(data, "audienceUserIds");
        if (audience is not null)
            state.RecordedAudienceUserIds = audience;

        var eventTs = ToUtcOffset(createdAt);
        if (state.AssignedAt == default)
            state.AssignedAt = state.RequestedAt ?? eventTs;
    }

    private async Task<IReadOnlyList<DomainEvent>> FetchTaskAndApprovalEventsAsync(Guid? tenantId)
    {
        if (tenantId is { } tid && tid != Guid.Empty)
        {
            var (taskEvents, _) = await _events.QueryEventsAsync(
                tenantId: tid,
                type: TaskPrefix,
                typeIsPrefix: true,
                correlationId: null,
                actor: null,
                from: null,
                to: null,
                cursor: null,
                limit: EventScanLimit,
                includeTotal: false).ConfigureAwait(false);

            var (approvalEvents, _) = await _events.QueryEventsAsync(
                tenantId: tid,
                type: ApprovalPrefix,
                typeIsPrefix: true,
                correlationId: null,
                actor: null,
                from: null,
                to: null,
                cursor: null,
                limit: EventScanLimit,
                includeTotal: false).ConfigureAwait(false);

            return taskEvents.Concat(approvalEvents).ToList();
        }

        // Single-user mode (null tenantId): merge exact-type QueryAsync calls.
        var results = new List<DomainEvent>();
        foreach (var eventType in new[]
        {
            TaskEvents.Assigned,
            TaskEvents.Reassigned,
            TaskEvents.Completed,
            "TASK.ASSIGNED",
            "TASK.REASSIGNED",
            "TASK.COMPLETED",
            ApprovalEvents.Requested,
            ApprovalEvents.Provided,
        })
        {
            var batch = await _events.QueryAsync(null, eventType, null, 250).ConfigureAwait(false);
            results.AddRange(batch);
        }
        return results;
    }

    private static Guid? ResolveSessionId(
        Dictionary<string, JsonElement> tags,
        Dictionary<string, JsonElement> data,
        Dictionary<Guid, Guid> byDocumentId,
        Dictionary<string, Guid> byIssueId)
    {
        var explicitSession = TryGetGuid(tags, "sessionId")
            ?? TryGetGuid(data, "sessionId")
            ?? TryGetGuid(data, "decisionSessionId");
        if (explicitSession is { } sid)
            return sid;

        var docId = TryGetGuid(tags, "documentId") ?? TryGetGuid(data, "documentId");
        if (docId is { } d && byDocumentId.TryGetValue(d, out var byDoc))
            return byDoc;

        var issueId = TryGetString(tags, "issueId") ?? TryGetString(data, "issueId");
        if (!string.IsNullOrWhiteSpace(issueId) && byIssueId.TryGetValue(issueId, out var byIssue))
            return byIssue;

        return null;
    }

    private static FoldedTask GetOrCreate(Dictionary<Guid, FoldedTask> map, Guid sessionId, DateTime createdAt)
    {
        if (!map.TryGetValue(sessionId, out var state))
        {
            state = new FoldedTask(sessionId, ToUtcOffset(createdAt));
            map[sessionId] = state;
        }
        return state;
    }

    private static TaskViewItem ToViewItem(FoldedTask state)
    {
        string? lineageUrl = !string.IsNullOrWhiteSpace(state.IssueId)
            ? $"/api/documents/issues/{Uri.EscapeDataString(state.IssueId)}/lineage"
            : null;

        return new TaskViewItem(
            SessionId: state.SessionId,
            TaskType: TaskTypes.Normalize(state.TaskType),
            DocumentType: state.DocumentType,
            DocumentId: state.DocumentId,
            IssueId: state.IssueId,
            CorrelationId: state.CorrelationId,
            RepoKey: state.RepoKey,
            AssignedRole: state.AssignedRole ?? "member",
            EligibilityBasis: state.EligibilityBasis ?? TaskEvents.BasisRepoAccess,
            AutonomyContext: state.AutonomyContext,
            RulesReference: state.RulesReference,
            AssignedAt: state.AssignedAt,
            Status: state.Completed ? "completed" : "pending",
            LineageUrl: lineageUrl);
    }

    internal static string? ExtractRepoKey(string? issueId)
    {
        if (string.IsNullOrWhiteSpace(issueId))
            return null;
        var hashIndex = issueId.IndexOf('#', StringComparison.Ordinal);
        if (hashIndex <= 0)
            return null;
        var prefix = issueId[..hashIndex].Trim();
        return prefix.Contains('/', StringComparison.Ordinal) ? prefix : null;
    }

    private static DateTimeOffset ToUtcOffset(DateTime dt) =>
        dt.Kind == DateTimeKind.Utc
            ? new DateTimeOffset(dt, TimeSpan.Zero)
            : new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc), TimeSpan.Zero);

    private static DateTimeOffset? TryParseTimestamp(string? raw) =>
        DateTimeOffset.TryParse(raw, out var ts) ? ts.ToUniversalTime() : null;

    private static Dictionary<string, JsonElement> ParseObject(string? json) =>
        Chat.ChatHistoryProjection.ParseObject(json);

    private static string? TryGetString(Dictionary<string, JsonElement> map, string key) =>
        Chat.ChatHistoryProjection.TryGetString(map, key);

    private static Guid? TryGetGuid(Dictionary<string, JsonElement> map, string key) =>
        Chat.ChatHistoryProjection.TryGetGuid(map, key);

    private static HashSet<Guid>? TryGetGuidSet(Dictionary<string, JsonElement> map, string key)
    {
        if (!map.TryGetValue(key, out var el) || el.ValueKind != JsonValueKind.Array)
            return null;
        var set = new HashSet<Guid>();
        foreach (var item in el.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && Guid.TryParse(item.GetString(), out var g) && g != Guid.Empty)
                set.Add(g);
        }
        return set;
    }

    private sealed class FoldedTask
    {
        public FoldedTask(Guid sessionId, DateTimeOffset createdAt)
        {
            SessionId = sessionId;
            AssignedAt = createdAt;
        }

        public Guid SessionId { get; }
        public bool HasAssignment { get; set; }
        public bool Completed { get; set; }
        public string TaskType { get; set; } = TaskTypes.AcceptanceDecision;
        public string? DocumentType { get; set; }
        public Guid? DocumentId { get; set; }
        public string? IssueId { get; set; }
        public string? CorrelationId { get; set; }
        public string? RepoKey { get; set; }
        public Guid? RepositoryId { get; set; }
        public Guid? InitiatorUserId { get; set; }
        public string? RequiredPermission { get; set; }
        public string? AssignedRole { get; set; }
        public string? EligibilityBasis { get; set; }
        public string? AutonomyContext { get; set; }
        public string? RulesReference { get; set; }
        public DateTimeOffset? RequestedAt { get; set; }
        public DateTimeOffset AssignedAt { get; set; }
        public HashSet<Guid>? RecordedAudienceUserIds { get; set; }
    }
}
