namespace Tamma.Data.Entities;

/// <summary>
/// Story 39-17 (AC6 / D8) — persisted per-principal orchestrator agent
/// configuration row (<c>orchestrator_agent_configs</c>). Mirrors
/// <see cref="AcceptanceRulesOverride"/> and <see cref="PromptOverride"/>'s
/// dual-scoping XOR shape:
/// <list type="bullet">
///   <item>Single-user mode: <see cref="UserId"/> set, <see cref="TenantId"/> NULL.</item>
///   <item>SaaS mode: <see cref="TenantId"/> set, <see cref="UserId"/> NULL.</item>
/// </list>
/// Enforced structurally by CHECK <c>ck_orchestrator_agent_configs_principal_xor</c>
/// and unique index <c>(UserId, TenantId) NULLS NOT DISTINCT</c>.
/// </summary>
public class OrchestratorAgentConfigRow
{
    public Guid Id { get; set; }
    public Guid? UserId { get; set; }
    public Guid? TenantId { get; set; }

    /// <summary>Serialized <c>OrchestratorAgentConfig</c> JSONB payload.</summary>
    public string ConfigJson { get; set; } = null!;

    /// <summary>Monotonically incremented audit version on every upsert.</summary>
    public int Version { get; set; } = 1;

    public Guid? CreatedBy { get; set; }
    public Guid? UpdatedBy { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
