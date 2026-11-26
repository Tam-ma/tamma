# Story 42-9: Authenticated HTTP / External-API Tool

Status: drafted

## MANDATORY: Before You Code

**ALL contributors MUST read and follow the comprehensive development process:**

[BEFORE_YOU_CODE.md](../../../guides/BEFORE_YOU_CODE.md)

Then check the knowledge base: `.dev/spikes/`, `.dev/bugs/`, `.dev/findings/`, `.dev/decisions/`.

## User Story

As an **agent running a workflow that must reach an external service**, I want a **generic
authenticated HTTP tool** that makes one REST call to a **binding-resolved, host-and-method-allowlisted,
credential-bound** endpoint, so that a stakeholder update, a standup digest, or a docs publish can
actually be posted — without opening a raw egress hole or leaking the credential.

## Priority

P2 / Wave 3 — **ship first among the families.** It unblocks the most Epic 41 workflows (41-5, 41-7,
41-24/25/26 all need "post this artifact somewhere") for the least surface, and it has no engine-side
work at all.

## The gap (READ FIRST)

An agent that produces a stakeholder update (41-5) or a standup digest (41-7) has **no way to deliver
it** — the six built-ins can write a file, commit, and shell, but there is no governed way to POST to
Slack/Jira/a webhook. `ShellExecute` + `curl` is the current de-facto path — unbound, unaudited, and
egress-unbounded (`ActionGate` blocks common `curl | bash` shapes, not egress).

**The SSRF controls this story needs already exist in-repo and must be reused, not re-derived.**
`Tamma.Api/Services/Integrations/JiraBaseUrlGuard` ships `IsBlockedAddress` (loopback, `0.0.0.0/8`,
`10/8`, `127/8`, `169.254/16` incl. cloud metadata, `172.16/12`, `192.168/16`, IPv6 `::`, `fe80::/10`,
`fc00::/7`, with IPv4-mapped-IPv6 unwrapping), a dot-boundary host-suffix allowlist matcher, and
`SafeConnectAsync` — a `SocketsHttpHandler.ConnectCallback` that re-resolves at **connect** time to
close the DNS-rebinding TOCTOU window. It is already wired that way at `Tamma.Api/Program.cs` L185–188
together with `AllowAutoRedirect = false`.

**Two deliberate divergences — both must be built, neither is inherited.**

1. **No allowlist short-circuit.** `JiraBaseUrlGuard.ValidateAsync` **short-circuits on an allowlist
   hit** (L73–81) and skips the private-range check, leaning on connect time alone. This story does
   **not** copy that: the private/loopback/link-local/metadata floor is enforced at validation **and**
   at connect, allowlisted or not. An allowlist entry is a destination, not a bypass.
2. **Connect-time is all-or-nothing, not filter-and-connect.** `SafeConnectAsync` today *filters*:
   `addresses.Where(a => !IsBlockedAddress(a))` and connects to whatever survives, failing only when
   **every** address is blocked. `ValidateAsync` is already all-or-nothing (`addresses.Any(IsBlockedAddress)`
   → reject), so the shipped guard is stricter at validation than at connect. S4's second assertion —
   a host resolving to a mix of public and private addresses is rejected outright — is therefore
   **new behaviour at connect time**, not a property of the helper being reused. Implement it as an
   opt-in strict mode on the extracted guard (`rejectOnAnyBlocked: true`) that this tool sets and the
   JIRA client does not, per the "keep JIRA byte-identical" risk below.

## Where this code lives (binding)

**`HttpRequestTool`, the endpoint resolver, and the guard wiring live in `Tamma.Api`** — package
`Tamma.Api.Services.Tools.Http`, registered next to the six built-ins at `Tamma.Api/Program.cs`
L753–766, with its own named `HttpClient` whose primary handler sets `AllowAutoRedirect = false` and
`ConnectCallback = <the shared SSRF guard>`. Nothing here is added to `Tamma.Activities`.

