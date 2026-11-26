// NOTE: This type lives in the Tamma.Core assembly but intentionally keeps the
// `Tamma.Api.Services.Secrets` namespace. It was moved here (Story 42-1 §0, D1)
// so Tamma.Activities (ToolDescriptor / SecretRequirement) can reference Epic 29's
// canonical SecretPurpose taxonomy without a dependency cycle through Tamma.Api.
// The namespace is preserved following the Tamma.Core/Agents/{AgentRole,AgentAction,
// RolePhaseMap,EnumWire}.cs precedent to avoid churning every caller's `using`.
namespace Tamma.Api.Services.Secrets;

/// <summary>
/// Typed purpose for a secret. Drives default rotation cadence,
/// admin-UI iconography, and the <c>SecretMetadataFactory</c>
/// invariants enforced by Story 29-1 AC10 (e.g. a
/// <see cref="DbCredential"/> with <c>SecretScope.Tenant</c>
/// scope must carry a non-null <c>TenantId</c>).
///
/// <para>The list intentionally matches the audit findings closed by
/// Epic 29 — DB credentials, API keys, signing keys, HMAC shared
/// secrets, webhook secrets, raw connection strings, and a
/// catch-all <see cref="Other"/> bucket for tenant- or platform-defined
/// purposes that don't fit the canonical taxonomy.</para>
/// </summary>
public enum SecretPurpose
{
    /// <summary>
    /// Database role password (Postgres role, Mongo user, etc.).
    /// Rotation handler: Story 29-7 (Postgres role-password rotation).
    /// </summary>
    DbCredential,

    /// <summary>
    /// External API key (Cranl API, OpenAI key, GitHub App credentials).
    /// Rotation handler: Story 29-8 (Cranl env-var rotation) for the
    /// Cranl flavour; provider-specific handlers attach as Epic 29 grows.
    /// </summary>
    ApiKey,

    /// <summary>
    /// Asymmetric or symmetric signing key (JWT signing, GitHub App
    /// installation key, Elsa workflow signing). Rotation triggers a
    /// re-issue of dependent tokens.
    /// </summary>
    SigningKey,

    /// <summary>
    /// HMAC shared secret used to authenticate inter-service calls
    /// (e.g. <c>TAMMA_SHARED_SECRET</c>). Rotation requires a coordinated
    /// flip on producer + consumer.
    /// </summary>
    HmacSharedSecret,

    /// <summary>
    /// Webhook signing / verification secret (GitHub webhook secret,
    /// GitLab webhook token). Rotation pushes the new value to the
    /// platform's webhook config.
    /// </summary>
    Webhook,

    /// <summary>
    /// Raw connection string (the Cranl-issued tenant DATABASE_URL,
    /// the central <c>ConnectionStrings:TammaAppDb</c>). Rotation
    /// usually couples with a <see cref="DbCredential"/> rotation.
    /// </summary>
    Connection,

    /// <summary>
    /// Catch-all for purposes that do not match the canonical taxonomy.
    /// The admin UI renders these with a generic icon and disables the
    /// "auto-rotate" toggle by default.
    /// </summary>
    Other
}
