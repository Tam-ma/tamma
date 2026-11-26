using Tamma.Activities.LlmCall.Tools;
using Tamma.Core.Redaction;

namespace Tamma.Api.Services.Tools.Secrets;

/// <summary>
/// Story 42-4 — short-lived resolved credential for one external tool invocation.
///
/// <para><b>Never-hold rule (D8):</b> <see cref="Plaintext"/> exists solely for the
/// immediate outbound call inside <see cref="IToolExecutor.ExecuteAsync"/> and MUST
/// NEVER cross into <c>ToolExecutionResult.Output</c>, a DCB event, a log line, or an
/// exception message. Only <see cref="ToTag"/> ever crosses into diagnostics/audit/logs.</para>
/// </summary>
/// <param name="Plaintext">Plaintext secret value for one invocation. Never logged or persisted.</param>
/// <param name="SecretRefStorageKey">
/// Stable storage key from <c>SecretRef.ToStorageKey()</c> (e.g. <c>platform:cloud/token</c>
/// or <c>tenant:&lt;guid&gt;:cloud/token</c>). Safe for logs and DCB tags.
/// </param>
/// <param name="VersionNumber">Active cabinet version number if known; otherwise <c>null</c>.</param>
public sealed record ToolCredential(
    string Plaintext,
    string SecretRefStorageKey,
    int? VersionNumber)
{
    /// <summary>
    /// Tag-safe projection. NEVER carries <see cref="Plaintext"/> — this is the ONLY
    /// projection handed to logs, DCB events, or diagnostics (Story 42-4 AC2).
    /// </summary>
    public ToolCredentialTag ToTag() => new(SecretRefStorageKey, VersionNumber);

    /// <summary>
    /// Redacted string rendering so accidental interpolation or logging never exposes
    /// <see cref="Plaintext"/>.
    /// </summary>
    public override string ToString() =>
        $"ToolCredential {{ SecretRefStorageKey = {SecretRefStorageKey}, VersionNumber = {VersionNumber}, Plaintext = [REDACTED] }}";
}

/// <summary>
/// Tag-safe projection of a <see cref="ToolCredential"/> — structurally carries NO
/// plaintext member (Story 42-4 AC2).
/// </summary>
/// <param name="SecretRef">Stable <c>SecretRef.ToStorageKey()</c> value (never plaintext).</param>
/// <param name="Version">Active version number, or <c>null</c>.</param>
public sealed record ToolCredentialTag(
    string SecretRef,
    int? Version);

/// <summary>
/// Optional per-invocation audit and tenant-binding context supplied to
/// <see cref="IToolSecretProvider"/>. Never carries a <c>SecretRef</c> or plaintext.
/// </summary>
/// <param name="ToolName">Logical tool name for <c>TOOL.SECRET_ACCESSED</c> tags.</param>
/// <param name="CorrelationId">Run correlation id for <c>TOOL.SECRET_ACCESSED</c> tags.</param>
/// <param name="RequestedTenantId">
/// Optional tenant id extracted from tool configuration or tool arguments. When non-null,
/// <see cref="IToolSecretProvider"/> verifies it strictly matches <c>runTenantId</c> (and
/// rejects it in single-user mode) BEFORE any secret-store read (Story 42-4 AC1(c)).
/// </param>
public sealed record ToolSecretAccessContext(
    string? ToolName = null,
    string? CorrelationId = null,
    Guid? RequestedTenantId = null);

/// <summary>
/// Story 42-4 (D1/D2) — tool-facing secret provider sited wholly in <c>Tamma.Api</c>
/// (outside <c>Allowlist.IsEngineSurface</c>).
///
/// <para><b>Structural isolation control (D2 / AC1(d)):</b> this interface intentionally
/// exposes NO overload accepting a caller-constructed <c>SecretRef</c>. The provider
/// receives the run's tenant identity (<c>runTenantId</c>) and the descriptor's logical
/// <see cref="SecretRequirement"/> and builds the <c>SecretRef</c> itself:
/// <c>SecretRef.ForPlatform(name)</c> in single-user mode (<c>runTenantId == null</c>) and
/// <c>SecretRef.ForTenant(runTenantId, name)</c> in SaaS mode (<c>runTenantId != null</c>).
/// Because <c>ISecretStore</c> performs no caller authorization, tenant isolation is
/// owned and enforced here.</para>
/// </summary>
public interface IToolSecretProvider
{
    /// <summary>
    /// Resolve the active credential for <paramref name="requirement"/> under the scope
    /// derived from <paramref name="runTenantId"/>. Fails closed with a typed
    /// <c>TammaError</c> when missing, inactive, cross-tenant, or unavailable.
    /// </summary>
    Task<ToolCredential> ResolveAsync(
        Guid? runTenantId,
        SecretRequirement requirement,
        CancellationToken ct = default);

