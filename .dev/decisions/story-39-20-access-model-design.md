# Story 39-20 — Teams, Roles, Repo Access & Task Routing Design Decisions

## 1. Residency & Schema (`ControlPlaneDbContext`, D1)
Four control-plane tables live alongside `users`, `tenants`, and `tenant_memberships` (and are explicitly ignored in `TenantDbContext`):
- `teams` (`Id`, `TenantId`, `Name`, `Description`, `DefaultMemberRole`, timestamps) — unique `(TenantId, Name)`, CHECK `ck_teams_default_member_role IN ('member','maintainer')`.
- `team_members` (`Id`, `TeamId`, `UserId`, `Role`, `CreatedAt`) — unique `(TeamId, UserId)`, CHECK `ck_team_members_role IN ('member','maintainer')`, FK cascade on `teams`, restrict on `users`.
- `repositories` (`Id`, `TenantId`, `PlatformKind`, `RepoFullName`, `ExternalId`, `Visibility`, timestamps, `DeletedAt`) — minimal cross-platform repo catalogue anchoring grants; unique `(TenantId, PlatformKind, RepoFullName)`, CHECK `ck_repositories_visibility IN ('tenant','restricted')`.
- `repo_access_grants` (`Id`, `RepositoryId`, `UserId`, `TeamId`, `AccessLevel`, `CreatedBy`, timestamps) — CHECK `ck_repo_access_grants_level IN ('read','contribute','admin')`, CHECK `ck_repo_access_grants_grantee_xor` enforcing exactly one of `UserId` / `TeamId`, unique `(RepositoryId, UserId, TeamId)` with `NULLS NOT DISTINCT`.

## 2. Default Posture, Grandfather Backfill & Uncatalogued Fallback (AC2 / D2)
- **Default visibility:** `repositories.Visibility` defaults to `'tenant'`. Existing tenant-linked rows in `github_installation_repos` (joined through `github_installations` where `TenantId IS NOT NULL` and `IsActive = true`) are idempotently backfilled in migration `AddTeamsAndRepoAccess` with `Visibility = 'tenant'`, avoiding any lockout for existing tenants.
- **No-catalogue-row fallback:** Inside an already-authorized tenant (cross-tenant access remains strictly fail-closed via `GitRepoAuthorizer` and tenant-membership checks in `TaskAudienceResolver`), a repository that has not yet been inserted into `repositories` (for example non-GitHub installations whose repos are not pre-enumerated) resolves as `Visibility = 'tenant'`. Rows are upserted lazily when an admin registers, restricts, or attaches a grant to the repo.

## 3. Effective Access Composition Rule (AC6 / D4)
Implemented once in pure `EffectiveAccess.Compute(tenantRole, repoVisibility, grantLevels)`:
- Non-members (`tenantRole` null or outside `member < admin < owner`) receive `null` (no access).
- Tenant `owner` and `admin` hold implied `admin` access on every repository in their tenant.
- Tenant `member` holds implied `contribute` access on `tenant`-visible repositories and `null` on `restricted` repositories unless granted directly or through a team.
- Direct grants and team grants combine via `MAX` over `read (1) < contribute (2) < admin (3)` and only ever add access.
- Team-membership roles (`member | maintainer`) govern team membership management only; `maintainer` never bypasses tenant roles or adds implicit repository access.

## 4. Scope Cache Trade-off (D6)
`UserRepoScopeCache` caches `(TenantId, UserId) -> UserRepoScope` in a singleton `ConcurrentDictionary` with a `TimeProvider`-driven 60-second TTL. Every write in `TeamService` and `RepoAccessService` calls `InvalidateTenant(tenantId)` immediately. External tenant-membership mutations in `OrgEndpoints` are bounded by the 60-second TTL rather than coupling `OrgEndpoints` to this cache; hub connections remain independently authenticated per request.

## 5. Single-User vs SaaS Mode Parity (AC7)
No mode branching exists in `TaskAudienceResolver` or `EffectiveAccess`. In single-user mode, the sole user is auto-`owner` of their personal tenant with zero teams and `tenant`-visible repositories, so the identical visibility and audience predicates grant full access with zero special-casing.
