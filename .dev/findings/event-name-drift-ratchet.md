# Event-Name Drift Ratchet (Story 44-5)

## Finding

Before Story 44-5, the Tamma repository had **no automated test enforcing the `AGGREGATE[.SUB].ACTION.STATUS` DCB event-type naming convention** across its ~370 dotted `public const string` event constants (`*Events.cs` / `*EventTypes.cs`).

Compliance rested entirely on reviewer memory. Even `SensitiveActionCatalog` (`apps/tamma-elsa/src/Tamma.Core/Audit/SensitiveActionCatalog.cs:16-28`) explicitly noted that its own accuracy *"was verified by grep at authoring time, not by a test."*

## The Three Near-Miss Tests It Was Mistaken For

During the Epic 44 survey, three existing drift tests were often assumed to guard DCB event naming — none of them did:

1. **`TaxonomyDriftBuildTests`** (`apps/tamma-elsa/tests/Tamma.Activities.Tests/Workflows/TaxonomyDriftBuildTests.cs`) — validates `(role, action)` prompt dispatch pairs on compiled Elsa workflow graphs, not `domain_events` type strings.
2. **`ConventionSeedDriftTests`** (`apps/tamma-elsa/tests/Tamma.Api.Tests/PromptStore/ConventionSeedDriftTests.cs`) — checks prompt/convention seed keysets, not DCB event constants.
3. **`SensitiveActionEmissionCoverageTests`** (`apps/tamma-elsa/tests/Tamma.Api.Tests/Audit/SensitiveActionEmissionCoverageTests.cs`) — verifies emitters for catalogued sensitive audit actions, not naming shape or family completeness across `*Events.cs` / `*EventTypes.cs`.

## Resolution (Story 44-5)

- Added `apps/tamma-elsa/tests/Tamma.Core.Tests/Events/EventTypeNamingRatchetTests.cs` and `KnownEventNameViolations.cs`.
- Every `public const string` containing `.` in any `*Events.cs` / `*EventTypes.cs` under `Tamma.Core`, `Tamma.Activities`, `Tamma.Api`, and `Tamma.Platforms*` must match `^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*){2,3}$` (3 or 4 upper-snake segments) or appear in the shrink-only, `file:line`-annotated, count-pinned allowlist.
- **Baseline seeded:** **87** pre-existing non-conforming constants out of **368** pre-existing dotted constants (plus **23** new compliant Epic 44 constants = **391** total).
- **Staleness guard:** any allowlisted entry that is later fixed or removed fails the build until deleted from `KnownEventNameViolations`.
- **Self-defeat guard (AC9):** no `PROJECT.`, `WORKITEM.`, or `ITERATION.` constant may appear in the allowlist.
- **SSE bus strings out of scope (D8):** lowercase SSE strings in `TaskQueueProcessor.cs` are excluded by the `*Events.cs` / `*EventTypes.cs` filename filter rather than falsely allowlisted.
- **Collision guard (AC10):** `EventFamilyCollisionTests` asserts that no Epic 44 tracker constant reuses any taken prefix (`CYCLE.`, `SPRINT.`, `TASK.`, `ISSUE.`, `ISSUE_STATUS.`).