Reasons, in force order: (1) **rule 1** — a workflow step never calls an external API or holds an
external credential; this tool is nothing but that; (2) **runtime** — `Tamma.ElsaServer/Program.cs`
L286–292 records the tool catalog was *removed* from the engine and "the tool executors are registered
there [`Tamma.Api`], not here", so an engine-side executor is never resolved; (3) **guardrail
backstop** — `TAMMA001` (`DiagnosticSeverity.Error`, analyzer-referenced by `Tamma.Activities` /
`Tamma.ElsaServer`) exists precisely to stop credentialed vendor calls re-entering the engine, and
`Allowlist.IsEngineSurface` deliberately excludes `Tamma.Api`. *Honest scope:* `TAMMA001`'s HTTP check
fires only on an `HttpClient` send whose host is a **statically-resolvable literal external host** —
this tool's host is always dynamic, so it would not mechanically trip. Siting is settled by (1) and
(2); the analyzer is the backstop. Precedent: `GetAcceptanceRulesTool` in
`Tamma.Api.Services.AcceptanceRules`; `Allowlist.cs` L57–58 on `InlineToolLoopRunner`.

Only the 42-1 contract types stay in `Tamma.Activities.LlmCall.Tools`; `ToolOutputHelper`,
`ContentSanitizer` and `ErrorRedactor` are consumed from `Tamma.Activities` (no credential, safe to
reference downward).

## Scope

1. **`HttpRequestTool : IToolExecutor` — one call, one request, no URL from the model.** The tool takes
   an **`endpointKey`** (resolved from server-declared endpoint configuration to a base URI + host
   allowlist + method allowlist + auth mode + header-name allowlist + request/response caps) plus a
   relative `path`, `query`, `body`, and a restricted set of `headers`. There is **no URL parameter in
   `InputSchema`**. The composed absolute URI is built server-side from the declared endpoint entry; an
   unknown or missing `endpointKey` is refused (`Success = false`, zero sends), and the model
   contributes only what §S6–S8 permit. *(Per-call `PermissionClass` and `ToolInvocationFacts
   Describe(...)` were stripped under Epic 43 reconciliation — 42-3 is deleted and Epic 43's Seam B
   governs `http_request` via the Action Catalog with zero bespoke gating code here. Story 42-2 was
   superseded and deleted; see "Configuration: open question" below for where endpoint configuration
   now lives.)*

2. **Secret binding.** `SecretRequirement(SecretPurpose.ApiKey, "http/<endpoint-key>", Required)` —
   `SecretPurpose` being the `Tamma.Core`-sited enum 42-1 §0 relocates. Resolved by 42-4 to
   **`SecretRef.ForTenant(runTenantId, name)` in SaaS** and **`SecretRef.ForPlatform(name)` in
   single-user**. *Corrected: an earlier draft said "user-scoped in single-user" — there is no user
   scope; `SecretScope` has exactly `Platform` and `Tenant`, `SecretRef`'s constructor throws on either
   mismatch, and the sole user's ownership is `SecretMetadata.OwnerUserId` metadata.* The credential is
   applied at call time in the declared auth mode (header / bearer / basic) and never echoed anywhere
   (§S10).

3. **Response handling.** Read under a hard byte cap, then `ToolOutputHelper.Truncate`
   (`MaxOutputBytes` = 50 KB) — the cap is enforced on the **stream**, not on a `Content-Length` the
   server declares. Honor the per-tool timeout via the `ParallelToolExecutor` linked-CTS
   (`CancelAfter(toolTimeoutMs)`) pattern. A non-2xx (including a 3xx, since redirects are not followed)
   is a normal `ToolExecutionResult` with `Success = false` and the redacted status/body — never a throw.

4. **Docs-publish note.** For 41-24/25/26 "publish", delivery is often either a git push (existing
   `GitOperationsTool` to the wiki repo) **or** an HTTP POST to a docs host — this tool covers the HTTP
   flavor; the git flavor already exists. The workflow declares whichever it needs.

## Configuration: open question

- **What configuration this story needs:** the **destination / host allowlist** and per-endpoint
  settings (base URI, host-suffix allowlist, method allowlist, auth mode, header-name allowlist,
  request/response caps).
- **Why it has no store today:** Story 42-2 (`tool_bindings` / `ConfigJson`) was superseded by Epic 43
  and deleted. Epic 43's `action_assignments` absorbs policy only (thresholds and flags) — deliberately,
  because it is a governance table and not a settings store. Without `ConfigJson`, this tool has no
  per-principal destination store.
