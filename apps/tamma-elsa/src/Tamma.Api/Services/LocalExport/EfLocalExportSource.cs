using System.Data;
using System.Reflection;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;

namespace Tamma.Api.Services.LocalExport;

internal sealed class EfLocalExportSource(
    IConfiguration configuration,
    IDbContextFactory<ControlPlaneDbContext> controlPlaneFactory,
    ITenantDbContextFactory tenantFactory) : ILocalExportSource
{
    private static readonly string[] UserFields =
        ["Id", "Email", "DisplayName", "AvatarUrl", "GitHubId", "GitHubLogin", "Settings", "CreatedAt", "UpdatedAt"];
    private static readonly string[] TenantFields =
        ["Id", "Name", "Slug", "Type", "OwnerId", "Settings", "CreatedAt", "UpdatedAt"];
    private static readonly string[] EventFields =
        ["Id", "SequenceNumber", "Type", "TenantId", "IssueNumber", "Tags", "Metadata", "Data", "CreatedAt"];
    private static readonly string[] DocumentFields =
        ["Id", "DocumentType", "IssueId", "ProducedByRole", "ProducedByAction", "ProducedByWorkflow", "SchemaVersion", "CorrelationId", "Revision", "Status", "SupersedesDocumentId", "ParentDocumentId", "CorrelatingEventId", "TenantId", "Audience", "BodyJson", "CreatedAt", "UpdatedAt"];
    private static readonly string[] ConventionFields =
        ["Id", "TenantId", "Role", "Action", "Body", "Version", "Enabled", "CreatedAt", "UpdatedAt", "CreatedBy", "UpdatedBy"];
    private static readonly string[] BudgetFields =
        ["Id", "TenantId", "AccountId", "LimitUsd", "AlertThreshold", "PeriodDays", "CreatedAt", "UpdatedAt"];
    private static readonly string[] PromptFields =
        ["Id", "UserId", "TenantId", "Scope", "Role", "Action", "Template", "SystemPrompt", "Variables", "EnableTools", "MaxTokens", "Version", "CreatedBy", "UpdatedBy", "CreatedAt", "UpdatedAt"];
    private static readonly string[] AcceptanceFields =
        ["Id", "UserId", "TenantId", "DocumentTypeKey", "RulesJson", "Version", "CreatedBy", "UpdatedBy", "CreatedAt", "UpdatedAt"];
    private static readonly string[] AgentConfigFields =
        ["Id", "TenantId", "Config", "Version", "CreatedAt", "UpdatedAt", "CreatedBy", "UpdatedBy"];
    private static readonly string[] OrchestratorFields =
        ["Id", "UserId", "TenantId", "ConfigJson", "Version", "CreatedBy", "UpdatedBy", "CreatedAt", "UpdatedAt"];
    private static readonly string[] WorkflowDefinitionFields =
        ["Id", "Name", "Description", "Version", "Steps", "TenantId", "SyncedAt", "CreatedAt", "UpdatedAt"];
    private static readonly string[] WorkflowInstanceFields =
        ["Id", "DefinitionId", "TenantId", "Status", "CurrentActivity", "Variables", "Result", "CreatedAt", "UpdatedAt", "StartedAt", "CompletedAt"];
    private static readonly string[] ActionAssignmentFields =
        ["Id", "TenantId", "UserId", "TargetKind", "TargetKey", "MinAutonomy", "Enforce", "Enabled", "AllowedRoles", "Note", "Version", "CreatedBy", "UpdatedBy", "CreatedAt", "UpdatedAt"];
    private static readonly string[] ActionAuthorizationFields =
        ["Id", "TenantId", "UserId", "CorrelationId", "TargetKind", "TargetKey", "State", "RequestedAtUtc", "DecidedAtUtc", "DecidedByUserId", "ExpiresAtUtc", "ConsumedAtUtc", "Scope", "Reason", "AutonomyLevelAtRequest"];
    private static readonly string[] ProviderSettingFields =
        ["Id", "TenantId", "UserId", "Scope", "ProviderKey", "DefaultModel", "Enabled", "UpdatedAt", "UpdatedBy"];
    private static readonly string[] RoleSelectionFields =
        ["Id", "TenantId", "UserId", "Role", "AgentId", "Visibility", "CreatedAt", "UpdatedAt", "UpdatedBy"];
    private static readonly string[] AgentRunWaitFields =
        ["Id", "TenantId", "UserId", "Repository", "BranchName", "SessionId", "InstallationId", "WorkflowInstanceId", "BookmarkName", "BookmarkTenantId", "WorkflowFile", "Status", "WorkflowRunId", "DispatchedAt", "ReceivedAt", "CreatedAt", "UpdatedAt"];
    private static readonly string[] EnablementFields =
        ["Id", "TenantId", "UserId", "AgentId", "Enabled", "CreatedAt", "CreatedBy", "UpdatedAt", "UpdatedBy"];
    private static readonly string[] AgentFields =
        ["Id", "Name", "Role", "Visibility", "OwnerTenantId", "OwnerUserId", "Status", "CurrentVersionId", "CreatedAt", "CreatedBy", "UpdatedAt", "UpdatedBy"];
    private static readonly string[] AgentVersionFields =
        ["Id", "AgentId", "Version", "ConfigJson", "Notes", "CreatedAt", "CreatedBy"];

    private static readonly HashSet<string> JsonFields = new(StringComparer.Ordinal)
    {
        "Settings", "Tags", "Metadata", "Data", "BodyJson", "RulesJson", "Config",
        "ConfigJson", "Steps", "Variables", "Result",
    };

    public async Task<LocalExportCapture> CaptureAsync(CancellationToken cancellationToken)
    {
        await using var cp = await controlPlaneFactory.CreateDbContextAsync(cancellationToken).ConfigureAwait(false);
        await using var cpTransaction = await cp.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken).ConfigureAwait(false);
        await cp.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", cancellationToken).ConfigureAwait(false);
        await ValidateSchemaAsync(cp, cancellationToken).ConfigureAwait(false);

        var (user, tenant) = await ResolveOwnerAsync(cp, configuration, cancellationToken).ConfigureAwait(false);
        await using var tenantDb = await tenantFactory.CreateAsync(tenant.Id, cancellationToken).ConfigureAwait(false);
        await using var tenantTransaction = await tenantDb.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken).ConfigureAwait(false);
        await tenantDb.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", cancellationToken).ConfigureAwait(false);
        await ValidateSchemaAsync(tenantDb, cancellationToken).ConfigureAwait(false);

        var cpPid = await BackendPidAsync(cp, cancellationToken).ConfigureAwait(false);
        var tenantPid = await BackendPidAsync(tenantDb, cancellationToken).ConfigureAwait(false);
        await AssertQuiescedAsync(cp, [cpPid, tenantPid], cancellationToken).ConfigureAwait(false);
        await AssertQuiescedAsync(tenantDb, [cpPid, tenantPid], cancellationToken).ConfigureAwait(false);

        var datasets = new List<LocalExportDataset>();
        datasets.AddRange(await CaptureControlPlaneAsync(cp, user.Id, tenant.Id, cancellationToken).ConfigureAwait(false));
        datasets.AddRange(await CaptureTenantAsync(tenantDb, user.Id, tenant.Id, cancellationToken).ConfigureAwait(false));
        ValidateRelationships(datasets);
        var watermark = await ReadWatermarkAsync(cp, tenantDb, user.Id, tenant.Id, cancellationToken).ConfigureAwait(false);

        await cpTransaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        await tenantTransaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        await VerifyStableCaptureAsync(user.Id, tenant.Id, watermark, cancellationToken).ConfigureAwait(false);

        return new LocalExportCapture(
            SourceRevision(),
            await AppliedMigrationsAsync(cp, cancellationToken).ConfigureAwait(false),
            await AppliedMigrationsAsync(tenantDb, cancellationToken).ConfigureAwait(false),
            watermark,
            Project(user, UserFields),
            Project(tenant, TenantFields),
            datasets);
    }

    internal static async Task<(User User, Tenant Tenant)> ResolveOwnerAsync(
        ControlPlaneDbContext cp,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var configured = configuration[Tamma.Api.Services.Actions.SoleUserProvider.OwnerUserIdConfigKey];
        IQueryable<User> candidates = cp.Users.AsNoTracking().Where(u => u.IsActive && u.DeletedAt == null);
        if (!string.IsNullOrWhiteSpace(configured))
        {
            if (!Guid.TryParse(configured, out var configuredId))
            {
                throw new LocalExportException("EXPORT.OWNER.INVALID", "Configured local owner id is invalid.");
            }
            candidates = candidates.Where(u => u.Id == configuredId);
        }

        var users = await candidates.OrderBy(u => u.Id).Take(2).ToListAsync(cancellationToken).ConfigureAwait(false);
        if (users.Count != 1)
        {
            throw new LocalExportException("EXPORT.OWNER.AMBIGUOUS", "Export requires exactly one verified local user.");
        }

        var user = users[0];
        var tenants = await cp.Tenants.AsNoTracking()
            .Where(t => t.OwnerId == user.Id && t.Type == "personal" && t.DeletedAt == null)
            .OrderBy(t => t.Id)
            .Take(2)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        if (tenants.Count != 1)
        {
            throw new LocalExportException("EXPORT.TENANT.AMBIGUOUS", "Export requires exactly one owned personal tenant.");
        }

        var tenant = tenants[0];
        var ownerMemberships = await cp.TenantMemberships.AsNoTracking()
            .CountAsync(m => m.TenantId == tenant.Id && m.UserId == user.Id && m.Role == "owner", cancellationToken)
            .ConfigureAwait(false);
        if (ownerMemberships != 1 || (user.TenantId.HasValue && user.TenantId.Value != tenant.Id))
        {
            throw new LocalExportException("EXPORT.OWNERSHIP.INVALID", "Local user ownership and active tenant do not agree.");
        }

        return (user, tenant);
    }

    private static async Task<IReadOnlyList<LocalExportDataset>> CaptureControlPlaneAsync(
        ControlPlaneDbContext cp,
        Guid userId,
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        var assignments = await cp.ActionAssignments.AsNoTracking()
            .Where(x => x.UserId == userId || x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var authorizations = await cp.ActionAuthorizations.AsNoTracking()
            .Where(x => x.UserId == userId || x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var providers = await cp.ProviderSettings.AsNoTracking()
            .Where(x => x.UserId == userId || x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var roleSelections = await cp.AgentRoleSelections.AsNoTracking()
            .Where(x => x.UserId == userId || x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var waits = await cp.AgentRunWaits.AsNoTracking()
            .Where(x => x.UserId == userId || x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var enablements = await cp.TenantAgentEnablements.AsNoTracking()
            .Where(x => x.UserId == userId || x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var installations = await cp.TenantPlatformInstallations.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.DeletedAt == null)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var agents = await cp.Agents.AsNoTracking()
            .Where(x => x.OwnerUserId == userId || x.OwnerTenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var agentIds = agents.Select(a => a.Id).ToArray();
        var versions = await cp.AgentVersions.AsNoTracking()
            .Where(x => agentIds.Contains(x.AgentId))
            .OrderBy(x => x.AgentId).ThenBy(x => x.Version)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        return
        [
            Dataset("control_plane.action_assignments", assignments, ActionAssignmentFields),
            Dataset("control_plane.action_authorizations", authorizations, ActionAuthorizationFields),
            Dataset("control_plane.provider_settings", providers, ProviderSettingFields),
            Dataset("control_plane.agent_role_selections", roleSelections, RoleSelectionFields),
            Dataset("control_plane.agent_run_waits", waits, AgentRunWaitFields),
            Dataset("control_plane.tenant_agent_enablements", enablements, EnablementFields),
            Dataset("control_plane.tenant_platform_installations", installations.Select(ProjectInstallation).ToArray()),
            Dataset("control_plane.agents", agents, AgentFields),
            Dataset("control_plane.agent_versions", versions, AgentVersionFields),
        ];
    }

    private static async Task<IReadOnlyList<LocalExportDataset>> CaptureTenantAsync(
        TenantDbContext db,
        Guid userId,
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        var events = await db.DomainEvents.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .OrderBy(x => x.SequenceNumber).ToListAsync(cancellationToken).ConfigureAwait(false);
        var documents = await db.Documents.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .OrderBy(x => x.IssueId).ThenBy(x => x.DocumentType).ThenBy(x => x.Revision).ThenBy(x => x.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var conventions = await db.Conventions.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var budgets = await db.BudgetConfigs.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var prompts = await db.PromptOverrides.AsNoTracking()
            .Where(x => x.UserId == userId || x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var acceptance = await db.AcceptanceRulesOverrides.AsNoTracking()
            .Where(x => x.UserId == userId || x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var agentConfigs = await db.AgentConfigs.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var orchestrators = await db.OrchestratorAgentConfigs.AsNoTracking()
            .Where(x => x.UserId == userId || x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var definitions = await db.WorkflowDefinitions.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);
        var instances = await db.WorkflowInstances.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .OrderBy(x => x.Id).ToListAsync(cancellationToken).ConfigureAwait(false);

        return
        [
            Dataset("tenant.domain_events", events, EventFields),
            Dataset("tenant.documents", documents, DocumentFields),
            Dataset("tenant.conventions", conventions, ConventionFields),
            Dataset("tenant.budget_configs", budgets, BudgetFields),
            Dataset("tenant.prompt_overrides", prompts, PromptFields),
            Dataset("tenant.acceptance_rules_overrides", acceptance, AcceptanceFields),
            Dataset("tenant.agent_configs", agentConfigs, AgentConfigFields),
            Dataset("tenant.orchestrator_agent_configs", orchestrators, OrchestratorFields),
            Dataset("tenant.workflow_definitions", definitions, WorkflowDefinitionFields),
            Dataset("tenant.workflow_instances", instances, WorkflowInstanceFields),
        ];
    }

    private async Task VerifyStableCaptureAsync(
        Guid userId,
        Guid tenantId,
        string expectedWatermark,
        CancellationToken cancellationToken)
    {
        await using var cp = await controlPlaneFactory.CreateDbContextAsync(cancellationToken).ConfigureAwait(false);
        await using var tenantDb = await tenantFactory.CreateAsync(tenantId, cancellationToken).ConfigureAwait(false);
        var cpPid = await BackendPidAsync(cp, cancellationToken).ConfigureAwait(false);
        var tenantPid = await BackendPidAsync(tenantDb, cancellationToken).ConfigureAwait(false);
        await AssertQuiescedAsync(cp, [cpPid, tenantPid], cancellationToken).ConfigureAwait(false);
        await AssertQuiescedAsync(tenantDb, [cpPid, tenantPid], cancellationToken).ConfigureAwait(false);
        var (user, tenant) = await ResolveOwnerAsync(cp, configuration, cancellationToken).ConfigureAwait(false);
        var actual = await ReadWatermarkAsync(cp, tenantDb, user.Id, tenant.Id, cancellationToken).ConfigureAwait(false);
        if (user.Id != userId || tenant.Id != tenantId || actual != expectedWatermark)
        {
            throw new LocalExportException("EXPORT.SOURCE.CHANGED", "Source state changed or was not quiesced during export.");
        }
    }

    private static async Task<string> ReadWatermarkAsync(
        ControlPlaneDbContext cp,
        TenantDbContext tenantDb,
        Guid userId,
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        var eventWatermark = await tenantDb.DomainEvents.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .MaxAsync(x => (long?)x.SequenceNumber, cancellationToken).ConfigureAwait(false) ?? 0;
        var documentWatermark = await tenantDb.Documents.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .MaxAsync(x => (DateTime?)x.UpdatedAt, cancellationToken).ConfigureAwait(false);
        var workflowWatermark = await tenantDb.WorkflowInstances.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .MaxAsync(x => (DateTime?)x.UpdatedAt, cancellationToken).ConfigureAwait(false);
        var assignmentWatermark = await cp.ActionAssignments.AsNoTracking()
            .Where(x => x.UserId == userId || x.TenantId == tenantId)
            .MaxAsync(x => (DateTime?)x.UpdatedAt, cancellationToken).ConfigureAwait(false);
        var providerWatermark = await cp.ProviderSettings.AsNoTracking()
            .Where(x => x.UserId == userId || x.TenantId == tenantId)
            .MaxAsync(x => (DateTime?)x.UpdatedAt, cancellationToken).ConfigureAwait(false);
        return string.Join(';',
            $"events={eventWatermark}",
            $"documents={Ticks(documentWatermark)}",
            $"workflows={Ticks(workflowWatermark)}",
            $"assignments={Ticks(assignmentWatermark)}",
            $"providers={Ticks(providerWatermark)}");
    }

    private static string Ticks(DateTime? value) =>
        value.HasValue ? value.Value.ToUniversalTime().Ticks.ToString() : "0";

    private static async Task ValidateSchemaAsync(DbContext db, CancellationToken cancellationToken)
    {
        var expected = db.Database.GetMigrations().Order(StringComparer.Ordinal).ToArray();
        var applied = (await AppliedMigrationsAsync(db, cancellationToken).ConfigureAwait(false))
            .Order(StringComparer.Ordinal).ToArray();
        if (expected.Length == 0 || !expected.SequenceEqual(applied, StringComparer.Ordinal))
        {
            throw new LocalExportException("EXPORT.SCHEMA.MISMATCH", "Source schema migrations do not match this exporter.");
        }
    }

    private static async Task<IReadOnlyList<string>> AppliedMigrationsAsync(
        DbContext db,
        CancellationToken cancellationToken) =>
        (await db.Database.GetAppliedMigrationsAsync(cancellationToken).ConfigureAwait(false))
        .Order(StringComparer.Ordinal).ToArray();

    private static async Task<int> BackendPidAsync(DbContext db, CancellationToken cancellationToken) =>
        await db.Database.SqlQuery<int>($"SELECT pg_backend_pid() AS \"Value\"")
            .SingleAsync(cancellationToken).ConfigureAwait(false);

    private static async Task AssertQuiescedAsync(
        DbContext db,
        IReadOnlyList<int> exporterPids,
        CancellationToken cancellationToken)
    {
        var pids = await db.Database.SqlQuery<int>(
                $"SELECT pid AS \"Value\" FROM pg_stat_activity WHERE datname = current_database()")
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        if (pids.Any(pid => !exporterPids.Contains(pid)))
        {
            throw new LocalExportException("EXPORT.SOURCE.NOT_QUIESCED", "Stop all Tamma writers and database sessions before exporting.");
        }
    }

    private static void ValidateRelationships(IReadOnlyList<LocalExportDataset> datasets)
    {
        var byName = datasets.ToDictionary(d => d.Name, StringComparer.Ordinal);
        var eventIds = byName["tenant.domain_events"].Rows.Select(r => r.Id).ToHashSet(StringComparer.Ordinal);
        var documentIds = byName["tenant.documents"].Rows.Select(r => r.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var document in byName["tenant.documents"].Rows.Select(r => r.Payload))
        {
            ValidateOptionalReference(document, "supersedesDocumentId", documentIds);
            ValidateOptionalReference(document, "parentDocumentId", documentIds);
            ValidateOptionalReference(document, "correlatingEventId", eventIds);
        }

        var definitionIds = byName["tenant.workflow_definitions"].Rows.Select(r => r.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var instance in byName["tenant.workflow_instances"].Rows.Select(r => r.Payload))
        {
            var definitionId = instance["definitionId"]?.GetValue<string>();
            if (definitionId is null || !definitionIds.Contains(definitionId))
            {
                throw new LocalExportException("EXPORT.RELATIONSHIP.INVALID", "Workflow lineage references a missing definition.");
            }
        }
    }

    private static void ValidateOptionalReference(JsonObject row, string field, HashSet<string> validIds)
    {
        var value = row[field]?.GetValue<string>();
        if (value is not null && !validIds.Contains(value))
        {
            throw new LocalExportException("EXPORT.RELATIONSHIP.INVALID", "Document lineage references a missing record.");
        }
    }

    private static LocalExportDataset Dataset<T>(
        string name,
        IReadOnlyList<T> rows,
        IReadOnlyList<string> fields) where T : class =>
        new(name, rows.Select((row, index) =>
        {
            var payload = Project(row, fields);
            return new LocalExportRow(payload["id"]!.GetValue<string>(), index, payload);
        }).ToArray());

    private static LocalExportDataset Dataset(string name, IReadOnlyList<JsonObject> rows) =>
        new(name, rows.Select((payload, index) =>
            new LocalExportRow(payload["id"]!.GetValue<string>(), index, payload)).ToArray());

    private static JsonObject Project<T>(T row, IReadOnlyList<string> fields) where T : class
    {
        var result = new JsonObject();
        foreach (var field in fields)
        {
            var property = typeof(T).GetProperty(field, BindingFlags.Public | BindingFlags.Instance)
                ?? throw new LocalExportException("EXPORT.PROJECTION.INVALID", "Export field inventory is invalid.");
            var value = property.GetValue(row);
            result[CamelCase(field)] = ToNode(value, field);
        }
        return result;
    }

    private static JsonNode? ToNode(object? value, string field)
    {
        if (value is null) return null;
        if (value is string text)
        {
            return JsonFields.Contains(field)
                ? LocalExportSecretScrubber.ScrubJson(text, field)
                : JsonValue.Create(LocalExportSecretScrubber.ScrubText(text));
        }
        if (value is DateTime dateTime)
        {
            return JsonValue.Create(dateTime.ToUniversalTime().ToString("O"));
        }
        if (value is Enum)
        {
            return JsonValue.Create(value.ToString());
        }
        return System.Text.Json.JsonSerializer.SerializeToNode(value, value.GetType());
    }

    private static JsonObject ProjectInstallation(TenantPlatformInstallation row)
    {
        var result = new JsonObject
        {
            ["id"] = row.Id.ToString(),
            ["tenantId"] = row.TenantId.ToString(),
            ["platformKind"] = LocalExportSecretScrubber.ScrubText(row.PlatformKind),
            ["baseUrl"] = LocalExportSecretScrubber.ScrubText(row.BaseUrl),
            ["installationExternalId"] = row.InstallationExternalId,
            ["status"] = row.Status,
            ["isPrimary"] = row.IsPrimary,
            ["metadataJson"] = LocalExportSecretScrubber.ScrubJson(row.MetadataJson, "MetadataJson"),
            ["createdAt"] = row.CreatedAt.ToUniversalTime().ToString("O"),
            ["updatedAt"] = row.UpdatedAt.ToUniversalTime().ToString("O"),
            ["credential"] = ReauthorizationMarker("git-platform"),
            ["webhookCredential"] = row.WebhookSecretName is null ? null : ReauthorizationMarker("webhook"),
        };
        return result;
    }

    private static JsonObject ReauthorizationMarker(string kind) => new()
    {
        ["$tamma"] = "reauthorize",
        ["kind"] = kind,
    };

    private static string CamelCase(string value) =>
        char.ToLowerInvariant(value[0]) + value[1..];

    private static string SourceRevision()
    {
        var configured = Environment.GetEnvironmentVariable("TAMMA_SOURCE_REVISION");
        if (!string.IsNullOrWhiteSpace(configured)) return configured.Trim();
        return Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion ?? "unknown";
    }
}
