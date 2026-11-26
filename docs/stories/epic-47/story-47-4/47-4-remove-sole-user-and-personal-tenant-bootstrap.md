# Story 47-4: Remove Sole User and Personal Tenant Bootstrap

Status: drafted

## User Story

As a **tenant administrator**, I want identity and permissions to come from verified users, service principals and tenant memberships, so that a request cannot inherit ownership from the first account or create a tenant implicitly.

## Priority

P0 / Phase S2

## Scope

Remove `SoleUserProvider` and its interface, `EnsurePersonalTenantMiddleware`, and the single-user bypass in `PermissionHandler`. Audit JWT, API key, service principal, and tenant-context call sites.

## Acceptance Criteria

1. `Program.cs` no longer registers the sole-user provider or personal-tenant middleware. A first authenticated request without a tenant membership creates no tenant, membership, default enablement or active tenant selection.
2. Tenant endpoints recognize authorized JWT and API-key principals for the correct tenant. Anonymous, missing-context, stale-membership and tenant-mismatch requests are denied where scope is required. A legitimate tenant-less platform route remains available to verified platform owners.
3. `PermissionHandler` requires the normal permission policy and membership context. Tests show a member cannot perform an admin action and a tenant owner cannot invoke `PlatformOwnerAccess` without platform authorization.
4. Explicit organization creation and provisioning still seed the intended tenant data. Existing tenant memberships remain usable after an upgrade. Background calls with absent or conflicting tenant scope fail closed without treating a local owner as the caller.

## Dependencies

- 47-3 supplies fail-closed auth wiring. Coordinate request scope and governance resolver edits with 47-5, and legacy wait dependencies with 47-8.
- D1 import verification from 47-2 is required before removing bootstrap or sole-user identity in production.

## Estimated Effort

4–6 days

## Dev Notes

`TenantContextMiddleware` already resolves the verified tenant for normal SaaS requests. Keep the current service authentication and explicit permission semantics. The historic `personal` tenant type and authorized memberships can remain readable.

[Implementation plan](./implementation-plan.md)
