using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Tamma.Api.Services.AcceptanceRules;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Diagnostics;
using Tamma.Api.Services.Documents;
using Tamma.Api.Services.Orchestrator.Tools;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;
using Tamma.Platforms.Abstractions;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (AC1 / AC6 / D13) — per-tenant orchestrator agent registry.
/// Guarantees one <see cref="OrchestratorAgentInstance"/> per tenant id (never a
/// shared instance multiplexing tenants), manages start-on-demand, idle eviction,
/// and clean shutdown.
/// </summary>
public interface IOrchestratorAgentRegistry
{
    Task<OrchestratorAgentInstance> GetOrStartAsync(Guid tenantId, Guid? ownerUserId = null, CancellationToken ct = default);
    Task<bool> EvictAsync(Guid tenantId, string reason, CancellationToken ct = default);
    IReadOnlyList<Guid> ListRunning();
    bool TryGet(Guid tenantId, out OrchestratorAgentInstance? instance);
    Task<int> EvictIdleAsync(TimeSpan? overrideIdleThreshold = null, CancellationToken ct = default);
}

public sealed class OrchestratorAgentRegistry : IOrchestratorAgentRegistry, IAsyncDisposable
{
    private sealed class RunningEntry : IAsyncDisposable
    {
        public required OrchestratorAgentInstance Instance { get; init; }
        public required AsyncServiceScope Scope { get; init; }
        public required CancellationTokenSource LoopCts { get; init; }
        public required Task LoopTask { get; init; }

        public async ValueTask DisposeAsync()
        {
            await LoopCts.CancelAsync().ConfigureAwait(false);
            try { await LoopTask.ConfigureAwait(false); }
            catch (OperationCanceledException) { }
            catch { /* logged by loop */ }
            LoopCts.Dispose();
            await Scope.DisposeAsync().ConfigureAwait(false);
        }
    }

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IOrchestratorInbox _inbox;
    private readonly IOrchestratorTurnRunner? _turnRunnerOverride;
    private readonly TimeProvider _timeProvider;
    private readonly ILoggerFactory _loggerFactory;
    private readonly ILogger<OrchestratorAgentRegistry> _logger;
    private readonly ConcurrentDictionary<Guid, RunningEntry> _entries = new();
    private readonly SemaphoreSlim _lifecycleLock = new(1, 1);

    [ActivatorUtilitiesConstructor]
    public OrchestratorAgentRegistry(
        IServiceScopeFactory scopeFactory,
        IOrchestratorInbox inbox,
        ILoggerFactory loggerFactory,
        TimeProvider? timeProvider = null)
        : this(scopeFactory, inbox, loggerFactory, turnRunnerOverride: null, timeProvider)
    {
    }

