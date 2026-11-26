namespace Tamma.Api.Services.Access;

/// <summary>
/// Story 39-20 (AC1 / AC2 / AC4 / D8) — DCB event constants for team CRUD,
/// repository visibility/grants, and workflow-initiation access checks.
/// Every constant conforms to <c>AGGREGATE.ACTION.STATUS</c>.
/// </summary>
public static class AccessEvents
{
    public const string TeamCreated = "TEAM.CREATED.SUCCESS";
    public const string TeamUpdated = "TEAM.UPDATED.SUCCESS";
    public const string TeamDeleted = "TEAM.DELETED.SUCCESS";
    public const string TeamMemberAdded = "TEAM.MEMBER_ADDED.SUCCESS";
    public const string TeamMemberRemoved = "TEAM.MEMBER_REMOVED.SUCCESS";
    public const string TeamMemberRoleChanged = "TEAM.MEMBER_ROLE_CHANGED.SUCCESS";

    public const string RepoRegistered = "REPO.REGISTERED.SUCCESS";
    public const string RepoVisibilityChanged = "REPO.VISIBILITY_CHANGED.SUCCESS";
    public const string RepoGrantUpserted = "REPO.GRANT_UPSERTED.SUCCESS";
    public const string RepoGrantRevoked = "REPO.GRANT_REVOKED.SUCCESS";
    public const string RepoAccessCheckDenied = "REPO.ACCESS_CHECK.DENIED";
}
