using System.Text.Json;
using Microsoft.Extensions.Logging;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (AC6 / D8) — resolves, validates, persists, and audits per-principal
/// <see cref="OrchestratorAgentConfig"/> rows.
/// </summary>
public interface IOrchestratorConfigService
{
    Task<ResolvedOrchestratorConfig> ResolveForTenantAsync(Guid tenantId, CancellationToken ct = default);
    Task<ResolvedOrchestratorConfig> ResolveForUserAsync(Guid? userId, Guid? dbTenantId = null, CancellationToken ct = default);
    Task<ResolvedOrchestratorConfig> UpsertForTenantAsync(Guid tenantId, Guid? actingUserId, OrchestratorAgentConfig config, CancellationToken ct = default);
    Task<ResolvedOrchestratorConfig> UpsertForUserAsync(Guid userId, Guid? dbTenantId, OrchestratorAgentConfig config, CancellationToken ct = default);
    Task<bool> DeleteForTenantAsync(Guid tenantId, Guid? actingUserId, CancellationToken ct = default);
    Task<bool> DeleteForUserAsync(Guid userId, Guid? dbTenantId, CancellationToken ct = default);
}

public sealed class OrchestratorConfigService : IOrchestratorConfigService
{
    private readonly IOrchestratorAgentConfigRepository _repo;
    private readonly IEventRepository _events;
    private readonly ILogger<OrchestratorConfigService> _logger;

    public OrchestratorConfigService(
        IOrchestratorAgentConfigRepository repo,
        IEventRepository events,
        ILogger<OrchestratorConfigService> logger)
    {
        _repo = repo;
        _events = events;
        _logger = logger;
    }

    public async Task<ResolvedOrchestratorConfig> ResolveForTenantAsync(Guid tenantId, CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty)
            return DefaultResolved();

        var row = await _repo.GetByTenantAsync(tenantId, ct);
        return row is null ? DefaultResolved() : Materialize(row, "tenant");
    }

    public async Task<ResolvedOrchestratorConfig> ResolveForUserAsync(
        Guid? userId, Guid? dbTenantId = null, CancellationToken ct = default)
    {
        if (userId is null || userId == Guid.Empty)
            return DefaultResolved();

        var row = await _repo.GetByUserAsync(userId.Value, dbTenantId, ct);
        return row is null ? DefaultResolved() : Materialize(row, "user");
    }

    public async Task<ResolvedOrchestratorConfig> UpsertForTenantAsync(
        Guid tenantId, Guid? actingUserId, OrchestratorAgentConfig config, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(config);
        config.Validate();

        var json = JsonSerializer.Serialize(config, OrchestratorAgentDefaults.JsonOptions);
        var (saved, wasCreated) = await _repo.UpsertAsync(
            new OrchestratorAgentConfigRow
            {
                TenantId = tenantId,
                UserId = null,
                ConfigJson = json,
            },
            actingUserId,
            dbTenantId: tenantId,
            ct);

        await EmitConfigEventBestEffortAsync(
            OrchestratorEvents.ConfigUpdated, tenantId, actingUserId, saved.Version, wasCreated, config);

        return Materialize(saved, "tenant");
    }

    public async Task<ResolvedOrchestratorConfig> UpsertForUserAsync(
        Guid userId, Guid? dbTenantId, OrchestratorAgentConfig config, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(config);
        config.Validate();

        var json = JsonSerializer.Serialize(config, OrchestratorAgentDefaults.JsonOptions);
        var (saved, wasCreated) = await _repo.UpsertAsync(
            new OrchestratorAgentConfigRow
            {
                UserId = userId,
                TenantId = null,
                ConfigJson = json,
            },
            actingUserId: userId,
            dbTenantId: dbTenantId,
            ct);

        await EmitConfigEventBestEffortAsync(
            OrchestratorEvents.ConfigUpdated, dbTenantId, userId, saved.Version, wasCreated, config);

        return Materialize(saved, "user");
    }

    public async Task<bool> DeleteForTenantAsync(Guid tenantId, Guid? actingUserId, CancellationToken ct = default)
    {
        var deleted = await _repo.DeleteByTenantAsync(tenantId, ct);
        if (deleted)
        {
            await EmitConfigEventBestEffortAsync(
                OrchestratorEvents.ConfigDeleted, tenantId, actingUserId, version: 0, wasCreated: false, config: null);
        }
        return deleted;
    }

    public async Task<bool> DeleteForUserAsync(Guid userId, Guid? dbTenantId, CancellationToken ct = default)
    {
        var deleted = await _repo.DeleteByUserAsync(userId, dbTenantId, ct);
        if (deleted)
        {
            await EmitConfigEventBestEffortAsync(
                OrchestratorEvents.ConfigDeleted, dbTenantId, userId, version: 0, wasCreated: false, config: null);
        }
        return deleted;
    }

    private static ResolvedOrchestratorConfig DefaultResolved() => new(
        OrchestratorAgentDefaults.Config,
        "system-default",
        1,
        DateTimeOffset.UtcNow);

    private static ResolvedOrchestratorConfig Materialize(OrchestratorAgentConfigRow row, string source)
    {
        var parsed = JsonSerializer.Deserialize<OrchestratorAgentConfig>(row.ConfigJson, OrchestratorAgentDefaults.JsonOptions)
            ?? throw new JsonException("Stored orchestrator config JSON deserialized to null.");
        parsed.Validate();
        return new ResolvedOrchestratorConfig(
            parsed,
            source,
            row.Version,
            new DateTimeOffset(DateTime.SpecifyKind(row.UpdatedAt, DateTimeKind.Utc)));
    }

    private async Task EmitConfigEventBestEffortAsync(
        string eventType,
        Guid? tenantId,
        Guid? actingUserId,
        int version,
        bool wasCreated,
        OrchestratorAgentConfig? config)
    {
        try
        {
            var tags = new Dictionary<string, object?>();
            if (tenantId is { } tid && tid != Guid.Empty) tags["tenantId"] = tid.ToString("D");
            if (actingUserId is { } uid && uid != Guid.Empty) tags["userId"] = uid.ToString("D");

            var data = new Dictionary<string, object?>
            {
                ["version"] = version,
                ["wasCreated"] = wasCreated,
                ["provider"] = config?.Provider,
                ["model"] = config?.Model,
                ["maxUsdPerDay"] = config?.MaxUsdPerDay,
                ["maxSessionTokens"] = config?.MaxSessionTokens,
            };

            await _events.AppendAsync(new DomainEvent
            {
                Type = eventType,
                TenantId = tenantId,
                Tags = JsonSerializer.Serialize(tags),
                Metadata = """{"workflowVersion":"1.0.0","eventSource":"orchestrator-config"}""",
                Data = JsonSerializer.Serialize(data),
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Best-effort {EventType} audit emission failed", eventType);
        }
    }
}
