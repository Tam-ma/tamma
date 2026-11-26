using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Tamma.Core;
using Tamma.Core.Documents;
using Tamma.Core.Tracking;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <summary>
/// Tenant-scoped <c>iterations</c> repository (Story 44-1; lifecycle, carry-over,
/// and SQL summary added by Story 44-4).
/// </summary>
public class IterationRepository(
    ITenantDbContextFactory tenantDbFactory,
    ITenantContext tenantContext) : IIterationRepository
{
    public const string StatusPlanned = "planned";
    public const string StatusActive = "active";
    public const string StatusClosed = "closed";

    public const string CarryOverToBacklog = "to-backlog";
    public const string CarryOverMoveTo = "move-to";
    public const string CarryOverLeave = "leave";

    private static readonly string[] s_statuses = [StatusPlanned, StatusActive, StatusClosed];

    private static readonly string[] s_terminalStatuses = Enum.GetValues<WorkItemStatus>()
        .Where(s => s.IsTerminal())
        .Select(s => s.ToWire())
        .ToArray();

    private Guid RequireTenantId() => tenantContext.TenantId
        ?? throw new InvalidOperationException(
            "IterationRepository requires an ambient tenant id. Tracker tables are "
            + "tenant-schema resident (Epic 44 D5).");

    public async Task<IterationEntity?> GetAsync(Guid id)
    {
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        return await db.Iterations.FirstOrDefaultAsync(i => i.Id == id);
    }

    public async Task<List<IterationEntity>> ListByProjectAsync(Guid projectId)
    {
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        return await db.Iterations
            .Where(i => i.ProjectId == projectId)
            .OrderBy(i => i.StartsOn)
            .ThenBy(i => i.Name)
            .ToListAsync();
    }

    public async Task<IterationEntity> CreateAsync(IterationEntity iteration)
    {
        ArgumentNullException.ThrowIfNull(iteration);
        ValidateStatus(iteration.Status);

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        await using var tx = await db.Database.BeginTransactionAsync();

        // Lock project row FOR UPDATE so creating an active iteration serializes
        // cleanly with any concurrent create or activation (AC2 / D1).
        var project = await db.Projects
            .FromSqlInterpolated(
                $"""SELECT * FROM projects WHERE "Id" = {iteration.ProjectId} FOR UPDATE""")
            .AsNoTracking()
            .SingleOrDefaultAsync()
            ?? throw new TammaError(
                "TRACKER.PROJECT_NOT_FOUND",
                $"Project '{iteration.ProjectId}' does not exist in this tenant.",
                new Dictionary<string, object?> { ["projectId"] = iteration.ProjectId },
                retryable: false,
                severity: TammaErrorSeverity.Medium);

        if (string.Equals(iteration.Status, StatusActive, StringComparison.Ordinal))
        {
            var incumbent = await db.Iterations
                .FirstOrDefaultAsync(i => i.ProjectId == project.Id && i.Status == StatusActive);
            if (incumbent is not null)
                throw AlreadyActive(project.Id, incumbent);
        }

        if (iteration.Id == Guid.Empty)
            iteration.Id = UuidV7.NewGuid();
        iteration.CreatedAt = DateTime.UtcNow;
        iteration.UpdatedAt = iteration.CreatedAt;
        iteration.Version = 1;

        db.Iterations.Add(iteration);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex, "ix_iterations_one_active"))
        {
            var incumbent = await db.Iterations
                .FirstOrDefaultAsync(i => i.ProjectId == project.Id && i.Status == StatusActive);
            throw AlreadyActive(project.Id, incumbent);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex, "UX_iterations_project_name"))
        {
            throw NameConflict(project.Id, iteration.Name);
        }

        await tx.CommitAsync();
        return iteration;
    }

    public async Task<IterationEntity?> UpdateAsync(IterationEntity iteration, int? expectedVersion = null)
    {
        ArgumentNullException.ThrowIfNull(iteration);
        ValidateStatus(iteration.Status);

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        var existing = await db.Iterations.FirstOrDefaultAsync(i => i.Id == iteration.Id);
        if (existing is null)
            return null;

        if (expectedVersion is int expected && existing.Version != expected)
            throw VersionConflict(existing.Id, expected, existing.Version);

        existing.Name = iteration.Name;
        existing.StartsOn = iteration.StartsOn;
        existing.EndsOn = iteration.EndsOn;
        existing.Status = iteration.Status;
        existing.CapacityPoints = iteration.CapacityPoints;
        existing.UpdatedAt = DateTime.UtcNow;
        existing.Version += 1;
        PinExpectedVersion(db, existing, expectedVersion);
        await SaveGuardingVersionAsync(db, existing.Id, existing.ProjectId, existing.Name);
        return existing;
    }

    public async Task<IterationTransitionResult?> PatchAndTransitionAsync(
        Guid id, IterationPatch patch, int? expectedVersion = null,
        Func<TenantDbContext, IterationTransitionResult, Task>? beforeCommit = null)
    {
        ArgumentNullException.ThrowIfNull(patch);

        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        await using var tx = await db.Database.BeginTransactionAsync();

        var projectId = await db.Iterations
            .Where(i => i.Id == id)
            .Select(i => (Guid?)i.ProjectId)
            .FirstOrDefaultAsync();
        if (projectId is null)
            return null;

        // Serialize concurrent activations and closes within the project (AC2 / D1).
        await db.Projects
            .FromSqlInterpolated(
                $"""SELECT * FROM projects WHERE "Id" = {projectId.Value} FOR UPDATE""")
            .AsNoTracking()
            .SingleOrDefaultAsync();

        var existing = await db.Iterations.FirstOrDefaultAsync(i => i.Id == id);
        if (existing is null)
            return null;

        if (expectedVersion is int expected && existing.Version != expected)
            throw VersionConflict(id, expected, existing.Version);

        var previousStatus = existing.Status;

        if (patch.HasName)
        {
            if (string.IsNullOrWhiteSpace(patch.Name))
            {
                throw new TammaError(
                    "TRACKER.MISSING_FIELD",
                    "Body field 'name' cannot be empty or null.",
                    new Dictionary<string, object?> { ["field"] = "name" },
                    retryable: false,
                    severity: TammaErrorSeverity.Low);
            }
            existing.Name = patch.Name.Trim();
        }
        if (patch.HasStartsOn)
            existing.StartsOn = patch.StartsOn;
        if (patch.HasEndsOn)
            existing.EndsOn = patch.EndsOn;
        if (patch.HasCapacityPoints)
            existing.CapacityPoints = patch.CapacityPoints;

        var movedCount = 0;
        var leftCount = 0;

        if (patch.HasStatus && !string.Equals(patch.Status, existing.Status, StringComparison.Ordinal))
        {
            if (string.IsNullOrWhiteSpace(patch.Status))
            {
                throw new TammaError(
                    "TRACKER.MISSING_FIELD",
                    "Body field 'status' cannot be empty or null.",
                    new Dictionary<string, object?> { ["field"] = "status" },
                    retryable: false,
                    severity: TammaErrorSeverity.Low);
            }
            ValidateStatus(patch.Status);

            var from = existing.Status;
            var to = patch.Status;

            // AC2: ONLY planned -> active and active -> closed are permitted.
            var allowed = (from == StatusPlanned && to == StatusActive)
                || (from == StatusActive && to == StatusClosed);
            if (!allowed)
            {
                throw new TammaError(
                    "ITERATION_INVALID_TRANSITION",
                    $"Cannot transition iteration '{existing.Name}' from '{from}' to '{to}'. "
                    + "Allowed lifecycle transitions are planned → active → closed only.",
                    new Dictionary<string, object?>
                    {
                        ["iterationId"] = id,
                        ["from"] = from,
                        ["to"] = to,
                    },
                    retryable: false,
                    severity: TammaErrorSeverity.Medium);
            }

            if (to == StatusActive)
            {
                var incumbent = await db.Iterations
                    .FirstOrDefaultAsync(i => i.ProjectId == existing.ProjectId
                        && i.Status == StatusActive
                        && i.Id != id);
                if (incumbent is not null)
                    throw AlreadyActive(existing.ProjectId, incumbent);
            }
            else if (to == StatusClosed)
            {
                // AC4 / D2: carry-over runs atomically in the same transaction;
                // terminal items (derived via WorkItemStatus.IsTerminal()) NEVER move.
                var mode = string.IsNullOrWhiteSpace(patch.CarryOverMode)
                    ? CarryOverToBacklog
                    : patch.CarryOverMode;

                switch (mode)
                {
                    case CarryOverToBacklog:
                        movedCount = await db.Database.ExecuteSqlRawAsync(
                            """
                            UPDATE work_items
                            SET "IterationId" = NULL,
                                "UpdatedAt" = now(),
                                "Version" = "Version" + 1
                            WHERE "IterationId" = @iterationId
                              AND NOT ("Status" = ANY(@terminalStatuses))
                            """,
                            new NpgsqlParameter("iterationId", id),
                            new NpgsqlParameter("terminalStatuses", NpgsqlDbType.Array | NpgsqlDbType.Text)
                            {
                                Value = s_terminalStatuses,
                            });
                        break;

                    case CarryOverMoveTo:
                        if (patch.CarryOverTargetIterationId is not Guid targetId
                            || targetId == Guid.Empty
                            || targetId == id)
                        {
                            throw new TammaError(
                                "ITERATION_INVALID_CARRYOVER_TARGET",
                                "carryOver mode 'move-to' requires a distinct target iteration id in the same project.",
                                new Dictionary<string, object?> { ["iterationId"] = id },
                                retryable: false,
                                severity: TammaErrorSeverity.Low);
                        }
                        var target = await db.Iterations.FirstOrDefaultAsync(i => i.Id == targetId)
                            ?? throw new TammaError(
                                "ITERATION_INVALID_CARRYOVER_TARGET",
                                $"Carry-over target iteration '{targetId}' does not exist.",
                                new Dictionary<string, object?> { ["targetIterationId"] = targetId },
                                retryable: false,
                                severity: TammaErrorSeverity.Medium);

                        if (target.ProjectId != existing.ProjectId)
                        {
                            throw new TammaError(
                                "ITERATION_INVALID_CARRYOVER_TARGET",
                                $"Carry-over target iteration '{target.Name}' belongs to a different project.",
                                new Dictionary<string, object?>
                                {
                                    ["iterationId"] = id,
                                    ["targetIterationId"] = targetId,
                                },
                                retryable: false,
                                severity: TammaErrorSeverity.Medium);
                        }
                        if (target.Status is not (StatusPlanned or StatusActive))
                        {
                            throw new TammaError(
                                "ITERATION_INVALID_CARRYOVER_TARGET",
                                $"Carry-over target iteration '{target.Name}' has status '{target.Status}'; "
                                + "only a 'planned' or 'active' iteration may receive carried-over work.",
                                new Dictionary<string, object?>
                                {
                                    ["iterationId"] = id,
                                    ["targetIterationId"] = targetId,
                                    ["targetStatus"] = target.Status,
                                },
                                retryable: false,
                                severity: TammaErrorSeverity.Medium);
                        }

                        movedCount = await db.Database.ExecuteSqlRawAsync(
                            """
                            UPDATE work_items
                            SET "IterationId" = @targetId,
                                "UpdatedAt" = now(),
                                "Version" = "Version" + 1
                            WHERE "IterationId" = @iterationId
                              AND NOT ("Status" = ANY(@terminalStatuses))
                            """,
                            new NpgsqlParameter("targetId", targetId),
                            new NpgsqlParameter("iterationId", id),
                            new NpgsqlParameter("terminalStatuses", NpgsqlDbType.Array | NpgsqlDbType.Text)
                            {
                                Value = s_terminalStatuses,
                            });
                        break;

                    case CarryOverLeave:
                        movedCount = 0;
                        break;

                    default:
                        throw new TammaError(
                            "TRACKER.INVALID_CARRYOVER_MODE",
                            $"Unknown carryOver mode '{mode}'. Valid modes: {CarryOverToBacklog}, {CarryOverMoveTo}, {CarryOverLeave}.",
                            new Dictionary<string, object?> { ["carryOver"] = mode },
                            retryable: false,
                            severity: TammaErrorSeverity.Low);
                }

                leftCount = await db.WorkItems.CountAsync(w => w.IterationId == id);
            }

            existing.Status = to;
        }

        existing.UpdatedAt = DateTime.UtcNow;
        existing.Version += 1;
        PinExpectedVersion(db, existing, expectedVersion);
        await SaveGuardingVersionAsync(db, existing.Id, existing.ProjectId, existing.Name);

        var result = new IterationTransitionResult(existing, movedCount, leftCount, previousStatus);
        if (beforeCommit is not null)
            await beforeCommit(db, result);

        await tx.CommitAsync();
        return result;
    }

    public async Task<bool> DeleteAsync(Guid id, int? expectedVersion = null)
    {
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);
        var row = await db.Iterations.FirstOrDefaultAsync(i => i.Id == id);
        if (row is null)
            return false;

        if (expectedVersion is int expected && row.Version != expected)
            throw VersionConflict(id, expected, row.Version);

        db.Iterations.Remove(row);
        PinExpectedVersion(db, row, expectedVersion);
        // work_items.IterationId is FK SET NULL — items outlive sprints.
        await SaveGuardingVersionAsync(db, id, row.ProjectId, row.Name);
        return true;
    }

    public async Task<IterationSummaryData?> GetSummaryAsync(Guid id)
    {
        var tid = RequireTenantId();
        await using var db = await tenantDbFactory.CreateAsync(tid);

        // ONE single SQL statement (AC8): returns the iteration metadata, its
        // project's scale-free EstimateScale, and per-status counts + estimate sums.
        const string sql = """
            SELECT
                i."Id", i."ProjectId", i."Name", i."StartsOn", i."EndsOn",
                i."Status", i."CapacityPoints", i."CreatedAt", i."UpdatedAt", i."Version",
                p."EstimateScale",
                s."ItemStatus",
                COALESCE(s."ItemCount", 0)::int AS "ItemCount",
                COALESCE(s."EstimateSum", 0)::numeric AS "EstimateSum"
            FROM iterations i
            JOIN projects p ON p."Id" = i."ProjectId"
            LEFT JOIN (
                SELECT
                    w."Status" AS "ItemStatus",
                    COUNT(*)::int AS "ItemCount",
                    COALESCE(SUM(w."Estimate"), 0)::numeric AS "EstimateSum"
                FROM work_items w
                WHERE w."IterationId" = @iterationId
                GROUP BY w."Status"
            ) s ON TRUE
            WHERE i."Id" = @iterationId
            """;

        var rows = await db.Database
            .SqlQueryRaw<IterationSummarySqlRow>(sql, new NpgsqlParameter("iterationId", id))
            .ToListAsync();

        if (rows.Count == 0)
            return null;

        var first = rows[0];
        var iteration = new IterationEntity
        {
            Id = first.Id,
            ProjectId = first.ProjectId,
            Name = first.Name,
            StartsOn = first.StartsOn,
            EndsOn = first.EndsOn,
            Status = first.Status,
            CapacityPoints = first.CapacityPoints,
            CreatedAt = DateTime.SpecifyKind(first.CreatedAt, DateTimeKind.Utc),
            UpdatedAt = DateTime.SpecifyKind(first.UpdatedAt, DateTimeKind.Utc),
            Version = first.Version,
        };

        var buckets = rows
            .Where(r => r.ItemStatus is not null)
            .Select(r => new IterationStatusBucket(r.ItemStatus!, r.ItemCount, r.EstimateSum))
            .ToList();

        return new IterationSummaryData(iteration, first.EstimateScale, buckets);
    }

    private static void PinExpectedVersion(TenantDbContext db, IterationEntity row, int? expectedVersion)
    {
        if (expectedVersion is int expected)
            db.Entry(row).Property(i => i.Version).OriginalValue = expected;
    }

    private async Task SaveGuardingVersionAsync(
        TenantDbContext db, Guid iterationId, Guid projectId, string name)
    {
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException ex)
        {
            throw new TammaError(
                "TRACKER.CONCURRENCY_CONFLICT",
                $"Iteration '{iterationId}' was modified by another writer while this update was in flight.",
                new Dictionary<string, object?>
                {
                    ["iterationId"] = iterationId,
                    ["conflictEntries"] = ex.Entries.Count,
                },
                retryable: true,
                severity: TammaErrorSeverity.Medium);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex, "ix_iterations_one_active"))
        {
            var incumbent = await db.Iterations
                .AsNoTracking()
                .FirstOrDefaultAsync(i => i.ProjectId == projectId && i.Status == StatusActive);
            throw AlreadyActive(projectId, incumbent);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex, "UX_iterations_project_name"))
        {
            throw NameConflict(projectId, name);
        }
    }

    private static bool IsUniqueViolation(DbUpdateException ex, string constraintName) =>
        ex.InnerException is PostgresException pg
        && pg.SqlState == "23505"
        && string.Equals(pg.ConstraintName, constraintName, StringComparison.Ordinal);

    private static TammaError AlreadyActive(Guid projectId, IterationEntity? incumbent) => new(
        "ITERATION_ALREADY_ACTIVE",
        incumbent is not null
            ? $"Project '{projectId}' already has an active iteration: '{incumbent.Name}' ({incumbent.Id}). "
              + "Close it before activating another (ITERATION_ALREADY_ACTIVE)."
            : $"Project '{projectId}' already has an active iteration (ITERATION_ALREADY_ACTIVE).",
        new Dictionary<string, object?>
        {
            ["projectId"] = projectId,
            ["incumbentId"] = incumbent?.Id,
            ["incumbentName"] = incumbent?.Name,
        },
        retryable: false,
        severity: TammaErrorSeverity.Medium);

    private static TammaError NameConflict(Guid projectId, string name) => new(
        "TRACKER.ITERATION_NAME_CONFLICT",
        $"An iteration named '{name}' already exists in project '{projectId}'.",
        new Dictionary<string, object?> { ["projectId"] = projectId, ["name"] = name },
        retryable: false,
        severity: TammaErrorSeverity.Medium);

    private static TammaError VersionConflict(Guid id, int expected, int actual) => new(
        "TRACKER.CONCURRENCY_CONFLICT",
        $"Iteration '{id}' is at version {actual}, but If-Match asked for {expected}. "
        + "Another writer changed it; re-read the resource and retry against its current state.",
        new Dictionary<string, object?>
        {
            ["id"] = id,
            ["expectedVersion"] = expected,
            ["actualVersion"] = actual,
        },
        retryable: true,
        severity: TammaErrorSeverity.Medium);

    private static void ValidateStatus(string status)
    {
        if (!s_statuses.Contains(status, StringComparer.Ordinal))
        {
            throw new TammaError(
                "TRACKER.UNKNOWN_ITERATION_STATUS",
                $"Unknown iteration status: '{status}'. Valid statuses: planned, active, closed.",
                new Dictionary<string, object?> { ["input"] = status },
                retryable: false,
                severity: TammaErrorSeverity.High);
        }
    }

    private sealed class IterationSummarySqlRow
    {
        public Guid Id { get; set; }
        public Guid ProjectId { get; set; }
        public string Name { get; set; } = "";
        public DateOnly? StartsOn { get; set; }
        public DateOnly? EndsOn { get; set; }
        public string Status { get; set; } = "";
        public decimal? CapacityPoints { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public int Version { get; set; }
        public string EstimateScale { get; set; } = "";
        public string? ItemStatus { get; set; }
        public int ItemCount { get; set; }
        public decimal EstimateSum { get; set; }
    }
}