- **Interim resolution:** deployment configuration via `IOptions` (platform-scoped, validated fail-loud
  at startup), which is sufficient for single-user mode and for a single-tenant deployment.
- **Unresolved product gap (SaaS):** **per-tenant tool configuration in SaaS is genuinely lost and
  unresolved.** `IOptions` is process-wide, so two tenants cannot configure different destination
  allowlists or endpoints. Restoring per-tenant configuration requires an explicit product decision
  before this story is implemented: either introduce a narrow `tool_configuration` table (config only,
  no policy — explicitly *not* a second governance store) or accept that tool configuration is
  deployment-scoped in v1. `IOptions` is an interim workaround, **not** a closed answer.

## Acceptance Criteria

1. `HttpRequestTool` is registered in `Tamma.Api` declaring 42-1's abstract `ToolDescriptor`:
   `Suspends = false`, with `SecretRequirement(ApiKey, "http/<endpoint-key>", Required)`.
2. **Closed endpoint lookup.** An unknown, missing, or malformed `endpointKey` returns `Success = false`
   with **zero** `HttpClient` sends on a spy handler.
3. Credential scoping: SaaS resolves `SecretRef.ForTenant(runTenantId, name)`, single-user resolves
   `SecretRef.ForPlatform(name)`; constructing a `Tenant`-scoped ref with a null tenant id throws.
4. Non-2xx yields `Success = false` with redacted status/body; a per-tool timeout yields
   `Success = false` + `TOOL.FAILED`; a transport exception yields `Success = false` — the test asserts
   `ExecuteAsync` **returns** rather than propagating (never-throw contract).
5. `TOOL.*` rows carry `endpointKey` / `method` / composed-path / `statusCode` / request-body byte size
   / body digest and never the URL query string verbatim, never a header value, never the credential.

### Acceptance criteria — SSRF / egress containment

*These are the story. Each is a separate falsifiable test; "the allowlist contains it" is not a control
by itself.*

- **S1 — No model-supplied destination.** The published `InputSchema` contains no field accepting a
  scheme, host, authority, or absolute URI. An argument object carrying `url` / `baseUrl` / `origin` is
  rejected with `Success = false` and **zero** sends on a spy handler.
- **S2 — Scheme + host allowlist.** The declared endpoint's base URI must be `https`; the resolved host
  must match a declared host-suffix entry by **exact or dot-boundary** match (`evilatlassian.net` must
  **not** match `.atlassian.net`). A host outside the allowlist is rejected loudly, before any DNS or
  socket work.
- **S3 — Address denial, unconditional.** Table-driven per range: `127.0.0.1`, `::1`, `0.0.0.0`,
  `10.x`, `172.16–31.x`, `192.168.x`, `169.254.169.254` (cloud metadata), `fe80::/10`, `fc00::/7`, and
  an IPv4-mapped IPv6 form of each — rejected whether supplied as a literal host or reached by DNS, and
  **including when the host is allowlisted**. A test pins the divergence from
  `JiraBaseUrlGuard.ValidateAsync`'s allowlist short-circuit (L73–81): the floor is not skipped here.
- **S4 — Resolve-then-pin (DNS rebinding).** The socket connects only to an address re-checked at
  connect time via the shared `ConnectCallback`. A test with a resolver returning a public address at
  validation and a private one at connect asserts the connection **fails** and no bytes are sent. A
  second test asserts a host resolving to a mix of public and private addresses is rejected outright
  (partial-private is treated as hostile), not silently connected to the public one — this is
  divergence 2 above and is **new** connect-time behaviour: the shipped `SafeConnectAsync` filters the
  blocked addresses out and connects to the survivors, so a test written against the helper as-is
  would pass while the requirement is unmet. A third test pins that the JIRA client keeps the
  filtering behaviour (the strict mode is opt-in, not a global tightening).
- **S5 — Redirects are never followed.** `AllowAutoRedirect = false` (the `Program.cs` L185–188
  pattern). A stub returning `302 Location: http://169.254.169.254/…` yields `Success = false` with the
  3xx status, and the spy handler records exactly **one** send — the `Location` is never fetched, and it
  is redacted out of the returned body.
