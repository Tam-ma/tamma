# Story 47-3: Remove TammaMode and Fail Closed at SaaS Startup

Status: drafted

## User Story

As a **SaaS operator**, I want startup to require explicit SaaS configuration, so that a broken deployment fails before it can accept requests or run background work.

## Priority

P0 / Phase S2

## Scope

Remove `TammaMode`, `ITammaModeProvider`, `TammaModeProvider` and the `Tamma:Mode` inference path. Validate required SaaS configuration before runtime initialization.

## Acceptance Criteria

1. The API fails before listening, migrating a database, or starting hosted services when `ConnectionStrings:ControlPlane`, `Jwt:Secret`, or a required KEK is missing, blank or malformed. An admin DB connection alone cannot satisfy the control-plane requirement.
2. A valid explicit SaaS configuration starts with verified authentication, the explicit control-plane binding and persistent encrypted secrets. The executable fails closed under Development and Production with the same invalid-config fixtures.
3. Production API code compiles with zero references to the mode enum, provider interface or implementation. Previously conditional paths use their SaaS behavior. Legacy local mode settings are rejected with a migration diagnostic and stale SaaS settings cannot select runtime behavior.
4. Startup failures identify the configuration key and classify the issue without exposing secret values or connection strings. Existing authenticated and readiness probes succeed under a correctly configured rollout.

## Dependencies

- Requires the 47-2 export and D1 confirmation before activation. Stage explicit configuration on each rolling-deploy target first.
- Coordinate caller changes with 47-4 through 47-8. 47-3 owns the selector removal and the compile-preserving caller sweep. Later stories own subsystem cleanup and the remaining rollout gates.

## Estimated Effort

5–7 days

## Dev Notes

`Program.cs` contains a permissive Development auth branch and an optional control-plane binding. `KekProvider` reads `Cranl:EncryptionKey` for connection strings. `EnvKekProvider` reads `TAMMA_SECRET_STORE_KEK_PRIMARY` for the cabinet.

[Implementation plan](./implementation-plan.md)
