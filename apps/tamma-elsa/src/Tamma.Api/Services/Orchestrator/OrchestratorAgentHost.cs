using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (Step 8 / D1) — configuration options for <see cref="OrchestratorAgentHost"/>.
/// <see cref="Enabled"/> ships <c>false</c> by default (matching
/// <c>PlatformTaskWorker.RunOnStartup</c> and <c>TenantScheduledTriggerService</c>)
/// so partial or unconfigured deployments never start autonomous orchestrator loops unexpectedly.
/// </summary>
public sealed class OrchestratorHostOptions
{
    public const string SectionName = "OrchestratorAgent";

    /// <summary>Opt-in master switch. Default <c>false</c>.</summary>
    public bool Enabled { get; set; } = false;

    /// <summary>Interval in seconds between idle-eviction sweeps. Default 60s.</summary>
    public int IdleSweepIntervalSeconds { get; set; } = 60;
}

/// <summary>
/// Story 39-17 (AC1 / D1 / Step 8) — hosted background service inside
/// <c>Tamma.Api</c> that manages per-tenant <see cref="OrchestratorAgentInstance"/>
/// lifecycle: starts tenant instances on demand from <see cref="IOrchestratorInbox"/>
/// activity, idles with zero token burn, and periodically evicts idle instances.
/// </summary>
public sealed class OrchestratorAgentHost : BackgroundService
{
    private readonly IOrchestratorAgentRegistry _registry;
    private readonly IOrchestratorInbox _inbox;
    private readonly OrchestratorHostOptions _options;
    private readonly ILogger<OrchestratorAgentHost> _logger;

    public OrchestratorAgentHost(
        IOrchestratorAgentRegistry registry,
        IOrchestratorInbox inbox,
        IOptions<OrchestratorHostOptions> options,
        ILogger<OrchestratorAgentHost> logger)
    {
        _registry = registry ?? throw new ArgumentNullException(nameof(registry));
        _inbox = inbox ?? throw new ArgumentNullException(nameof(inbox));
        _options = options?.Value ?? new OrchestratorHostOptions();
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            _logger.LogInformation(
                "OrchestratorAgentHost is disabled (OrchestratorAgent:Enabled=false); per-tenant orchestrator loops will not start automatically.");
            return;
        }

        _logger.LogInformation("OrchestratorAgentHost starting (per-tenant on-demand orchestration enabled).");

        // Bootstrap any tenants that already have pending unacked items in the inbox.
        try
        {
            var pendingTenants = await _inbox.GetTenantsWithPendingItemsAsync(stoppingToken).ConfigureAwait(false);
            foreach (var tenantId in pendingTenants)
            {
                await _registry.GetOrStartAsync(tenantId, ownerUserId: null, stoppingToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            return;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "OrchestratorAgentHost failed to bootstrap pending tenants; will still watch live activity.");
        }

        var sweepTask = RunIdleSweepLoopAsync(stoppingToken);
        var watchTask = WatchInboxActivityAsync(stoppingToken);

        await Task.WhenAll(sweepTask, watchTask).ConfigureAwait(false);
    }

    private async Task WatchInboxActivityAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var tenantId in _inbox.WatchTenantActivityAsync(ct).ConfigureAwait(false))
            {
                try
                {
                    await _registry.GetOrStartAsync(tenantId, ownerUserId: null, ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to start orchestrator instance for tenant {TenantId}", tenantId);
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Normal host shutdown.
        }
    }

    private async Task RunIdleSweepLoopAsync(CancellationToken ct)
    {
        var interval = TimeSpan.FromSeconds(Math.Max(5, _options.IdleSweepIntervalSeconds));
        using var timer = new PeriodicTimer(interval);
        try
        {
            while (await timer.WaitForNextTickAsync(ct).ConfigureAwait(false))
            {
                try
                {
                    var evicted = await _registry.EvictIdleAsync(ct: ct).ConfigureAwait(false);
                    if (evicted > 0)
                        _logger.LogInformation("OrchestratorAgentHost evicted {Count} idle tenant instance(s).", evicted);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "OrchestratorAgentHost idle sweep tick failed.");
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Normal host shutdown.
        }
    }
}