- **S6 — Path/query containment.** The model's `path`/`query` are appended to the declared endpoint's
  base path and may not escape it. Rejected: `..` segments, a leading `/` that would replace the base
  path, an absolute URI, a scheme-relative `//evil.example`, userinfo (`user@host`), backslashes,
  control characters and CR/LF, and any percent- or double-encoded form that decodes to one of those.
  The test asserts the **composed absolute URI's** scheme, host, port and base-path prefix are
  byte-identical to the declared endpoint's for every input in the table.
- **S7 — Header restrictions.** Model-supplied headers are limited to a per-endpoint **name allowlist**.
  Unconditionally refused regardless of allowlist: `Host`, `Authorization`, `Proxy-*`, `Cookie`,
  `Cookie2`, and any header name the endpoint's auth mode sets. Header **values** containing CR, LF, or
  NUL are rejected, not sanitized. A test asserts a model attempt to override `Host` (virtual-host
  routing to an internal service) and to inject a second `Authorization` both fail with zero sends.
- **S8 — Method restriction.** Only methods in the endpoint's method allowlist are sent; a method
  outside it is rejected with zero sends. A GET/HEAD-only endpoint rejects a POST attempt with zero
  sends.
- **S9 — Size and time caps, both directions.** The request body is capped by the endpoint config
  (default small) and an over-cap body is rejected **before** the send. The response is read under a
  hard byte cap enforced on the stream: a stub that declares `Content-Length: 10` and then streams 10 MB
  is cut at the cap, and the result is truncated by `ToolOutputHelper.Truncate` with its
  `[truncated: …]` marker. The per-tool timeout cancels an unresponsive endpoint via the linked CTS.
- **S10 — The credential never leaves.** Redaction is **by value** — the resolved secret string is
  replaced in the body, headers-echo, status text, and any error message at the `ExecuteAsync`
  boundary, *in addition to* `ToolOutputHelper.RedactSecrets`. *This does **not** contradict 42-4 §3 /
  42-5 §3, which retire value-matching at the **audit** boundary: by-value scrubbing happens **here**,
  inside the executor, which legitimately holds the plaintext because it just authenticated with it,
  and it happens **before** `ExecuteAsync` returns. Nothing downstream — the 42-5 emitter, the DCB
  row, Epic 43's `ACTION.GATE.*` audit, the log — is ever handed the value, so downstream stays
  never-hold + pattern-only. The rule is "by-value at the `ExecuteAsync` boundary, never-hold after
  it"; an implementer must not "simplify" by passing the credential outward to redact later.* This is
  load-bearing: `RedactSecrets` is **pattern-based** (`sk-…`, `AKIA…`, `gh[pousr]_…`, `glpat-…`,
  `xox[bp]-…`, JWT, PEM, `Password=`) and matches **no** arbitrary bound token. The test uses a random
  40-char token, has the stub reflect it in the body **and** in a response header, and greps for that
  literal value across `ToolExecutionResult.Output`, every emitted `TOOL.*` payload, and all captured
  log lines.
