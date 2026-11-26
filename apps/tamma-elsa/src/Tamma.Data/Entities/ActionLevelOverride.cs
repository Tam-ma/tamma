namespace Tamma.Data.Entities;

/// <summary>
/// Story 43-18 (AC1) — platform-scope override of a catalogued action's
/// shipped zone level (<c>ActionDescriptor.DefaultMinAutonomy</c>).
///
/// <para><b>Control-plane resident, platform-global, deliberately EXCLUDED from
/// the destructive startup DROP list:</b> identical survival pattern to
/// <see cref="ActionAssignment"/> and <see cref="ActionAuthorization"/>
/// (Story 43-5 AC5/D3). An operator who moved <c>effect:deploy.prod</c> or
/// <c>tool:file_write</c> to a different zone level must not see that decision
/// silently wiped on the next restart. Consequences: NO FK to <c>tenants</c>
/// or <c>users</c>, and an <c>IF NOT EXISTS</c>-idempotent migration.</para>
///
/// <para><b>Deliberately NO numeric DB CHECK on <see cref="Level"/></b>
/// (Story 43-18 AC1, mirroring Story 43-5 AC3/D5): a numeric CHECK frozen into
/// a migration would hardcode the <c>AutonomyDial</c> bound and detent step in
/// two places. Domain validation lives in
/// <c>ActionLevelOverrideValidator</c>.</para>
/// </summary>
public class ActionLevelOverride
{
    public Guid Id { get; set; }

    /// <summary>Catalogued <c>ActionKey</c> wire string (e.g.
    /// <c>"tool:file_write"</c>, <c>"effect:deploy.staging"</c>). Unique across
    /// the table (<c>ux_action_level_overrides_action_key</c>).</summary>
    public string ActionKey { get; set; } = null!;

    /// <summary>Effective shipped zone level overriding
    /// <c>ActionDescriptor.DefaultMinAutonomy</c> (a valid detent in
    /// <c>[5, 100]</c> step 5, or <c>AutonomyDial.AlwaysHuman</c> = 101).
    /// NO numeric DB CHECK — validated domain-side.</summary>
    public int Level { get; set; }

    /// <summary>Optional operator-authored note explaining why the shipped
    /// level was overridden.</summary>
    public string? Note { get; set; }

    /// <summary>Monotonic per-row version bumped on every upsert.</summary>
    public int Version { get; set; }

    public Guid? CreatedBy { get; set; }
    public Guid? UpdatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
