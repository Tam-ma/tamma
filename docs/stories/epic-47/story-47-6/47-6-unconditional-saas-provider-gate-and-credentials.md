# Story 47-6: Unconditional SaaS Provider Gate and Credentials

Status: drafted

## User Story

As a **SaaS tenant owner**, I want every managed provider call to follow SaaS eligibility and credential rules, so that local subscription credentials and another tenant's settings cannot be used for my execution.

## Priority

P0 / Phase S3

## Scope

Remove single-user paths from `SaaSProviderGate`, `DefaultProviderCredentialResolver`, `ConfigPlatformFallbackPolicy`, `ProviderSettingsStore`, `EmailCredentialResolver` and `JiraCredentialResolver`. Verify credential administration and runtime callers.

## Acceptance Criteria

1. Cloud provider calls always traverse the SaaS gate. The policy matrix covers API-key providers, eligible and ineligible BYOK, plan denials, and providers that depend on a personal subscription or local CLI. Denials happen before credential use or dispatch.
2. An allowed tenant call resolves tenant BYOK first and can use platform credentials only under the existing provider and fallback policy. Missing tenant context on a tenant call fails closed. A separately authorized platform caller can resolve a platform-scoped credential.
3. Tenant settings and credential caches are isolated by tenant and provider. Platform defaults compose with tenant overrides. Rotation, deletion and setting updates invalidate affected entries. A CP user-keyed legacy row cannot influence either tenant.
4. Email and Jira integration calls use the verified tenant's stored credential bundle, and missing, partial or foreign bundles return the existing unavailable result. Legacy local config cannot supply tenant credentials. Any supported platform/system operation uses an explicit platform credential path.
5. Logs and provider events retain source/version and denial context with seeded credentials absent from output.

## Dependencies

- 47-3 supplies the selector cutover and 47-4 supplies verified identity. Coordinate the scope and data changes with 47-5 and billing attribution with 47-7.

## Estimated Effort

5–7 days

## Dev Notes

`ConfigPlatformFallbackPolicy` currently treats null tenant as eligible for platform fallback. Prove platform authorization at the calling boundary. Provider settings and decrypted credentials are different stores with separate cache invalidation paths.

[Implementation plan](./implementation-plan.md)
