using Tamma.Data.Entities;

namespace Tamma.Data.Repositories;

/// <summary>
/// Story 39-17 (AC6 / D8) — persistence seam for <c>orchestrator_agent_configs</c>.
/// Mirrors <see cref="IAcceptanceRulesRepository"/>'s dual-scoping surface:
/// single-user rows are keyed on <c>UserId</c>, SaaS rows on <c>TenantId</c>.
/// </summary>
public interface IOrchestratorAgentConfigRepository
{
    Task<OrchestratorAgentConfigRow?> GetByUserAsync(Guid userId, Guid? dbTenantId = null, CancellationToken ct = default);
    Task<OrchestratorAgentConfigRow?> GetByTenantAsync(Guid tenantId, CancellationToken ct = default);
    Task<(OrchestratorAgentConfigRow Entity, bool WasCreated)> UpsertAsync(
        OrchestratorAgentConfigRow entity,
        Guid? actingUserId = null,
        Guid? dbTenantId = null,
        CancellationToken ct = default);
    Task<bool> DeleteByUserAsync(Guid userId, Guid? dbTenantId = null, CancellationToken ct = default);
    Task<bool> DeleteByTenantAsync(Guid tenantId, CancellationToken ct = default);
}
