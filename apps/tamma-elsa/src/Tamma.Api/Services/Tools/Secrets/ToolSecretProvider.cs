using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Platforms;
using Tamma.Api.Services.Secrets;
using Tamma.Api.Services.Secrets.Stopgap;
using Tamma.Core;
using Tamma.Platforms.Abstractions;

namespace Tamma.Api.Services.Tools.Secrets;

/// <summary>
/// Machine-readable <see cref="TammaError.Code"/> constants produced by
/// <see cref="IToolSecretProvider"/> implementations (Story 42-4).
/// </summary>
public static class ToolSecretErrorCodes
{
    /// <summary>
    /// The required secret does not exist, has no active version, was scrubbed, or the
    /// secret provider / cabinet is unavailable. Fail-closed (<c>retryable: false</c>,
    /// <c>severity: High</c>).
    /// </summary>
    public const string Unavailable = "TOOL.SECRET_UNAVAILABLE";

    /// <summary>
    /// A tool config or argument attempted to reference a tenant or scope other than the
    /// active run's tenant identity. Rejected BEFORE any secret-store read (AC1(c)).
    /// </summary>
    public const string CrossTenantDenied = "TOOL.SECRET_CROSS_TENANT_DENIED";

    /// <summary>
    /// The supplied <see cref="SecretRequirement"/> carried an empty/whitespace name.
    /// </summary>
    public const string InvalidRequirement = "TOOL.SECRET_INVALID_REQUIREMENT";
}

/// <summary>
/// Story 42-4 (D4) — process-shared short-TTL cache backing <see cref="ToolSecretProvider"/>.
///
/// <para><b>Deliberate, bounded exception to never-hold (D4):</b> this cache holds plaintext
/// <see cref="ToolCredential"/> instances keyed by <c>(tenantId, purpose, name)</c> for
/// <see cref="RuntimeSecretResolver.DefaultCacheTtl"/> (60 seconds) so every tool call in a
/// busy agent loop does not incur a Postgres round trip + envelope decryption. The cached
/// values are strictly bounded to this private field, never handed outward except through
/// <see cref="IToolSecretProvider.ResolveAsync"/>, and explicitly evictable via
/// <see cref="Invalidate"/>.</para>
/// </summary>
public sealed class ToolSecretCache
{
    private readonly ConcurrentDictionary<(Guid? TenantId, SecretPurpose Purpose, string Name), CacheEntry> _entries = new();

    internal bool TryGet(
        Guid? tenantId,
        SecretPurpose purpose,
        string name,
        DateTimeOffset now,
        out ToolCredential credential)
    {
        if (_entries.TryGetValue((tenantId, purpose, name), out var entry) && entry.ExpiresAt > now)
        {
            credential = entry.Credential;
            return true;
        }

        credential = default!;
        return false;
    }

    internal void Set(
        Guid? tenantId,
        SecretPurpose purpose,
        string name,
        ToolCredential credential,
        DateTimeOffset expiresAt)
    {
        _entries[(tenantId, purpose, name)] = new CacheEntry(credential, expiresAt);
    }

    /// <summary>
    /// Evict all cached entries for <c>(tenantId, name)</c> across every <see cref="SecretPurpose"/>.
    /// </summary>
    public void Invalidate(Guid? tenantId, string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return;
        }

        var trimmed = name.Trim();
        foreach (var key in _entries.Keys)
        {
            if (key.TenantId == tenantId && string.Equals(key.Name, trimmed, StringComparison.Ordinal))
            {
                _entries.TryRemove(key, out _);
            }
        }
    }

    /// <summary>Number of currently cached entries (for observability / lifetime tests).</summary>
    internal int Count => _entries.Count;

    private readonly record struct CacheEntry(ToolCredential Credential, DateTimeOffset ExpiresAt);
}