- **S11 — Exfiltration to an *allowlisted* destination is bounded and auditable, not prevented.**
  *Stated honestly: the host allowlist constrains **who** receives data, not **what** is sent. A
  prompt-injected agent can still POST repository content to a legitimately bound Slack webhook. No
  control in this story stops that, and the story must not claim otherwise.* What is asserted:
  1. the request-body cap (S9) bounds a single exfiltration to the endpoint's configured size;
  2. every call emits `TOOL.INVOKED` carrying `endpointKey`, method, composed path, request-body **byte
     size** and a **content digest** (never the body), so an anomalous volume/pattern is reconstructible
     after the fact — a test asserts the digest and size are present and the body is not;
  3. tool arguments pass through `ContentSanitizer.SanitizeInput` before composition, so injected
     control/bidi/zero-width payloads are stripped.
  *(Honest note on removed pre-reconciliation clause S11.3: an earlier draft allowed a `destructive: true`
  binding to carry the redacted body into a 42-3 `ToolAuthorizationRequest` for human content review.
  42-3 was deleted, and Epic 43's Seam B returns `Denied` — not `RequiresHuman` — because there is no
  human wait on the tool-loop path. Seam B can stop the call, but there is no human content-review
  affordance here; S11's residual is correspondingly wider.)*
  Residual, recorded not solved: a single in-cap POST to an allowlisted destination is indistinguishable
  from legitimate use at call time.

## Events

Reuses 42-5 `TOOL.*` with `endpointKey` / `method` / composed-path / `statusCode` / request-byte-size /
body-digest tags (never a query string verbatim, never a header value, never auth). Governance decisions
emit Epic 43's `ACTION.GATE.*`. No new family, and no engine-side emission — everything here runs in
`Tamma.Api`, which appends directly to `IEventRepository`.

## Single-user vs SaaS

- **single-user:** the sole user's declared endpoints; the credential is a **platform-scoped** secret
  (`SecretRef.ForPlatform`) owned via `SecretMetadata.OwnerUserId`, and the user owns the host allowlist.
- **SaaS:** tenant-scoped credentials (`SecretRef.ForTenant(runTenantId, …)`) and tenant-scoped
  governance via Epic 43 `action_assignments`. *(Per-tenant endpoint/allowlist bindings are currently
  lost with 42-2's `ConfigJson` — see "Configuration: open question" above.)*

## Epic 41 consumers

**41-5** (stakeholder / status update → post to Slack/Jira/email webhook), **41-7** (standup digest
publish), **41-24/25/26** (docs / release-notes / runbook publish, HTTP flavor), and any future
integration workflow — the most broadly-consumed family in the epic.

## Dependencies

- **Product decision (blocking before implementation):** resolve the `ConfigJson` open question above
  (narrow `tool_configuration` table vs deployment-scoped `IOptions` in v1).
- **42-1** — `ToolDescriptor(RequiredSecret, Suspends)`; the `Tamma.Core`-sited `SecretPurpose` (§0);
  and §3's restriction of dynamic `Register` to platform scope.
- **Epic 43 (Action Catalog + Seam B)** — owns risk classification, autonomy thresholds, per-principal
  assignments, and enforcement for `http_request`. *(42-2 and 42-3 were superseded by Epic 43 and
  deleted; 42-3's siting analysis and effective-ceiling insight were transplanted into Epic 43
  Story 43-9.)*
- **42-4** — auth secret. *Corrected: an earlier draft called this "hard-blocked on the Epic 29 reveal
  path". It is not — four runtime plaintext readers already ship and 42-4 generalizes them. The residual
  dependency is a non-null `ISecretAccessAuditor`; only `NullSecretAccessAuditor` is registered today.*
- **42-5** — `TOOL.*` audit + redaction.
- **Existing, reused not rebuilt:** `JiraBaseUrlGuard.IsBlockedAddress` / `SafeConnectAsync` and the
  `AllowAutoRedirect = false` handler wiring (`Program.cs` L185–188) — extract the guard to a shared
  `Tamma.Api` SSRF helper rather than copying it; `ToolOutputHelper.Truncate` (50 KB) and
  `RedactSecrets` (pattern-based — see S10); the `ParallelToolExecutor` linked-CTS timeout;
  `ContentSanitizer` / `ErrorRedactor`.
- **`Tamma.Activities` holds no external credential** and carries the `TAMMA001` analyzer; no code from
  this story is added to it. This story adds **nothing** engine-side.
- **Epic 41** 41-5 / 41-7 / 41-24/25/26 consumers.

## Risks

- **Extracting the guard touches a shipped path.** Refactoring `JiraBaseUrlGuard` into a shared helper
  changes the JIRA client's wiring. Keep the JIRA behaviour byte-identical (including its allowlist
  short-circuit) and add the stricter mode as an opt-in this tool sets, rather than tightening JIRA in
  the same change.
- **Response-reflected and log-reflected secrets.** Covered by S10's by-value redaction; the residual is
  a credential the endpoint transforms (base64, a hash) before echoing it, which value-matching cannot
  catch. Mitigation: the endpoint config declares the auth header/field name so it is dropped
  structurally, not only matched.
- **Exfiltration through an allowlisted destination is unsolved** (S11). Bounded by the request cap and
  auditable via digest + size; not prevented. Anyone reading this story should not treat the host
  allowlist as an anti-exfiltration control.

## Estimated Effort

Medium–Large. ~4–5 days — the tool itself is small; the S1–S11 containment matrix, the guard extraction,
and by-value redaction carry the weight.
