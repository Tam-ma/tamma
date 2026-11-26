using System.Text.Json.Serialization;

namespace Tamma.Api.Dtos.Access;

// ── Teams ──────────────────────────────────────────────────────────────────

public sealed record TeamMemberResponse(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("teamId")] Guid TeamId,
    [property: JsonPropertyName("userId")] Guid UserId,
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("createdAt")] DateTime CreatedAt);

public sealed record TeamResponse(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("tenantId")] Guid TenantId,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("defaultMemberRole")] string DefaultMemberRole,
    [property: JsonPropertyName("memberCount")] int MemberCount,
    [property: JsonPropertyName("members")] IReadOnlyList<TeamMemberResponse> Members,
    [property: JsonPropertyName("createdAt")] DateTime CreatedAt,
    [property: JsonPropertyName("updatedAt")] DateTime UpdatedAt);

public sealed record CreateTeamRequest(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("description")] string? Description = null,
    [property: JsonPropertyName("defaultMemberRole")] string? DefaultMemberRole = null);

public sealed record UpdateTeamRequest(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("description")] string? Description = null,
    [property: JsonPropertyName("defaultMemberRole")] string? DefaultMemberRole = null);

public sealed record AddTeamMemberRequest(
    [property: JsonPropertyName("userId")] Guid UserId,
    [property: JsonPropertyName("role")] string? Role = null);

public sealed record UpdateTeamMemberRoleRequest(
    [property: JsonPropertyName("role")] string? Role);

// ── Repositories & Grants ──────────────────────────────────────────────────

public sealed record RegisteredRepoResponse(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("tenantId")] Guid TenantId,
    [property: JsonPropertyName("platformKind")] string PlatformKind,
    [property: JsonPropertyName("repoFullName")] string RepoFullName,
    [property: JsonPropertyName("externalId")] string? ExternalId,
    [property: JsonPropertyName("visibility")] string Visibility,
    [property: JsonPropertyName("effectiveAccessLevel")] string? EffectiveAccessLevel,
    [property: JsonPropertyName("createdAt")] DateTime CreatedAt,
    [property: JsonPropertyName("updatedAt")] DateTime UpdatedAt);

public sealed record RegisterRepoRequest(
    [property: JsonPropertyName("platformKind")] string? PlatformKind,
    [property: JsonPropertyName("repoFullName")] string? RepoFullName,
    [property: JsonPropertyName("externalId")] string? ExternalId = null,
    [property: JsonPropertyName("visibility")] string? Visibility = null);

public sealed record UpdateRepoVisibilityRequest(
    [property: JsonPropertyName("visibility")] string? Visibility);

public sealed record RepoAccessGrantResponse(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("repositoryId")] Guid RepositoryId,
    [property: JsonPropertyName("userId")] Guid? UserId,
    [property: JsonPropertyName("teamId")] Guid? TeamId,
    [property: JsonPropertyName("accessLevel")] string AccessLevel,
    [property: JsonPropertyName("createdBy")] Guid? CreatedBy,
    [property: JsonPropertyName("createdAt")] DateTime CreatedAt,
    [property: JsonPropertyName("updatedAt")] DateTime UpdatedAt);

public sealed record UpsertRepoGrantRequest(
    [property: JsonPropertyName("userId")] Guid? UserId,
    [property: JsonPropertyName("teamId")] Guid? TeamId,
    [property: JsonPropertyName("accessLevel")] string? AccessLevel);

public sealed record RevokeRepoGrantRequest(
    [property: JsonPropertyName("userId")] Guid? UserId,
    [property: JsonPropertyName("teamId")] Guid? TeamId);