/// <summary>
/// Story 42-4 — production <see cref="IToolSecretProvider"/> generalizing the shipped
/// <c>DefaultProviderCredentialResolver</c> + <c>SecretStorePlatformCredentialReader</c>
/// runtime-reveal seam for arbitrary tool <see cref="SecretRequirement"/>s.
///
/// <para>Guarantees:</para>
/// <list type="bullet">
///   <item><description><b>Per-mode ref construction (D2):</b> builds
///     <c>SecretRef.ForPlatform(name)</c> when <c>runTenantId == null</c> (single-user) and
///     <c>SecretRef.ForTenant(runTenantId, name)</c> when <c>runTenantId != null</c> (SaaS).
///     Never accepts a caller-built <c>SecretRef</c>.</description></item>
///   <item><description><b>Cross-tenant rejection before any read (AC1(c) / D5):</b> rejects
///     mismatched <c>RequestedTenantId</c> or scope-spoofing name prefixes (<c>tenant:</c>,
///     <c>platform:</c>) BEFORE invoking the reader, auditing the denial to both DCB and
///     <see cref="ISecretAccessAuditor"/>.</description></item>
///   <item><description><b>Uniform 60 s cache + Invalidate (D4):</b> caches both platform and
///     tenant legs for <see cref="DefaultCacheTtl"/> (<see cref="RuntimeSecretResolver.DefaultCacheTtl"/>).</description></item>
///   <item><description><b>Fail-closed (D3 / AC3):</b> missing/inactive/scrubbed secret throws
///     <see cref="TammaError"/> with code <see cref="ToolSecretErrorCodes.Unavailable"/>.</description></item>
///   <item><description><b>Audited on every exit (D5 / D7 / AC5):</b> every resolve attempt
///     (including cache hits and argument rejections) emits exactly one
///     <c>TOOL.SECRET_ACCESSED</c> DCB row (swallow-and-warn) and one
///     <see cref="ISecretAccessAuditor.EmitAsync"/> call.</description></item>
/// </list>
/// </summary>
public sealed class ToolSecretProvider : IToolSecretProvider
{
    /// <summary>Default cache TTL — 60 s, reused from <see cref="RuntimeSecretResolver.DefaultCacheTtl"/> (D4).</summary>
    public static readonly TimeSpan DefaultCacheTtl = RuntimeSecretResolver.DefaultCacheTtl;

    private readonly IPlatformCredentialReader _reader;
    private readonly IToolSecretNameResolver _nameResolver;
    private readonly IToolSecretAuditEmitter _auditEmitter;
    private readonly ISecretAccessAuditor _secretAccessAuditor;
    private readonly ILogger<ToolSecretProvider> _logger;
    private readonly TimeProvider _timeProvider;
    private readonly TimeSpan _cacheTtl;
    private readonly ToolSecretCache _cache;

    public ToolSecretProvider(
        IPlatformCredentialReader reader,
        IToolSecretNameResolver nameResolver,
        IToolSecretAuditEmitter auditEmitter,
        ISecretAccessAuditor secretAccessAuditor,
        ILogger<ToolSecretProvider> logger,
        ToolSecretCache? cache = null,
        TimeProvider? timeProvider = null,
        TimeSpan? cacheTtl = null)
    {
        _reader = reader ?? throw new ArgumentNullException(nameof(reader));
        _nameResolver = nameResolver ?? throw new ArgumentNullException(nameof(nameResolver));
        _auditEmitter = auditEmitter ?? throw new ArgumentNullException(nameof(auditEmitter));
        _secretAccessAuditor = secretAccessAuditor ?? throw new ArgumentNullException(nameof(secretAccessAuditor));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _cache = cache ?? new ToolSecretCache();
        _timeProvider = timeProvider ?? TimeProvider.System;
        _cacheTtl = cacheTtl ?? DefaultCacheTtl;
    }

    /// <inheritdoc />
    public Task<ToolCredential> ResolveAsync(
        Guid? runTenantId,
        SecretRequirement requirement,
        CancellationToken ct = default) =>
        ResolveAsync(runTenantId, requirement, context: null, ct);

