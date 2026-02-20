# MVP Status & Gap Analysis

> Canonical status document for the `feat/engine-mvp` PR.
> Updated: 2026-02-12

## PR Scope: 10 MVP Stories — All Complete

| Story | Title | Status | Tests |
|-------|-------|--------|-------|
| 1.5-1 | Core Engine Separation | 100% | 32 unit + integration |
| 1-2 | Claude Code Provider | 100% | 24 unit + integration |
| 1-5 | GitHub Platform | 100% | 24 unit + integration |
| 2.1 | Issue Selection with Filtering | 100% | Covered in engine tests |
| 2.2 | Issue Context Analysis | 100% | Covered in engine tests |
| 2.3 | Plan Generation + Approval | 100% | Covered in engine tests |
| 2.4 | Git Branch Creation | 100% | Covered in engine tests |
| 2.6 | Implementation Code Generation | 100% | Covered in engine tests |
| 2.8 | Pull Request Creation | 100% | Covered in engine tests |
| 2.10 | PR Merge + Completion | 100% | Covered in engine tests |

## Test Results (This PR's Packages)

```
providers:    93/93 pass  (5 files)
cli:          92/92 pass  (7 files)
platforms:    58/58 pass  (4 files, including new error-mapper)
orchestrator: 44/44 pass  (1 file)
shared:       32/32 pass  (3 files)
observability: 6/6 pass  (1 file)
────────────────────────────────────
TOTAL:       325/325 pass
```

Pre-existing failures in Epic 6 packages (15 tests across gates, intelligence,
scrum-master, mcp-client) are unrelated to this PR.

## E2E Testing Feasibility

**Can E2E be done?** Yes, with environment setup:

| Test Type | Requirements | Exists? |
|-----------|-------------|---------|
| Unit tests | None | Yes — 233 passing |
| Integration (Claude) | `INTEGRATION_TEST_CLAUDE=true` + `claude` binary | Conditional skip |
| Integration (GitHub) | `GITHUB_TOKEN` env var + test repo | Conditional skip |
| Integration (Engine) | `INTEGRATION_TEST_ENABLED=true` | Conditional skip |
| Full E2E pipeline | Real GitHub repo + labeled issue + Claude auth | **Not yet written** |

**What's needed for E2E:**
1. A test GitHub repository with a pre-labeled issue
2. Claude CLI authenticated
3. A test script that runs: `engine.processOneIssue()` → verifies PR created → verifies merge
4. Teardown: close issue, delete branch, close PR

**Recommended approach**: Add `packages/orchestrator/src/engine.e2e.test.ts` gated
behind `E2E_TEST_ENABLED=true`. Uses real GitHub + real Claude. Estimated effort: 2-3 hours.

## What's Missing for User Interaction

### CLI Mode (Story 1-9, 1.5-2)

The `@tamma/cli` package provides an Ink-based interactive CLI.

| Feature | Status | Story |
|---------|--------|-------|
| `tamma init` wizard | **Implemented** — preflight, config, .env, post-checks | 1.5-2 |
| `tamma start` command | **Implemented** — config loading, engine boot, log streaming | 1-9 |
| `tamma status` command | **Implemented** — basic engine state display | 1-9 |
| `tamma stop` command | Not started | 1-9 |
| Config file loading (`tamma.config.json`) | **Implemented** — layered merge (defaults → file → env → CLI flags) | 1.5-2 |
| `.env` credential management | **Implemented** — init writes `.env` with `0o600`, dotenv loads at startup | 1.5-2 |
| Interactive plan approval (Ink UI) | **Implemented** — approve/reject/edit in TUI | 2.3 (done) |
| Plan rejection with feedback | Not started | 2.3 extension |

### Web/API Mode (Story 1.5-3, 1.5-4)

| Feature | Status | Story |
|---------|--------|-------|
| REST API for engine control | Not started | 1.5-4 |
| WebSocket for real-time progress | Not started | 5-3 |
| Dashboard integration | Not started | 5-3, 5-4 |
| Authentication / API keys | Not started | 1.5-4 |

### Observability (Story 5-1 through 5-6)

| Feature | Status | Story |
|---------|--------|-------|
| Structured logging (Pino) | 30% — basic wrapper | 5-1 |
| Correlation IDs in logs | Not started | 5-1 |
| Metrics collection | Not started | 5-2 |
| Real-time dashboard | Not started | 5-3, 5-4 |
| Alert system | Not started | 5-6 |

### What a User Can Do Today