    /// <summary>
    /// Resolve the active credential for <paramref name="requirement"/> under the scope
    /// derived from <paramref name="runTenantId"/> with optional audit/tenant-check context.
    /// Fails closed with a typed <c>TammaError</c> when missing, inactive, cross-tenant, or
    /// unavailable.
    /// </summary>
    Task<ToolCredential> ResolveAsync(
        Guid? runTenantId,
        SecretRequirement requirement,
        ToolSecretAccessContext? context,
        CancellationToken ct = default);

    /// <summary>
    /// Evict cached entries for <c>(runTenantId, name)</c> across all secret purposes
    /// (called on rotation activation or manual revocation; Story 42-4 D4).
    /// </summary>
    void Invalidate(Guid? runTenantId, string name);
}

/// <summary>
/// Story 42-4 (G1) — seam for resolving a tool descriptor's logical secret name to a
/// cabinet slug. Ships with a single pass-through implementation (<see cref="DefaultToolSecretNameResolver"/>)
/// returning <see cref="SecretRequirement.Name"/> verbatim; gives a future per-principal
/// tool-configuration store one plug point without reintroducing Story 42-2 duplication.
/// </summary>
public interface IToolSecretNameResolver
{
    /// <summary>Resolve the logical secret name slug for the given run tenant and requirement.</summary>
    string ResolveName(Guid? runTenantId, SecretRequirement requirement);
}

/// <summary>
/// Default <see cref="IToolSecretNameResolver"/> returning <see cref="SecretRequirement.Name"/>
/// verbatim (Story 42-4 G1).
/// </summary>
public sealed class DefaultToolSecretNameResolver : IToolSecretNameResolver
{
    public string ResolveName(Guid? runTenantId, SecretRequirement requirement)
    {
        ArgumentNullException.ThrowIfNull(requirement);
        _ = runTenantId;
        return requirement.Name;
    }
}

/// <summary>
/// Story 42-4 (D8) — executor-boundary value scrubber.
///
/// <para><b>Redaction split (D8):</b> "By-value at the <c>ExecuteAsync</c> boundary;
/// never-hold + pattern after it." An executor that legitimately holds a resolved
/// <see cref="ToolCredential.Plaintext"/> for an outbound call uses this helper to scrub
/// the exact secret value (and common secret patterns) from any response body, echoed
/// header, status line, or error message BEFORE returning <c>ToolExecutionResult</c>.
/// Downstream audit emitters and logs NEVER receive plaintext and must NOT call this.</para>
/// </summary>
public static class ToolSecretValueScrubber
{
    public const string Placeholder = "[REDACTED]";

    /// <summary>
    /// Scrub exact occurrences of <paramref name="plaintext"/> (case-sensitive and
    /// URL/base64-safe literal matches) plus pattern-based secrets from <paramref name="text"/>.
    /// </summary>
    public static string Scrub(string? text, string? plaintext)
    {
        if (string.IsNullOrEmpty(text))
        {
            return text ?? string.Empty;
        }

        var scrubbed = text;
        if (!string.IsNullOrEmpty(plaintext))
        {
            scrubbed = scrubbed.Replace(plaintext, Placeholder, StringComparison.Ordinal);

            var escaped = Uri.EscapeDataString(plaintext);
            if (!string.Equals(escaped, plaintext, StringComparison.Ordinal))
            {
                scrubbed = scrubbed.Replace(escaped, Placeholder, StringComparison.Ordinal);
            }
        }

        scrubbed = ToolOutputHelper.RedactSecrets(scrubbed);
        scrubbed = CredentialRedactor.Clean(scrubbed) ?? string.Empty;
        return scrubbed;
    }
}
