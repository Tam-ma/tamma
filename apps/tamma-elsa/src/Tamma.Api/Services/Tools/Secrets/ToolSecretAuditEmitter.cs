using System.Text.Json;
using Microsoft.Extensions.Logging;
using Tamma.Api.Services.Secrets;
using Tamma.Core.Redaction;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Tools.Secrets;

/// <summary>
/// Canonical DCB event types emitted by Story 42-4's tool secret-binding seam.
/// </summary>
public static class ToolSecretEventTypes
{
    /// <summary>
    /// Emitted on every <see cref="IToolSecretProvider.ResolveAsync"/> outcome — success,
    /// cache hit, missing/unavailable secret, and argument/cross-tenant rejection (Story 42-4 D5).
    /// Carries <c>secretRefStorageKey</c>, <c>purpose</c>, <c>tenantId</c>, <c>toolName</c>,
    /// <c>correlationId</c> tags and <c>outcome</c>/<c>versionNumber</c>/<c>cacheHit</c> data —
    /// NEVER a secret value.
    /// </summary>
    public const string SecretAccessed = "TOOL.SECRET_ACCESSED";
}

/// <summary>
/// Tag-safe audit payload for <see cref="ToolSecretEventTypes.SecretAccessed"/>.
/// Structurally carries NO plaintext member (Story 42-4 AC4 / D8 never-hold guarantee).
/// </summary>
/// <param name="SecretRefStorageKey">Stable <c>SecretRef.ToStorageKey()</c> identifier.</param>
/// <param name="Purpose">Canonical Epic 29 secret purpose.</param>
/// <param name="TenantId">Owning run tenant id, or <c>null</c> in single-user/platform mode.</param>
/// <param name="ToolName">Optional invoking tool name.</param>
/// <param name="CorrelationId">Optional run correlation id.</param>
/// <param name="Outcome">Coarse machine-readable outcome (<c>success</c>, <c>unavailable</c>, <c>denied</c>, <c>rejected</c>).</param>
/// <param name="VersionNumber">Active cabinet version number if known.</param>
/// <param name="CacheHit">Whether the resolve was served from the 60s in-process cache.</param>
/// <param name="Detail">Optional machine-readable reason code (never plaintext).</param>
public sealed record ToolSecretAccessAuditRecord(
    string SecretRefStorageKey,
    SecretPurpose Purpose,
    Guid? TenantId,
    string? ToolName,
    string? CorrelationId,
    string Outcome,
    int? VersionNumber,
    bool CacheHit,
    string? Detail = null);

/// <summary>
/// Story 42-4 (D5/D7) — DCB audit emitter for tool secret fetches and rejections.
/// Accepts ONLY <see cref="ToolSecretAccessAuditRecord"/> (never a <see cref="ToolCredential"/>
/// or plaintext string).
/// </summary>
public interface IToolSecretAuditEmitter
{
    /// <summary>
    /// Append one <see cref="ToolSecretEventTypes.SecretAccessed"/> DCB event.
    /// Never throws — append failures are swallowed and logged at WARN (Story 42-4 D7).
    /// </summary>
    Task EmitSecretAccessedAsync(
        ToolSecretAccessAuditRecord record,
        CancellationToken ct = default);
}

/// <summary>
/// Default <see cref="IToolSecretAuditEmitter"/> appending directly via
/// <see cref="IEventRepository.AppendAsync"/> with swallow-and-warn failure posture
/// (Story 42-4 D7; mirrors <c>AlertEventEmitter</c>).
/// </summary>
public sealed class ToolSecretAuditEmitter : IToolSecretAuditEmitter
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = false,
    };

    private readonly IEventRepository _events;
    private readonly ILogger<ToolSecretAuditEmitter> _logger;
    private readonly TimeProvider _timeProvider;

    public ToolSecretAuditEmitter(
        IEventRepository events,
        ILogger<ToolSecretAuditEmitter> logger,
        TimeProvider? timeProvider = null)
    {
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    /// <inheritdoc />
    public async Task EmitSecretAccessedAsync(
        ToolSecretAccessAuditRecord record,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(record);

        try
        {
            var safeStorageKey = CredentialRedactor.Clean(record.SecretRefStorageKey) ?? string.Empty;
            var safeToolName = CredentialRedactor.Clean(record.ToolName);
            var safeCorrelationId = CredentialRedactor.Clean(record.CorrelationId);
            var safeOutcome = CredentialRedactor.Clean(record.Outcome) ?? "unknown";
            var safeDetail = CredentialRedactor.Clean(record.Detail);

            var tags = new Dictionary<string, string?>
            {
                ["secretRefStorageKey"] = safeStorageKey,
                ["purpose"] = record.Purpose.ToString(),
                ["tenantId"] = record.TenantId?.ToString(),
                ["toolName"] = safeToolName,
                ["correlationId"] = safeCorrelationId,
            };

            var data = new Dictionary<string, object?>
            {
                ["outcome"] = safeOutcome,
                ["versionNumber"] = record.VersionNumber,
                ["cacheHit"] = record.CacheHit,
                ["detail"] = safeDetail,
            };

            await _events.AppendAsync(new DomainEvent
            {
                Id = Guid.NewGuid(),
                Type = ToolSecretEventTypes.SecretAccessed,
                TenantId = record.TenantId,
                Tags = JsonSerializer.Serialize(tags, JsonOpts),
                Metadata = """{"eventSource":"system","workflowVersion":"1.0.0"}""",
                Data = JsonSerializer.Serialize(data, JsonOpts),
                CreatedAt = _timeProvider.GetUtcNow().UtcDateTime,
            }).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Story 42-4 D7: swallow-and-warn so an event-store hiccup never fails a tool
            // invocation whose credential fetch has already completed.
            _logger.LogWarning(
                ex,
                "TOOL.SECRET_ACCESSED DCB emission failed for ref {SecretRefStorageKey} tenant {TenantId} outcome {Outcome}.",
                record.SecretRefStorageKey,
                record.TenantId,
                record.Outcome);
        }

        _ = ct; // IEventRepository.AppendAsync does not accept a CancellationToken (AlertEventEmitter.cs:88).
    }
}
