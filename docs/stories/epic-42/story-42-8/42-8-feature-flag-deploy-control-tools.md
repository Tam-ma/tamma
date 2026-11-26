# Story 42-8 — SPLIT into 42-8A and 42-8B

Status: superseded by 42-8A + 42-8B (this file is the split index)

## What changed and why

*Corrected: an earlier draft shipped feature-flag toggling and deploy control as **one** story on the
argument that they are "the same governance shape" and "shared plumbing keeps it from being two
separate larges". That argument does not survive contact with the delivery surface.* The two halves
share **no** implementation — they are:

| | Feature flags (42-8A) | Deploy control (42-8B) |
|---|---|---|
| Provider abstraction | `IFeatureFlagProvider` | `IDeployControlProvider` |
| Reference driver | a flag provider | the Docker-Compose-on-Hetzner deploy path |
| Secret binding | `flags/<provider>` (`ApiKey`) | `deploy/<platform>` (`ApiKey` **or** `SigningKey`) |
| Long-op path | **none** — a flag flip is synchronous | an engine-side bookmark wait + authenticated callback |
| Containment / target map | environment map resolved from configuration (`IOptions` interim; SaaS per-tenant config open — see 42-8A) | target map resolved from configuration (`IOptions` interim; SaaS per-tenant config open — see 42-8B) |

That is two provider abstractions, two drivers, two secret bindings, and one suspend path present on
only one side. The only genuinely shared asset is the Wave-1 envelope (42-1/42-4/42-5 + Epic 43
governance) every family inherits anyway, and — with 42-7 — the generic `WaitForToolOperationActivity`.
The combined estimate (~5–6 days, identical to 42-7's *single* provider abstraction) was the tell.

Splitting also lets 42-8A ship independently: it has no engine-side work at all, so it is not gated on
the wait-activity/bookmark/callback-endpoint chain that 42-8B and 42-7 share.

## The two stories

- **[42-8A — Feature-Flag / Config-Toggle Tool](./42-8a-feature-flag-tool.md)** — read/flip feature
  flags and runtime config. No suspend. Medium.
- **[42-8B — Deploy-Control Tool](./42-8b-deploy-control-tool.md)** — trigger / promote / rollback /
  status a release. Suspending (shares 42-7's wait activity). Large.

## Sequencing

Both stay **Wave 3**, both on the reconciled Wave-1 rails (**42-1 → 42-4/42-5**, with Epic 43 governing;
42-2 and 42-3 were superseded by Epic 43 and deleted). Recommended order within the wave:
**42-8A → 42-9 → 42-8B → 42-7** (originally 42-9 → 42-8A → 42-8B → 42-7, adjusted because 42-9 lost its
configuration store with 42-2 while 42-8A is independent, small, and delivers the kill-switch 41-22
needs; see [`implementation-plan.md`](./implementation-plan.md) C2). 42-8B and 42-7 share
`WaitForToolOperationActivity`, its bookmark prefix, its `LifecycleBookmarks.CanonicalSuspendActivities`
registration and its authenticated callback endpoint — whichever lands first ships them; the second
reuses them and adds only its operation `kind`.

## Estimated Effort

This index is a coordination artifact and carries **no implementation effort of its own**. The roll-up for
the two halves, and the shared-asset accounting that makes the naive sum wrong:

| Story | Standalone | If its sibling landed first |
|---|---|---|
| **42-8A** — Feature-Flag / Config-Toggle | **~4–5 days** | — (shares nothing; no engine-side work) |
| **42-8B** — Deploy-Control | **~5–6 days** | **~4 days** (42-7 already shipped `WaitForToolOperationActivity` + its bookmark builder + the `CanonicalSuspendActivities` registration + the authenticated callback endpoint) |

**Pair total: ~9–11 days.** Note that 42-8B shares its wait machinery with **42-7**, not with 42-8A, so the
three suspend-and-flag stories (42-8A + 42-8B + 42-7) total **~14–15 days**, not the ~16–17 that summing
standalone figures would give — the machinery is paid for **once**. See
[`implementation-plan.md`](./implementation-plan.md) C1 for the ledger.