    internal OrchestratorAgentRegistry(
        IServiceScopeFactory scopeFactory,
        IOrchestratorInbox inbox,
        ILoggerFactory loggerFactory,
        IOrchestratorTurnRunner? turnRunnerOverride,
        TimeProvider? timeProvider = null)
    {
        _scopeFactory = scopeFactory ?? throw new ArgumentNullException(nameof(scopeFactory));
        _inbox = inbox ?? throw new ArgumentNullException(nameof(inbox));
        _loggerFactory = loggerFactory ?? throw new ArgumentNullException(nameof(loggerFactory));
        _logger = loggerFactory.CreateLogger<OrchestratorAgentRegistry>();
        _turnRunnerOverride = turnRunnerOverride;
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public async Task<OrchestratorAgentInstance> GetOrStartAsync(
        Guid tenantId,
        Guid? ownerUserId = null,
        CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("TenantId is required.", nameof(tenantId));

        if (_entries.TryGetValue(tenantId, out var existing))
            return existing.Instance;

        await _lifecycleLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (_entries.TryGetValue(tenantId, out existing))
                return existing.Instance;

            var scope = _scopeFactory.CreateAsyncScope();
            var sp = scope.ServiceProvider;
            sp.GetService<Tamma.Data.ITenantContext>()?.SetTenantId(tenantId);

            var events = sp.GetRequiredService<IEventRepository>();
            var elsa = sp.GetRequiredService<IElsaWorkflowService>();
            var docs = sp.GetRequiredService<IDocumentInstanceRepository>();
            var platforms = sp.GetRequiredService<IPlatformResolver>();
            var rulesToolFactory = sp.GetRequiredService<GetAcceptanceRulesToolFactory>();
            var configService = sp.GetRequiredService<IOrchestratorConfigService>();
            var taskAssignment = sp.GetRequiredService<ITaskAssignmentService>();
            var turnRunner = _turnRunnerOverride ?? sp.GetRequiredService<IOrchestratorTurnRunner>();
            var diagnostics = sp.GetService<IDiagnosticsService>();
            var audience = sp.GetService<ITaskAudienceResolver>();
            var repoAccess = sp.GetService<IRepoAccessEvaluator>();

            var toolDeps = new OrchestratorToolDependencies(
                events,
                elsa,
                docs,
                platforms,
                rulesToolFactory,
                diagnostics,
                audience,
                repoAccess,
                _loggerFactory.CreateLogger("Tamma.Api.OrchestratorTools"));

            var instance = new OrchestratorAgentInstance(
                tenantId,
                ownerUserId,
                _inbox,
                turnRunner,
                configService,
                toolDeps,
                new DocumentDecisionSubmissionService(elsa),
                new EscalationDispositionService(events, _loggerFactory.CreateLogger<EscalationDispositionService>()),
                taskAssignment,
                events,
                _loggerFactory.CreateLogger<OrchestratorAgentInstance>(),
                _timeProvider);

            await instance.StartOrRehydrateAsync(ct).ConfigureAwait(false);

            var loopCts = new CancellationTokenSource();
            var loopTask = Task.Run(async () =>
            {
                try
                {
                    await instance.RunAsync(loopCts.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) { }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Orchestrator agent loop terminated unexpectedly for tenant {TenantId}", tenantId);
                }
            }, CancellationToken.None);

            var entry = new RunningEntry
            {
                Instance = instance,
                Scope = scope,
                LoopCts = loopCts,
                LoopTask = loopTask,
            };

            _entries[tenantId] = entry;
            return instance;
        }
        finally
        {
            _lifecycleLock.Release();
        }
    }

    public async Task<bool> EvictAsync(Guid tenantId, string reason, CancellationToken ct = default)
    {
        if (!_entries.TryRemove(tenantId, out var entry))
            return false;

        try
        {
            var events = entry.Scope.ServiceProvider.GetService<IEventRepository>();
            if (events is not null)
            {
                await events.AppendAsync(new DomainEvent
                {
                    Type = OrchestratorEvents.SessionEvicted,
                    TenantId = tenantId,
                    Tags = JsonSerializer.Serialize(new Dictionary<string, object?> { ["tenantId"] = tenantId.ToString("D") }),
                    Metadata = """{"workflowVersion":"1.0.0","eventSource":"orchestrator-agent"}""",
                    Data = JsonSerializer.Serialize(new Dictionary<string, object?> { ["reason"] = reason }),
                }).ConfigureAwait(false);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Best-effort SESSION.EVICTED emission failed for tenant {TenantId}", tenantId);
        }

        await entry.DisposeAsync().ConfigureAwait(false);
        return true;
    }

    public IReadOnlyList<Guid> ListRunning() => _entries.Keys.ToList();

    public bool TryGet(Guid tenantId, out OrchestratorAgentInstance? instance)
    {
        if (_entries.TryGetValue(tenantId, out var entry))
        {
            instance = entry.Instance;
            return true;
        }
        instance = null;
        return false;
    }

    public async Task<int> EvictIdleAsync(TimeSpan? overrideIdleThreshold = null, CancellationToken ct = default)
    {
        var now = _timeProvider.GetUtcNow();
        var evicted = 0;

        foreach (var kv in _entries.ToArray())
        {
            var threshold = overrideIdleThreshold
                ?? TimeSpan.FromMinutes(OrchestratorAgentDefaults.DefaultIdleEvictAfterMinutes);

            if (now - kv.Value.Instance.LastActivityUtc >= threshold)
            {
                if (await EvictAsync(kv.Key, "idle-timeout", ct).ConfigureAwait(false))
                    evicted++;
            }
        }

        return evicted;
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var tid in _entries.Keys.ToArray())
        {
            if (_entries.TryRemove(tid, out var entry))
                await entry.DisposeAsync().ConfigureAwait(false);
        }
        _lifecycleLock.Dispose();
    }
}
