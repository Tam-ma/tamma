# Story 47-2: Local Single-User State Exporter

Status: drafted

## User Story

As a **local Tamma operator**, I want a signed `tamma export-local` bundle for TammaDesktop, so that I can carry forward my work history and preferences and re-authorize providers in the desktop keychain.

## Priority

P0 / Phase S1

## Scope

Export one verified local user and personal tenant into `tamma-local-export-v1.tar.gz`. Capture the personal tenant's state and control-plane user-keyed state through a versioned JSON and SQLite contract shared with TammaDesktop D1.

## Acceptance Criteria

1. `tamma export-local` resolves one existing local user and one owned `personal` tenant. Missing or ambiguous ownership, a SaaS deployment, and a mismatched schema fail before publishing an archive. Source databases remain read-only.
2. The archive contains a signed manifest, JSON metadata, and SQLite data. The manifest records format version, source revision and migration identifiers, capture metadata, row counts, payload sizes and SHA-256 digests. D1 rejects tampering, untrusted signatures, unsupported versions and incomplete bundles before import writes.
3. The bundle preserves supported event ordering, document lineage, conventions, budgets, prompt overrides, workflow records, and user-keyed control-plane action policies and provider metadata. The D1 round trip validates counts, IDs, relationships and representative payloads from both planes.
4. Seeded secret canaries are absent from the archive, manifest, diagnostic output and failed-export artifacts. Credential references become re-authorization markers. Tests exercise nested payloads containing tokens, passwords, connection strings and secret envelopes.
5. Cancellation, interrupted reads and full disk leave no published partial export. Repeating export from the same quiesced fixture yields equivalent data, and D1 can import the same verified bundle twice without duplicate state.

## Dependencies

- Requires a legacy local schema and TammaDesktop D1 agreement on archive schema, signature trust and re-authorization markers.
- A verified D1 round trip blocks S2 production activation and the 47-9 CLI handoff.

## Estimated Effort

6–9 days

## Dev Notes

`TenantDbContext` and `ControlPlaneDbContext` expose some similarly named datasets. Use current personal-tenant routing and explicit per-dataset ownership. `ActionAuthorization.DecidedByUserId` records an actor. Its owning principal is keyed separately by `UserId` or `TenantId`.

[Implementation plan](./implementation-plan.md)