    /// <inheritdoc />
    public async Task<ToolCredential> ResolveAsync(
        Guid? runTenantId,
        SecretRequirement requirement,
        ToolSecretAccessContext? context,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(requirement);

        var now = _timeProvider.GetUtcNow();

        // Guard 1: Guid.Empty is never a valid tenant identity (it is the system-actor sentinel).
        if (runTenantId == Guid.Empty)
        {
            var emptyAuditRef = SecretRef.ForPlatform("invalid-empty-tenant");
            await EmitRejectionAuditAsync(
                auditRef: emptyAuditRef,
                storageKey: $"tenant:{Guid.Empty}:{SanitizeNameForAudit(requirement.Name)}",
                purpose: requirement.Purpose,
                tenantId: null,
                context: context,
                outcome: "rejected",
                detail: "empty_tenant_id",
                now: now,
                ct: ct).ConfigureAwait(false);

            throw new ArgumentException(
                "Run tenant id must not be Guid.Empty. Pass null for single-user/platform scope or a non-empty tenant Guid for SaaS.",
                nameof(runTenantId));
        }

        var rawName = _nameResolver.ResolveName(runTenantId, requirement);
        var name = rawName?.Trim();

        // Guard 2: empty/whitespace logical name — audit rejection (D5) and fail loud.
        if (string.IsNullOrWhiteSpace(name))
        {
            var fallbackRef = BuildSafeAuditRef(runTenantId, "invalid-empty-name");
            await EmitRejectionAuditAsync(
                auditRef: fallbackRef,
                storageKey: fallbackRef.ToStorageKey(),
                purpose: requirement.Purpose,
                tenantId: runTenantId,
                context: context,
                outcome: "rejected",
                detail: "invalid_secret_name",
                now: now,
                ct: ct).ConfigureAwait(false);

            throw new TammaError(
                ToolSecretErrorCodes.InvalidRequirement,
                "Tool secret requirement name must be a non-empty slug.",
                new Dictionary<string, object?>
                {
                    ["tenantId"] = runTenantId,
                    ["purpose"] = requirement.Purpose.ToString(),
                },
                retryable: false,
                severity: TammaErrorSeverity.High);
        }

        // Guard 3: cross-tenant check BEFORE any store read (AC1(c) / D2 / D5).
        // (a) Explicit RequestedTenantId in tool config/args must strictly match runTenantId.
        if (context?.RequestedTenantId is Guid requestedTid)
        {
            var isMismatch = runTenantId is null || requestedTid != runTenantId.Value;
            if (isMismatch)
            {
                var deniedRef = BuildSafeAuditRef(runTenantId, SanitizeNameForAudit(name));
                await EmitRejectionAuditAsync(
                    auditRef: deniedRef,
                    storageKey: deniedRef.ToStorageKey(),
                    purpose: requirement.Purpose,
                    tenantId: runTenantId,
                    context: context,
                    outcome: "denied",
                    detail: "cross_tenant_denied",
                    now: now,
                    ct: ct).ConfigureAwait(false);

                _logger.LogWarning(
                    "Cross-tenant tool secret request rejected before store read: runTenant={RunTenantId}, requestedTenant={RequestedTenantId}, tool={ToolName}, secretName={SecretName}.",
                    runTenantId,
                    requestedTid,
                    context.ToolName,
                    name);

                throw new TammaError(
                    ToolSecretErrorCodes.CrossTenantDenied,
                    "Tool secret request attempted to target a tenant scope that does not match the active run.",
                    new Dictionary<string, object?>
                    {
                        ["runTenantId"] = runTenantId,
                        ["requestedTenantId"] = requestedTid,
                        ["purpose"] = requirement.Purpose.ToString(),
                        ["toolName"] = context.ToolName,
                    },
                    retryable: false,
                    severity: TammaErrorSeverity.High);
            }
        }

        // (b) Logical secret name must never attempt to smuggle a raw storage key / scope prefix
        // (e.g. "tenant:<other-guid>:foo" or "platform:foo").
        if (HasSmuggledScopePrefix(name))
        {
            var deniedRef = BuildSafeAuditRef(runTenantId, "cross-tenant-smuggled-name");
            await EmitRejectionAuditAsync(
                auditRef: deniedRef,
                storageKey: deniedRef.ToStorageKey(),
                purpose: requirement.Purpose,
                tenantId: runTenantId,
                context: context,
                outcome: "denied",
                detail: "cross_tenant_ref_in_name",
                now: now,
                ct: ct).ConfigureAwait(false);

            _logger.LogWarning(
                "Tool secret name carrying explicit scope prefix rejected before store read: runTenant={RunTenantId}, tool={ToolName}.",
                runTenantId,
                context?.ToolName);

            throw new TammaError(
                ToolSecretErrorCodes.CrossTenantDenied,
                "Tool secret requirement name must be a logical slug and may not specify an explicit tenant or platform scope prefix.",
                new Dictionary<string, object?>
                {
                    ["runTenantId"] = runTenantId,
                    ["purpose"] = requirement.Purpose.ToString(),
                    ["toolName"] = context?.ToolName,
                },
                retryable: false,
                severity: TammaErrorSeverity.High);
        }

        // Per-mode SecretRef construction (D2 / AC1(a)):
        // single-user (runTenantId == null) -> SecretRef.ForPlatform(name)
        // SaaS (runTenantId != null)        -> SecretRef.ForTenant(runTenantId, name)
        var secretRef = runTenantId is Guid tid
            ? SecretRef.ForTenant(tid, name)
            : SecretRef.ForPlatform(name);
        var storageKey = secretRef.ToStorageKey();

        // Uniform 60 s cache lookup across both platform and tenant legs (D4).
        if (_cache.TryGet(runTenantId, requirement.Purpose, name, now, out var cached))
        {
            await _auditEmitter.EmitSecretAccessedAsync(
                new ToolSecretAccessAuditRecord(
                    SecretRefStorageKey: storageKey,
                    Purpose: requirement.Purpose,
                    TenantId: runTenantId,
                    ToolName: context?.ToolName,
                    CorrelationId: context?.CorrelationId,
                    Outcome: "success",
                    VersionNumber: cached.VersionNumber,
                    CacheHit: true,
                    Detail: null),
                ct).ConfigureAwait(false);

            await SafeEmitAccessAuditAsync(
                secretRef,
                cached.VersionNumber,
                SecretAuditOutcome.Success,
                detail: "cache_hit",
                now,
                ct).ConfigureAwait(false);

            return cached;
        }

        // Cache miss: read through the Epic 29 audited runtime reader.
        // SecretStorePlatformCredentialReader emits its own ISecretAccessAuditor event on
        // every store branch, so avoid double-emitting when it is the backing reader; for
        // non-auditing readers (e.g. NullPlatformCredentialReader or unit-test spies),
        // emit the auditor event here so AC5's "exactly one auditor call per fetch" holds.
        var readerEmitsAccessAudit = _reader is SecretStorePlatformCredentialReader;
        var scopeWire = secretRef.Scope == SecretScope.Platform ? "platform" : "tenant";
        string? plaintext;
        try
        {
            plaintext = await _reader
                .ReadActivePlaintextAsync(scopeWire, secretRef.TenantId, secretRef.Name, ct)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(
                ex,
                "Tool secret read failed for ref {SecretRefStorageKey} (purpose={Purpose}, tool={ToolName}).",
                storageKey,
                requirement.Purpose,
                context?.ToolName);

            await _auditEmitter.EmitSecretAccessedAsync(
                new ToolSecretAccessAuditRecord(
                    SecretRefStorageKey: storageKey,
                    Purpose: requirement.Purpose,
                    TenantId: runTenantId,
                    ToolName: context?.ToolName,
                    CorrelationId: context?.CorrelationId,
                    Outcome: "unavailable",
                    VersionNumber: null,
                    CacheHit: false,
                    Detail: "reader_error"),
                ct).ConfigureAwait(false);

            await SafeEmitAccessAuditAsync(
                secretRef,
                versionNumber: null,
                SecretAuditOutcome.Failure,
                detail: "reader_error",
                now,
                ct).ConfigureAwait(false);

            throw BuildUnavailableError(storageKey, requirement, runTenantId, context, "reader_error");
        }

        if (string.IsNullOrEmpty(plaintext))
        {
            await _auditEmitter.EmitSecretAccessedAsync(
                new ToolSecretAccessAuditRecord(
                    SecretRefStorageKey: storageKey,
                    Purpose: requirement.Purpose,
                    TenantId: runTenantId,
                    ToolName: context?.ToolName,
                    CorrelationId: context?.CorrelationId,
                    Outcome: "unavailable",
                    VersionNumber: null,
                    CacheHit: false,
                    Detail: "secret_not_found_or_inactive"),
                ct).ConfigureAwait(false);

            if (!readerEmitsAccessAudit)
            {
                await SafeEmitAccessAuditAsync(
                    secretRef,
                    versionNumber: null,
                    SecretAuditOutcome.Failure,
                    detail: "secret_not_found_or_inactive",
                    now,
                    ct).ConfigureAwait(false);
            }

            throw BuildUnavailableError(storageKey, requirement, runTenantId, context, "secret_not_found_or_inactive");
        }

        var credential = new ToolCredential(
            Plaintext: plaintext,
            SecretRefStorageKey: storageKey,
            VersionNumber: null);

        _cache.Set(runTenantId, requirement.Purpose, name, credential, now.Add(_cacheTtl));

        var tag = credential.ToTag();
        _logger.LogDebug(
            "Tool secret resolved for ref {SecretRef} (purpose={Purpose}, tool={ToolName}, version={Version}).",
            tag.SecretRef,
            requirement.Purpose,
            context?.ToolName,
            tag.Version);

        await _auditEmitter.EmitSecretAccessedAsync(
            new ToolSecretAccessAuditRecord(
                SecretRefStorageKey: tag.SecretRef,
                Purpose: requirement.Purpose,
                TenantId: runTenantId,
                ToolName: context?.ToolName,
                CorrelationId: context?.CorrelationId,
                Outcome: "success",
                VersionNumber: tag.Version,
                CacheHit: false,
                Detail: null),
            ct).ConfigureAwait(false);

        if (!readerEmitsAccessAudit)
        {
            await SafeEmitAccessAuditAsync(
                secretRef,
                tag.Version,
                SecretAuditOutcome.Success,
                detail: null,
                now,
                ct).ConfigureAwait(false);
        }

        return credential;
    }