1. Run `tamma init` — wizard collects GitHub token, Anthropic API key, repo, model, approval mode
2. Wizard writes `tamma.config.json` (no secrets) and `.env` (credentials, mode 0600)
3. `.gitignore` is updated automatically (`.tamma/`, `.env`)
4. Run `tamma start` — config loaded from file + `.env` + env vars + CLI flags
5. Engine polls for labeled issues, generates plan, Ink-based approval UI
6. On approval: implements code, creates PR, monitors CI, merges
7. Loops to next issue

**What they can't do:**
- No `tamma stop` command (Ctrl-C only)
- No way to skip/defer an issue
- No dashboard or web UI
- No cost reports or budget alerts
- No multi-repo support

---

## Complete Mock/Stub Inventory

### Placeholder Packages (0% implemented)

| Package | Purpose | Story |
|---------|---------|-------|
| `@tamma/events` | Event sourcing | Epic 4 |
| `@tamma/workers` | Background job workers | 1-8 |

### Provider Factory Stubs (throw "not yet implemented")

9 providers in `packages/providers/src/factory.ts` — all Story 1-10.

### Vector Store Stubs (throw ProviderNotImplementedError)

| Store | File | Methods Stubbed |
|-------|------|-----------------|
| Pinecone | `intelligence/src/vector-store/providers/pinecone.ts` | 17 |
| Qdrant | `intelligence/src/vector-store/providers/qdrant.ts` | 17 |
| Weaviate | `intelligence/src/vector-store/providers/weaviate.ts` | 17 |

### Service Stubs (return empty/mock data)

| Service | File | Behavior | Story |
|---------|------|----------|-------|
| Web search source | `intelligence/src/context/sources/web-search-source.ts` | Returns `[]` | None |
| Slack alerts (scrum-master) | `scrum-master/src/services/alert-manager.ts:147` | No-op | None |
| Email alerts (scrum-master) | Same file, line 150 | No-op | None |
| Email alerts (cost-monitor) | `cost-monitor/src/alert-manager.ts:115` | Logs intent only | None |

### ELSA App Mocks (separate .NET codebase, no story coverage)

| Service | What's Mocked | What's Needed |
|---------|---------------|---------------|
| `ElsaWorkflowService` | All methods return fake data | Connect to ELSA server API |
| `IntegrationService` — GitHub | Fake PR URLs, branches | Octokit.NET integration |
| `IntegrationService` — JIRA | Fake ticket data | JIRA REST API |
| `IntegrationService` — Slack | Console.log instead of send | Slack webhook |
| `IntegrationService` — CI/CD | Fake build status | GitHub Actions API |
| `ClaudeAnalysisActivity` | Simulated AI analysis | Claude HTTP API calls |
| `AnalyticsService` | Skeleton with TODOs | Metrics persistence + algorithms |

---

## Story Coverage Map — Not In PR Scope

### Has Story, Not Started

| Story | Title | Epic | Blocks |
|-------|-------|------|--------|
| 1-3 | Provider Configuration Management | 1 | Multi-provider setup |
| 1-6 | GitLab Platform | 1 | GitLab users |
| 1-9 | CLI Scaffolding | 1 | User interaction |
| 1-10 | Additional AI Providers | 1 | LLM diversity |
| 1.5-2 | CLI Mode + Config Mgmt | 1.5 | Config files |
| 1.5-3 | Service Mode | 1.5 | Deployment |
| 1.5-5 | Docker Packaging | 1.5 | Containers |
| 2-5 | Test-First Development | 2 | TDD workflow |
| 2-9 | PR Status Monitoring (full) | 2 | CI retry logic |
| 2-12 | Intelligent Provider Selection | 2 | Multi-provider routing |
| 3-1 to 3-12 | Quality Gates | 3 | Code quality enforcement |
| 4-1 to 4-8 | Event Sourcing | 4 | Audit trail |
| 5-1 to 5-10 | Observability + Docs | 5 | Monitoring, docs |
| 6-1 to 6-10 | Context & Knowledge | 6 | RAG, indexing (code exists on branch) |

### No Story Exists

| Item | What It Is | Recommendation |
|------|-----------|----------------|
| `apps/tamma-elsa/` | .NET 8.0 ELSA mentorship engine | Create dedicated epic or document as separate project |
| `apps/doc-review/` | React document review app (29K LOC) | Separate project, not Tamma engine scope |
| `apps/test-platform/` | Test infrastructure (6.7K LOC) | Internal tooling, no story needed |
| `apps/marketing-site/` | Cloudflare Workers marketing site | Separate, covered by Story 1-12 |
