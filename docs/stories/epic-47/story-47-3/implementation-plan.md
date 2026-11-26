# Implementation Plan — Story 47-3: Remove TammaMode and Fail Closed at SaaS Startup

## Scope & Deliverable

Remove `TammaMode`, `ITammaModeProvider`, `TammaModeProvider` and the `Tamma:Mode` inference path. Validate required SaaS configuration before runtime initialization. Completion evidence is mapped to the [story acceptance criteria](./47-3-remove-tamma-mode-and-fail-closed-saas-startup.md) below.

## Pre-Reading

- [docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md](../../../../docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md)
- [apps/tamma-elsa/src/Tamma.Api/Program.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Program.cs)
- [apps/tamma-elsa/src/Tamma.Api/Infrastructure/ConnectionStringResolver.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Infrastructure/ConnectionStringResolver.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/PromptStore/TammaMode.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/PromptStore/TammaMode.cs)
- [apps/tamma-elsa/src/Tamma.Api/Extensions/PromptStoreServiceCollectionExtensions.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Extensions/PromptStoreServiceCollectionExtensions.cs)
- [apps/tamma-elsa/src/Tamma.Data/DependencyInjection.cs](../../../../apps/tamma-elsa/src/Tamma.Data/DependencyInjection.cs)
- [apps/tamma-elsa/src/Tamma.Api/Auth/JwtService.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Auth/JwtService.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Secrets/KekProvider.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Secrets/KekProvider.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Secrets/Postgres/EnvKekProvider.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Secrets/Postgres/EnvKekProvider.cs)
- [docker/.env.example](../../../../docker/.env.example)

## Design Decisions

- **D1 — Validate at the composition root.** Resolve explicit `ConnectionStrings:ControlPlane` and validate its syntax. Require at least 32 bytes of UTF-8 key material for the HS256 signer used by `JwtService`, and apply the two existing KEK parsers to their respective required key material. Validation precedes startup side effects. Preserve existing issuer/audience defaults and use readiness for dependency liveness.
- **D2 — Supersede legacy settings.** Consume `Tamma:Mode` only as a temporary upgrade diagnostic, accepting stale `saas` without effect and rejecting local or unknown values without echoing them. Remove remaining deployment config usage and the diagnostic in S4 after operators clear it.
- **D3 — Cut callers over with symbol deletion.** Enumerate every enum/provider constructor, endpoint, route map, and test fixture. In the same buildable change keep the SaaS behavior at each runtime mode branch and remove mode arguments. This includes making the existing SaaS billing route and DI branch unconditional at the selector seam. Stories 47-4 to 47-8 then remove obsolete implementations and tighten the surviving paths. Avoid a constant-mode provider or retained runtime toggle.

## Implementation Steps

1. Inventory tracked enum, interface, implementation and mode config callers with `git grep`. Assign shared files in `Program.cs`, route maps and DI factories to D3 and reconcile with later stories before the first commit.
2. Stage explicit configuration through the deployment secrets mechanism. Update the Compose and deployment templates in this change so the valid config reaches the running API. Remove placeholder signing defaults and update test hosts to inject valid isolated dependencies. Reconcile legacy waits using the 47-8 preflight before activating this revision.
3. Implement startup validation and wire it ahead of migrations, seeding, hosted workers and app listening. Remove fallback control-plane binding and permissive Development authentication from the API path, and require the persistent cabinet.
4. Switch constructor and route callers to current SaaS behavior, update or remove directly affected fixtures, then remove the singleton registration and `TammaMode.cs`. Build the API and dependent test projects.
5. Run negative startup cases and positive authenticated probes. Canary the SaaS revision with existing healthy instances serving traffic, then roll forward only after readiness and tenant isolation checks.

## Data & Migrations

No schema changes. Use the same logical control-plane database during staged rollout. Any config correction that points at a different database needs explicit operator verification before deployment.

## Events

Reject invalid startup through sanitized host diagnostics. Verify failed startup emits no domain events or tenant provisioning side effects.

## TDD Test Plan

Add the regression assertions against the current implementation, then run them against the cutover behavior.

- Hosted startup fixture with explicit valid Postgres/JWT/KEKs. Knock out each setting independently, test blanks and malformed values, and assert a safe diagnostic before any observed startup side effects.
- Test both environments, prior admin-connection-only config, and explicit legacy mode values. Verify the valid JWT and API-key paths and check that the rendered deployment supplies the required keys.
- Use `dotnet test apps/tamma-elsa/Tamma.sln` and a tracked production symbol sweep to catch DI, endpoint and fixture regressions.

## Definition of Done

| Acceptance criterion | Implementation steps | Verification |
|---|---|---|
| AC 1–2 | 2–3, 5 | Hosted negative matrix and positive readiness probe |
| AC 3 | 1, 4 | Compiling solution and symbol sweep |
| AC 4 | 3, 5 | Sanitized diagnostics and rollout evidence |

## Risks & Mitigations

- **Hidden callers block compilation.** Own the selector sweep in a single coordinated change. Rebase downstream feature edits against it before integration.
- **Explicit binding points at the wrong database.** Verify current CP identity, required migrations and readiness before routing traffic.
- **Two KEKs are confused or leaked.** Validate with the respective parsers, give key-specific diagnostics and use canaries to prove redaction.