    /// <inheritdoc />
    public void Invalidate(Guid? runTenantId, string name)
    {
        _cache.Invalidate(runTenantId, name);
        _logger.LogInformation(
            "Tool secret cache invalidated for tenant {TenantId} secret {SecretName}.",
            runTenantId,
            name);
    }

    internal static bool HasSmuggledScopePrefix(string name) =>
        name.StartsWith("tenant:", StringComparison.OrdinalIgnoreCase)
        || name.StartsWith("platform:", StringComparison.OrdinalIgnoreCase);

    internal static SecretRef BuildSafeAuditRef(Guid? runTenantId, string safeSlug) =>
        runTenantId is Guid tid && tid != Guid.Empty
            ? SecretRef.ForTenant(tid, safeSlug)
            : SecretRef.ForPlatform(safeSlug);

    internal static string SanitizeNameForAudit(string? name) =>
        string.IsNullOrWhiteSpace(name) ? "invalid-empty-name" : name.Trim();

    private async Task EmitRejectionAuditAsync(
        SecretRef auditRef,
        string storageKey,
        SecretPurpose purpose,
        Guid? tenantId,
        ToolSecretAccessContext? context,
        string outcome,
        string detail,
        DateTimeOffset now,
        CancellationToken ct)
    {
        await _auditEmitter.EmitSecretAccessedAsync(
            new ToolSecretAccessAuditRecord(
                SecretRefStorageKey: storageKey,
                Purpose: purpose,
                TenantId: tenantId,
                ToolName: context?.ToolName,
                CorrelationId: context?.CorrelationId,
                Outcome: outcome,
                VersionNumber: null,
                CacheHit: false,
                Detail: detail),
            ct).ConfigureAwait(false);

        await SafeEmitAccessAuditAsync(
            auditRef,
            versionNumber: null,
            SecretAuditOutcome.Failure,
            detail,
            now,
            ct).ConfigureAwait(false);
    }

