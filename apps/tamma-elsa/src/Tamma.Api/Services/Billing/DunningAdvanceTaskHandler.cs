using System.Text.Json;
using Tamma.Api.Services.PlatformTasks;
using Tamma.Data.Entities;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-8 (AC5) — <see cref="IPlatformTaskHandler"/> for scheduled
/// <c>billing.dunning.advance</c> tasks enqueued by
/// <see cref="DunningStateMachine"/>. Advances the tenant's dunning stage when
/// the scheduled retry or grace period elapses.
/// </summary>
public sealed class DunningAdvanceTaskHandler : IPlatformTaskHandler
{
    public const string TaskTypeName = "billing.dunning.advance";

    private readonly IDunningStateMachine _dunning;
    private readonly ILogger<DunningAdvanceTaskHandler> _logger;

    public DunningAdvanceTaskHandler(
        IDunningStateMachine dunning,
        ILogger<DunningAdvanceTaskHandler> logger)
    {
        ArgumentNullException.ThrowIfNull(dunning);
        ArgumentNullException.ThrowIfNull(logger);

        _dunning = dunning;
        _logger = logger;
    }

    /// <inheritdoc />
    public string TaskType => TaskTypeName;

    /// <inheritdoc />
    public async Task HandleAsync(PlatformQueuedTask task, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(task);

        var tenantId = ResolveTenantId(task);
        if (tenantId == Guid.Empty)
        {
            _logger.LogWarning(
                "Skipping billing.dunning.advance task {TaskId}: no tenantId found.",
                task.Id);
            return;
        }

        await _dunning.AdvanceAsync(tenantId, ct).ConfigureAwait(false);
    }

    private static Guid ResolveTenantId(PlatformQueuedTask task)
    {
        if (task.TenantId is Guid id && id != Guid.Empty)
        {
            return id;
        }

        if (string.IsNullOrWhiteSpace(task.Payload))
        {
            return Guid.Empty;
        }

        try
        {
            using var doc = JsonDocument.Parse(task.Payload);
            if (doc.RootElement.TryGetProperty("tenantId", out var prop)
                && prop.ValueKind == JsonValueKind.String
                && Guid.TryParse(prop.GetString(), out var parsed))
            {
                return parsed;
            }
        }
        catch (JsonException)
        {
            // Malformed payload — caller logs and returns cleanly.
        }

        return Guid.Empty;
    }
}
