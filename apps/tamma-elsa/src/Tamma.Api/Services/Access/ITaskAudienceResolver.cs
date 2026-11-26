namespace Tamma.Api.Services.Access;

/// <summary>
/// Story 39-20's canonical audience-resolution seam (AC3 / D5).
/// Task delivery is ROLE-ADDRESSED (design review 2026-07-21): a task fans out to
/// every role-holder the resolver says may see it, not one user.
///
/// <para>Implemented in production solely by <see cref="TaskAudienceResolver"/>
/// (pinned by <c>TaskAudiencePinTests</c>, D11).</para>
/// </summary>
public interface ITaskAudienceResolver
{
    /// <summary>
    /// Pure visibility predicate (AC3 / D5): true iff <paramref name="userId"/>
    /// is a member of <paramref name="task"/>'s tenant AND (initiated the task's
    /// workflow OR has access to the task's repo via direct/team grant or tenant
    /// visibility). Deliberately ignores <see cref="TaskRef.RequiredPermission"/>.
    /// </summary>
    Task<bool> CanSeeAsync(Guid userId, TaskRef task);

    /// <summary>
    /// The ordered eligible audience for <paramref name="task"/> addressed to
    /// tenant role <paramref name="roleWire"/> — holders of the role (or higher
    /// in <c>member &lt; admin &lt; owner</c>) ∩ visibility predicate, filtered by
    /// <see cref="TaskRef.RequiredPermission"/> when set.
    /// </summary>
    Task<IReadOnlyList<AudienceMember>> EligibleAudienceAsync(TaskRef task, string roleWire);
}

/// <summary>
/// Story 39-20 (D10 / D11) — effective-access evaluation seam implemented by
/// <see cref="TaskAudienceResolver"/> so consumers such as
/// <see cref="WorkflowInitiationAuthorizer"/> and <c>RepoAccessEndpoints</c>
/// query repo access through the single resolver without touching raw grant
/// repositories.
/// </summary>
public interface IRepoAccessEvaluator
{
    Task<string?> GetEffectiveAccessLevelAsync(
        Guid userId,
        Guid tenantId,
        Guid? repositoryId,
        string? repoFullName,
        CancellationToken ct = default);
}

/// <summary>
/// The canonical task reference the audience is resolved against (Story 39-20 D5).
/// Trailing parameters default to <c>null</c> so 4-argument callers from Stories
/// 39-18 and 44-2 remain source-compatible without churn.
/// </summary>
public sealed record TaskRef(
    Guid TenantId,
    Guid? InitiatorUserId,
    string? RepoKey,
    string? IssueId,
    Guid? RepositoryId = null,
    Guid? DocumentId = null,
    string? RequiredPermission = null);

/// <summary>
/// One resolved audience member: user id, tenant role wire, eligibility basis
/// (<c>initiator</c> | <c>repo-access</c>), and effective repo access level.
/// </summary>
public sealed record AudienceMember(
    Guid UserId,
    string RoleWire,
    string Basis = "repo-access",
    string EffectiveLevel = "contribute");

/// <summary>
/// Story 39-18 (D9) — superseded fail-closed stub replaced in DI by
/// <see cref="TaskAudienceResolver"/> (Story 39-20). Retained ONLY so
/// <c>TrackerService.IsStubResolver</c> and legacy unit tests keep compiling;
/// never registered in production DI.
/// </summary>
[Obsolete("Replaced by TaskAudienceResolver (Story 39-20). Do not register in production DI.")]
public sealed class InitiatorOnlyTaskAudienceResolver : ITaskAudienceResolver
{
    public Task<bool> CanSeeAsync(Guid userId, TaskRef task)
        => Task.FromResult(task.InitiatorUserId is { } initiator && initiator == userId);

    public Task<IReadOnlyList<AudienceMember>> EligibleAudienceAsync(TaskRef task, string roleWire)
    {
        IReadOnlyList<AudienceMember> audience = task.InitiatorUserId is { } initiator
            ? new[] { new AudienceMember(initiator, roleWire, "initiator", RepoAccessLevels.Contribute) }
            : Array.Empty<AudienceMember>();
        return Task.FromResult(audience);
    }
}