    private async Task SafeEmitAccessAuditAsync(
        SecretRef reference,
        int? versionNumber,
        SecretAuditOutcome outcome,
        string? detail,
        DateTimeOffset now,
        CancellationToken ct)
    {
        try
        {
            await _secretAccessAuditor.EmitAsync(
                new SecretAuditEvent(
                    EventType: SecretAuditEventTypes.Read,
                    Reference: reference,
                    ActorUserId: Guid.Empty,
                    VersionNumber: versionNumber,
                    Outcome: outcome,
                    Detail: detail,
                    OccurredAt: now),
                ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "ISecretAccessAuditor emission failed for ref {SecretRefStorageKey} outcome {Outcome}.",
                reference.ToStorageKey(),
                outcome);
        }
    }

    private static TammaError BuildUnavailableError(
        string storageKey,
        SecretRequirement requirement,
        Guid? runTenantId,
        ToolSecretAccessContext? context,
        string reason) =>
        new(
            ToolSecretErrorCodes.Unavailable,
            $"Capability unconfigured: secret '{storageKey}' ({requirement.Purpose}) is unavailable ({reason}).",
            new Dictionary<string, object?>
            {
                ["secretRefStorageKey"] = storageKey,
                ["purpose"] = requirement.Purpose.ToString(),
                ["tenantId"] = runTenantId,
                ["toolName"] = context?.ToolName,
                ["required"] = requirement.Required,
                ["reason"] = reason,
            },
            retryable: false,
            severity: TammaErrorSeverity.High);
}

