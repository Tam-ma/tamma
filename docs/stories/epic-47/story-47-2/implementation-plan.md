# Implementation Plan — Story 47-2: Local Single-User State Exporter

## Scope & Deliverable

Export one verified local user and personal tenant into `tamma-local-export-v1.tar.gz`. Capture the personal tenant's state and control-plane user-keyed state through a versioned JSON and SQLite contract shared with TammaDesktop D1. Completion evidence is mapped to the [story acceptance criteria](./47-2-local-single-user-state-exporter.md) below.

## Pre-Reading

- [docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md](../../../../docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md)
- [packages/cli/src/index.tsx](../../../../packages/cli/src/index.tsx)
- [apps/tamma-elsa/src/Tamma.Api/Program.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Program.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Billing/SeedBillingCommand.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Billing/SeedBillingCommand.cs)
- [apps/tamma-elsa/src/Tamma.Api/Middleware/EnsurePersonalTenantMiddleware.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Middleware/EnsurePersonalTenantMiddleware.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Actions/SoleUserProvider.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Actions/SoleUserProvider.cs)
- [apps/tamma-elsa/src/Tamma.Data/TenantDbContext.cs](../../../../apps/tamma-elsa/src/Tamma.Data/TenantDbContext.cs)
- [apps/tamma-elsa/src/Tamma.Data/ControlPlaneDbContext.cs](../../../../apps/tamma-elsa/src/Tamma.Data/ControlPlaneDbContext.cs)
- [apps/tamma-elsa/src/Tamma.Data/Entities/DomainEvent.cs](../../../../apps/tamma-elsa/src/Tamma.Data/Entities/DomainEvent.cs)
- [apps/tamma-elsa/src/Tamma.Data/Entities/ProviderSetting.cs](../../../../apps/tamma-elsa/src/Tamma.Data/Entities/ProviderSetting.cs)
- [apps/tamma-elsa/src/Tamma.Data/Entities/ActionAuthorization.cs](../../../../apps/tamma-elsa/src/Tamma.Data/Entities/ActionAuthorization.cs)

## Design Decisions

- **D1 — Legacy command with an offline reader.** Have the CLI delegate database access to a local command using the landed .NET data mappings. Follow the command-dispatch pattern in `Program.cs` and `SeedBillingCommand.cs` for invocation shape. Compose a read-only path that avoids web hosting, migrations, seeding and secret resolution.
- **D2 — Consistent capture.** Quiesce writers and drain projector/worker writes across both databases for the final export. Use repeatable read transactions, verify owner membership and schema, and capture migration IDs and a durable watermark. Abort if a consistent snapshot cannot be demonstrated.
- **D3 — File contract and trust.** Agree with D1 on canonical manifest bytes, signing algorithm (propose Ed25519), key ID and out-of-band trust. Sign with a dedicated export key. Verify signer identity, exact member names and digests, bounded archive expansion and version before importing. Document the layout and generate shared fixtures.
- **D4 — Explicit data projection.** Build field allowlists per entity and payload type. Use re-authorization markers and scrub nested event, document and workflow payloads. Unknown or opaque payloads with unverifiable credential content block completion until a safe projection is defined. Preserve non-secret IDs, timestamps and ordering.

## Implementation Steps

1. Publish a versioned field inventory with D1. Enumerate tenant event, document, convention, budget, prompt, workflow and acceptance-rule records. Enumerate user-owned CP `ActionAssignments`, `ActionAuthorizations`, `ActionLevelOverrides`, `PromptOverrides`, `ProviderSettings` and other discovered overrides. Map each dataset's owner key, store, fields and exclusions.
2. Implement `export-local` dispatch and the read-only reader. Check the legacy local deployment, resolve the sole account and its verified personal tenant, then bind directly to the tenant schema and source control plane. Use the existing tenant connection mapping solely to connect. Exclude the connection metadata and any decryption material from exports and logs.
3. Stage SQLite with integrity and relationship checks. Write allowlisted JSON metadata and the manifest, sign it, and verify the archive in private staging. Publish by atomic rename and clean up on failure.
4. Add credential canaries in provider config, event payloads, workflow inputs and free text. Verify scrubbed contents, logs, temporary output and destination behavior on injected failures.
5. Import with D1 into an empty desktop store, then repeat import. Record schema/version mapping, counts, lineage, supported payload fidelity and re-authorization. Repeat the final export procedure before S2 activation.

## Data & Migrations

Source schema and rows stay read-only. Archive ordering, IDs and timestamps are versioned contract fields. Credentials, password hashes, tokens, secret envelopes, signing keys and connection strings are outside the archive schema. Budget and workflow history are data to import. Live Elsa bookmark handling belongs to 47-8.

## Events

Export existing DCB event records in sequence order with historic tags and safe payload projection. Report progress and summary locally. The command writes zero events to the source databases.

## TDD Test Plan

Add the regression assertions against the current implementation, then run them against the cutover behavior.

- Postgres fixtures with two tenants and distinct sentinels validate owner/schema resolution, missing and ambiguous personal tenant, and zero source writes.
- Cross-plane fixtures cover domain events, document lineage, settings, workflow state and user-keyed CP data. Validate source-to-archive-to-D1 counts, IDs and semantic equivalence.
- Tamper manifest and payload bytes, replace the signing key, add unexpected or oversized archive members, and supply an unsupported version. Assert importer refusal before writes.
- Inject interruption and storage exhaustion at staging boundaries. Seed raw and encoded credential canaries and inspect archive members, SQLite tables, logs and failure paths.

## Definition of Done

| Acceptance criterion | Implementation steps | Verification |
|---|---|---|
| AC 1 | 1–2 | Ownership and read-only fixtures |
| AC 2 | 1, 3, 5 | Signed fixture and importer rejection tests |
| AC 3 | 1–3, 5 | D1 count, lineage and content report |
| AC 4 | 1, 3–4 | Canary and re-authorization tests |
| AC 5 | 3–5 | Failure injection and repeat import |

## Risks & Mitigations

- **Cross-database drift.** Coordinate final quiesce with the local operator and verify both watermarks before publication.
- **History lost to an underspecified projection.** Diff the archive inventory against the legacy models and require D1 fixtures for every supported dataset.
- **Opaque payloads or staging contain secrets.** Project before SQLite serialization, fail closed on unsupported shapes and use owner-only staging.
