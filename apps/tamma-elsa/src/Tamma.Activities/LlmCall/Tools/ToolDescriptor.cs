using Tamma.Api.Services.Secrets;

namespace Tamma.Activities.LlmCall.Tools;

/// <summary>
/// Logical credential requirement declared by an <see cref="IToolExecutor"/>.
/// Story 42-4 resolves this requirement into a concrete <c>SecretRef</c> per
/// operating mode (platform-scoped in single-user; tenant-scoped in SaaS).
/// A <see cref="ToolDescriptor"/> never carries a <c>SecretRef</c> or secret plaintext.
/// </summary>
/// <param name="Purpose">Canonical Epic 29 secret purpose (relocated to Tamma.Core by Story 42-1 §0).</param>
/// <param name="Name">Logical secret name slug (not a secret value).</param>
/// <param name="Required">True when a missing or inactive secret must fail closed before execution.</param>
public sealed record SecretRequirement(
    SecretPurpose Purpose,
    string Name,
    bool Required);

/// <summary>
/// Static capability metadata declared by every <see cref="IToolExecutor"/> (Story 42-1,
/// reconciled against Epic 43 by Story 43-10).
///
/// <para>Governance metadata — risk classification (<c>Tamma.Core.Actions.ActionRisk</c>),
/// autonomy thresholds (<c>ActionDescriptor.DefaultMinAutonomy</c> and
/// <c>action_assignments.min_autonomy</c>), and enforcement (Seam B) — is owned exclusively by
/// Epic 43 (The Action Catalog), never by <see cref="ToolDescriptor"/>.</para>
/// </summary>
/// <param name="RequiredSecret">
/// Logical credential requirement for external-touching tools, or <c>null</c> for local/in-process tools.
/// </param>
/// <param name="Suspends">
/// <c>Suspends = true</c> declares that this tool's completion is owned by an engine-side wait —
/// it is not a capability the executor exercises. The tool loop runs server-side inside a blocking
/// <c>POST /api/v1/llm/call</c> in <c>Tamma.Api</c>, where there is no <c>ActivityExecutionContext</c>
/// and no bookmark to create; a suspending tool returns promptly with an <c>operationHandle</c>, and
/// the engine-side <c>WaitForToolOperationActivity</c> (credential-free, resuming on a callback or
/// durable timeout) carries the suspension (see Stories 42-7 §4 and 42-8B §5).
/// </param>
public sealed record ToolDescriptor(
    SecretRequirement? RequiredSecret,
    bool Suspends)
{
    /// <summary>
    /// Standard capability descriptor for tools that require no external secret and do not suspend.
    /// </summary>
    public static readonly ToolDescriptor Default = new(RequiredSecret: null, Suspends: false);

    /// <summary>
    /// Coalesces a <c>null</c> descriptor (for example from an unconfigured test mock) to
    /// <see cref="Default"/> (no secret requirement, does not suspend).
    /// </summary>
    public static ToolDescriptor Coalesce(ToolDescriptor? descriptor) => descriptor ?? Default;
}

/// <summary>
/// Marker interface for <see cref="IToolExecutor"/> implementations that are bound to a specific
/// principal (user or tenant) at construction (e.g. <c>GetAcceptanceRulesTool</c>, Story 39-5 D6).
///
/// <para><see cref="IToolExecutorRegistry.Register"/> rejects principal-scoped executors with
/// <see cref="PrincipalScopedToolRegistrationException"/> because the registry is a platform-wide
/// singleton; registering a principal-bound tool into it would leak that principal's state across
/// tenants/users. Per-principal tools wait for Story 42-6 Part B's per-principal registry view.</para>
/// </summary>
public interface IPrincipalScopedToolExecutor : IToolExecutor
{
}

/// <summary>
/// Thrown by <see cref="IToolExecutorRegistry.Register"/> when a caller attempts to register a
/// principal-scoped <see cref="IToolExecutor"/> into the platform-wide singleton registry
/// (Story 42-1 §3 / D5).
/// </summary>
public sealed class PrincipalScopedToolRegistrationException : InvalidOperationException
{
    public string ToolName { get; }

    public PrincipalScopedToolRegistrationException(string toolName)
        : base(
            $"Cannot register principal-scoped tool '{toolName}' into the platform-wide singleton " +
            "IToolExecutorRegistry. Dynamic registration in Story 42-1 is platform/deployment-scoped only; " +
            "principal-bound tools must be mounted via Story 42-6 Part B's per-principal registry view " +
            "(or constructed per session via a scoped factory such as GetAcceptanceRulesToolFactory).")
    {
        ToolName = toolName;
    }
}