/// <summary>
/// Story 42-4 (Step 5 / AC6) — fail-closed null-object <see cref="IToolSecretProvider"/>
/// registered when the Epic 29 secret cabinet (<c>SecretsDbContext</c> factory) is not
/// wired into the host. Every resolve attempt audits the unavailable outcome and throws
/// <see cref="TammaError"/> with code <see cref="ToolSecretErrorCodes.Unavailable"/> —
/// never returning an empty string or silently proceeding unauthenticated.
/// </summary>
public sealed class NullToolSecretProvider : IToolSecretProvider
{
    private readonly IToolSecretAuditEmitter _auditEmitter;
    private readonly ISecretAccessAuditor _secretAccessAuditor;
    private readonly ILogger<NullToolSecretProvider> _logger;
    private readonly TimeProvider _timeProvider;

    public NullToolSecretProvider(
        IToolSecretAuditEmitter auditEmitter,
        ISecretAccessAuditor secretAccessAuditor,
        ILogger<NullToolSecretProvider> logger,
        TimeProvider? timeProvider = null)
    {
        _auditEmitter = auditEmitter ?? throw new ArgumentNullException(nameof(auditEmitter));
        _secretAccessAuditor = secretAccessAuditor ?? throw new ArgumentNullException(nameof(secretAccessAuditor));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    /// <inheritdoc />
    public Task<ToolCredential> ResolveAsync(
        Guid? runTenantId,
        SecretRequirement requirement,
        CancellationToken ct = default) =>
        ResolveAsync(runTenantId, requirement, context: null, ct);

    /// <inheritdoc />
    public async Task<ToolCredential> ResolveAsync(
        Guid? runTenantId,
        SecretRequirement requirement,
        ToolSecretAccessContext? context,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(requirement);

        var now = _timeProvider.GetUtcNow();
        var safeName = ToolSecretProvider.SanitizeNameForAudit(requirement.Name);
        var auditRef = ToolSecretProvider.BuildSafeAuditRef(runTenantId, safeName);
        var storageKey = auditRef.ToStorageKey();

        await _auditEmitter.EmitSecretAccessedAsync(
            new ToolSecretAccessAuditRecord(
                SecretRefStorageKey: storageKey,
                Purpose: requirement.Purpose,
                TenantId: runTenantId,
                ToolName: context?.ToolName,
                CorrelationId: context?.CorrelationId,
                Outcome: "unavailable",
                VersionNumber: null,
                CacheHit: false,
                Detail: "secret_provider_unavailable"),
            ct).ConfigureAwait(false);

        try
        {
            await _secretAccessAuditor.EmitAsync(
                new SecretAuditEvent(
                    EventType: SecretAuditEventTypes.Read,
                    Reference: auditRef,
                    ActorUserId: Guid.Empty,
                    VersionNumber: null,
                    Outcome: SecretAuditOutcome.Failure,
                    Detail: "secret_provider_unavailable",
                    OccurredAt: now),
                ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "ISecretAccessAuditor emission failed in NullToolSecretProvider for ref {SecretRefStorageKey}.",
                storageKey);
        }

        throw new TammaError(
            ToolSecretErrorCodes.Unavailable,
            $"Capability unconfigured: secret provider is unavailable for '{storageKey}' ({requirement.Purpose}).",
            new Dictionary<string, object?>
            {
                ["secretRefStorageKey"] = storageKey,
                ["purpose"] = requirement.Purpose.ToString(),
                ["tenantId"] = runTenantId,
                ["toolName"] = context?.ToolName,
                ["required"] = requirement.Required,
                ["reason"] = "secret_provider_unavailable",
            },
            retryable: false,
            severity: TammaErrorSeverity.High);
    }

    /// <inheritdoc />
    public void Invalidate(Guid? runTenantId, string name)
    {
        // No-op: no cabinet or cache is active.
    }
}
