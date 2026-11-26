# Implementation Plan — Story 47-4: Remove Sole User and Personal Tenant Bootstrap

## Scope & Deliverable

Remove `SoleUserProvider` and its interface, `EnsurePersonalTenantMiddleware`, and the single-user bypass in `PermissionHandler`. Audit JWT, API key, service principal, and tenant-context call sites. Completion evidence is mapped to the [story acceptance criteria](./47-4-remove-sole-user-and-personal-tenant-bootstrap.md) below.

## Pre-Reading

- [docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md](../../../../docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md)
- [apps/tamma-elsa/src/Tamma.Api/Program.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Program.cs)
- [apps/tamma-elsa/src/Tamma.Api/Middleware/TenantContextMiddleware.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Middleware/TenantContextMiddleware.cs)
- [apps/tamma-elsa/src/Tamma.Api/Middleware/EnsurePersonalTenantMiddleware.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Middleware/EnsurePersonalTenantMiddleware.cs)
- [apps/tamma-elsa/src/Tamma.Api/Auth/PermissionHandler.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Auth/PermissionHandler.cs)
- [apps/tamma-elsa/src/Tamma.Api/Authorization/RequireTenantMembershipFilter.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Authorization/RequireTenantMembershipFilter.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Actions/SoleUserProvider.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Actions/SoleUserProvider.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Actions/GovernancePrincipalResolver.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Actions/GovernancePrincipalResolver.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Provisioning/TenantProvisioningService.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Provisioning/TenantProvisioningService.cs)
- [apps/tamma-elsa/tests/Tamma.Api.Tests/Middleware/TenantContextMiddlewareTests.cs](../../../../apps/tamma-elsa/tests/Tamma.Api.Tests/Middleware/TenantContextMiddlewareTests.cs)
- [apps/tamma-elsa/tests/Tamma.Api.Tests/Auth/PlatformOwnerAccessPolicyTests.cs](../../../../apps/tamma-elsa/tests/Tamma.Api.Tests/Auth/PlatformOwnerAccessPolicyTests.cs)

## Design Decisions

- **D1 — Context from verified identity.** Keep claim, API key, and tenant membership validation in the existing authentication/context path. Apply explicit tenant filters for route IDs and keep authorized active-tenant selection. Platform authority remains a separately checked permission.
- **D2 — Provisioning remains an explicit operation.** Drop request-triggered tenant creation and auto-binding. Reuse `OrgEndpoints` and `TenantProvisioningService` for the existing explicit lifecycle.
- **D3 — Delete the sole-user resolver with its callers.** Switch synchronous endpoint and background ownership to their existing SaaS context. A wait that still requires the legacy resolver blocks its deletion until drained under the 47-8 protocol. Run that preflight during S2 before deleting the resolver.

## Implementation Steps

1. Trace ordering and authorization from `Program.cs` through `TenantContextMiddleware`, `RequireTenantMembershipFilter`, and `PermissionHandler`. Record where authenticated tenant-less calls are valid.
2. Replace or delete remaining sole-user call sites. Check auth/org mutations, agent enablement, background and wait resolution, and tenant lifecycle seeding. Coordinate any legacy wait drain before deleting shared identity classes.
3. Remove the middleware class and registration, provider class and interface, and stale dependency wiring. Keep the verified-identity authorization path and delete the permission bypass.
4. Exercise an upgrade fixture with real memberships and a newly authenticated no-membership user. Assert unchanged tenant counts and explicit organization creation still provisions the intended records.

## Data & Migrations

No deletion of existing personal tenants, memberships or users. Preserve historic user actor IDs in audit records. Review membership changes only through normal provisioning.

## Events

Generated `TENANT.AUTO_CREATED` events from request bootstrap cease. Explicit tenant lifecycle events and historic `TENANT.AUTO_CREATED` and `TENANT.RESOLVED.SUCCESS` records remain readable.

## TDD Test Plan

Add the regression assertions against the current implementation, then run them against the cutover behavior.

- Extend `TenantContextMiddlewareTests` and `PlatformOwnerAccessPolicyTests` with two tenants and separate users, an API key, a service caller, forged scope and missing membership.
- Replace implicit creation tests from `EnsurePersonalTenantMiddlewareTests.cs` with request-path assertions of no side effects. Build on `TenantProvisioningServiceTests.cs` for explicit provisioning.
- Check old memberships, authenticated platform routes, permission differences between member and owner, and tenant-less background requests.

## Definition of Done

| Acceptance criterion | Implementation steps | Verification |
|---|---|---|
| AC 1 | 2–4 | First-request persistence checks and DI inventory |
| AC 2–3 | 1, 3–4 | JWT/API key and permissions matrix |
| AC 4 | 2, 4 | Upgrade/provisioning and background isolation tests |

## Risks & Mitigations

- **Scope validation is removed with bootstrap.** Test tenant header/route mismatches and membership revocation at the HTTP boundary.
- **Old waits still depend on the resolver.** Enforce 47-8's drain checkpoint before deleting legacy lookup paths.
- **Provisioning defaults disappear with middleware.** Test explicit create and verify tenant seeding in a fresh database.
