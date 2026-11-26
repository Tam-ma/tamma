using System.Text.Json;
using Tamma.Api.Services.Git;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Access;

/// <summary>Result of a workflow-initiation authorization check (Story 39-20 AC4 / D10).</summary>
public sealed record WorkflowInitiationDecision(bool Allowed, string? Reason = null)
{
    public static WorkflowInitiationDecision Allow() => new(true);
    public static WorkflowInitiationDecision Deny(string reason) => new(false, reason);
}

/// <summary>
/// Story 39-20 (AC4 / D10) — enforces that an initiating user holds both
/// tenant-level repo authorization (<see cref="IGitRepoAuthorizer"/>) AND
/// user-grain access ≥ <c>contribute</c> on the target repository.
/// </summary>
public interface IWorkflowInitiationAuthorizer
{
    Task<WorkflowInitiationDecision> AuthorizeAsync(
        Guid userId,
        Guid tenantId,
        string repoFullName,
        string? workflowName = null,
        CancellationToken ct = default);
}

/// <inheritdoc />
public sealed class WorkflowInitiationAuthorizer(
    IGitRepoAuthorizer gitAuthorizer,
    IRepoAccessEvaluator accessEvaluator,
    IEventRepository events,
    ILogger<WorkflowInitiationAuthorizer> logger) : IWorkflowInitiationAuthorizer
{
    public async Task<WorkflowInitiationDecision> AuthorizeAsync(
        Guid userId,
        Guid tenantId,
        string repoFullName,
        string? workflowName = null,
        CancellationToken ct = default)
    {
        if (userId == Guid.Empty || tenantId == Guid.Empty || string.IsNullOrWhiteSpace(repoFullName))
            return await DenyAndEmitAsync(userId, tenantId, repoFullName, workflowName, "userId, tenantId, and repoFullName are required");

        // 1. Existing tenant-boundary fence (Story 38-1, unchanged).
        var tenantDecision = await gitAuthorizer.AuthorizeAsync(tenantId, repoFullName, ct);
        if (!tenantDecision.Allowed)
        {
            return await DenyAndEmitAsync(
                userId,
                tenantId,
                repoFullName,
                workflowName,
                tenantDecision.Reason ?? "tenant is not authorized for this repository");
        }

        // 2. User-grain effective access ≥ contribute (D4 / D10).
        var effectiveLevel = await accessEvaluator.GetEffectiveAccessLevelAsync(
            userId, tenantId, repositoryId: null, repoFullName, ct);

        if (!RepoAccessLevels.IsAtLeast(effectiveLevel, RepoAccessLevels.Contribute))
        {
            var reason = effectiveLevel is null
                ? $"user does not have access to repository '{repoFullName}'"
                : $"user has '{effectiveLevel}' access on '{repoFullName}', but workflow initiation requires at least '{RepoAccessLevels.Contribute}'";
            return await DenyAndEmitAsync(userId, tenantId, repoFullName, workflowName, reason);
        }

        return WorkflowInitiationDecision.Allow();
    }

    private async Task<WorkflowInitiationDecision> DenyAndEmitAsync(
        Guid userId,
        Guid tenantId,
        string? repoFullName,
        string? workflowName,
        string reason)
    {
        try
        {
            await events.AppendAsync(new DomainEvent
            {
                Id = Guid.NewGuid(),
                Type = AccessEvents.RepoAccessCheckDenied,
                TenantId = tenantId,
                Tags = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["tenantId"] = tenantId.ToString(),
                    ["userId"] = userId.ToString(),
                    ["repo"] = repoFullName ?? string.Empty,
                }),
                Metadata = """{"source":"WorkflowInitiationAuthorizer"}""",
                Data = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["repoFullName"] = repoFullName ?? string.Empty,
                    ["workflowName"] = workflowName,
                    ["reason"] = reason,
                }),
                CreatedAt = DateTime.UtcNow,
            });
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Best-effort emit of {EventType} failed", AccessEvents.RepoAccessCheckDenied);
        }

        return WorkflowInitiationDecision.Deny(reason);
    }
}
