# Story 47-5: Unconditional Tenant Scope for Governance, Prompts and Analytics

Status: drafted

## User Story

As a **tenant administrator**, I want application settings and work data to follow the tenant's authorization boundary, so that users see the right configuration and cannot read or mutate another tenant's data.

## Priority

P0 / Phase S2

## Scope

Consolidate ActionPolicy, AcceptanceRules, PromptStore, Conventions, Analytics, Tracker, Chat and OrchestratorConfig to the existing tenant and explicitly authorized platform scopes. Cover endpoint, service, background and data wiring.

## Acceptance Criteria

1. Action policies, acceptance rules, and orchestrator configuration resolve against the verified tenant and applicable platform defaults or ceilings. Tenant writes preserve policy permissions, override precedence and existing conflict handling. User-keyed local rows cannot act as live SaaS policy.
2. Tenant prompts and conventions read/write the tenant store. Platform defaults stay on the authorized platform path. A two-tenant fixture proves effective-value precedence, independent updates and the existing optimistic concurrency behavior.
3. Analytics, Tracker and Chat use the verified tenant. Tenant switching, member versus admin access, and same-ID fixtures show scoped results, and foreign or missing tenant context does not route to control-plane user data.
4. Scheduled, agent, task and LLM-stream call sites that consume these scopes either resolve a verified tenant or take a separately authorized platform path. Persisted historic DCB/audit events still read without live user-keyed fallbacks.

## Dependencies

- Requires the 47-3 startup and selector cutover and the 47-4 verified identity contract. Reuse the 47-2 D1 archive for legacy local settings.
- Coordinate provider scope changes with 47-6, historic wait handling with 47-8, and Tracker source/UI changes with 47-9.

## Estimated Effort

8–12 days

## Dev Notes

Keep user IDs for actor attribution, access control and user-specific visibility where applicable. Use tenant ID for the owner namespace. `ActionPolicyEndpoints` already gates platform ceilings with `PlatformOwnerAccess`.

[Implementation plan](./implementation-plan.md)
