# Tamma Project Roadmap

10-week MVP timeline to achieve self-maintenance capability.

## Epic Overview

| Epic | Name | Duration | Stories | MVP Priority | Status |
|------|------|----------|---------|--------------|--------|
| **Epic 1** | Foundation & Core Infrastructure | Weeks 0-2 | 13 | Critical | Completed |
| **Epic 1.5** | Deployment, Packaging & Operations | Weeks 2-3 | 6 | Critical | Pending |
| **Epic 2** | Autonomous Development Loop | Weeks 2-4 | 12 | Critical | Pending |
| **Epic 3** | Quality Gates & Intelligence | Weeks 4-6 | 8 | Critical | Pending |
| **Epic 4** | Event Sourcing & Audit Trail | Weeks 6-8 | 6 | Critical | Pending |
| **Epic 5** | Observability & Production Readiness | Weeks 8-10 | 7 | Critical | Pending |
| **Epic 9** | Config-Driven Multi-Agent Management | Concurrent | 11 | Critical | Completed |

---

## Epic 1: Foundation & Core Infrastructure (Weeks 0-2)

**Goal:** Establish the foundational abstractions for AI providers and Git platforms.

**Status: Completed**

### Milestones

- [GitHub Milestone: Epic 1](https://github.com/meywd/tamma/milestone/1)
- [View all Epic 1 Issues](https://github.com/meywd/tamma/issues?q=is%3Aissue+milestone%3A%22Epic+1%3A+Foundation+%26+Core+Infrastructure%22)

### Stories (13 total, 86 tasks)

1. **Story 1-0:** AI Provider Strategy Research (6 tasks)
2. **Story 1-1:** AI Provider Interface Definition (5 tasks)
3. **Story 1-2:** Claude Code Provider Implementation (6 tasks)
4. **Story 1-3:** Provider Configuration Management (7 tasks)
5. **Story 1-4:** Git Platform Interface Definition (6 tasks)
6. **Story 1-5:** GitHub Platform Implementation (8 tasks)
7. **Story 1-6:** GitLab Platform Implementation (6 tasks)
8. **Story 1-7:** Git Platform Configuration Management (5 tasks)
9. **Story 1-8:** Hybrid Orchestrator/Worker Architecture Design (7 tasks)
10. **Story 1-9:** Basic CLI Scaffolding with Mode Selection (5 tasks)
11. **Story 1-10:** Additional AI Provider Implementations (10 tasks)
12. **Story 1-11:** Additional Git Platform Implementations (7 tasks)
13. **Story 1-12:** Initial Marketing Website (8 tasks)

[Detailed Epic 1 Breakdown](Epic-1-Foundation)

---

## Epic 9: Config-Driven Multi-Agent Management (Concurrent)

**Goal:** Replace hardcoded single-agent setup with a config-driven multi-agent system where each role gets an ordered provider chain, circuit breaker health tracking, diagnostics, content sanitization, and role-based resolution.

**Status: Completed**

### Key Deliverables

- Configuration schema for multi-agent provider chains (`@tamma/shared`)
- Provider diagnostics and instrumented agent provider decorator (`@tamma/providers`)
- Circuit breaker health tracker per provider+model (`@tamma/providers`)
- Agent provider factory with built-in and custom provider registration (`@tamma/providers`)
- Provider chain with fallback, budget checks, and health gating (`@tamma/providers`)
- Prompt template registry with 6-level resolution chain (`@tamma/providers`)
- Content sanitization (HTML stripping, zero-width char removal, injection detection) (`@tamma/shared`)
- URL validator with numeric octet parsing and SSRF protection (`@tamma/shared`)
- Action gating for autonomous command execution (`@tamma/shared`)
- Secure fetch wrapper with redirect re-validation (`@tamma/shared`)
- Role-based agent resolver integrating all subsystems (`@tamma/providers`)
- Diagnostics queue (synchronous emit, timer-based batch drain) (`@tamma/shared`)
- MCP tool interceptor chain with built-in sanitization and URL validation interceptors (`@tamma/mcp-client`)
- Engine integration wiring resolver into the autonomous loop (`@tamma/orchestrator`)
- CLI configuration wiring for multi-agent config loading (`@tamma/cli`)

### Stories (11 total)

| Story | Title | Priority |
|-------|-------|----------|
| 9-1 | Configuration Schema | P0 |
| 9-2 | Provider Diagnostics | P0 |
| 9-3 | Provider Health Tracker | P0 |
| 9-4 | Agent Provider Factory | P0 |
| 9-5 | Provider Chain | P0 |
| 9-6 | Agent Prompt Registry | P1 |
| 9-7 | Content Sanitization | P1 |
| 9-8 | Role-Based Agent Resolver | P0 |
| 9-9 | Engine Integration | P0 |
| 9-10 | CLI Wiring | P0 |
| 9-11 | Diagnostics Queue & MCP Interceptors | P0 |

[Detailed Epic 9 Breakdown](Epic-9-Agent-Management)

---

## Epic 1.5: Deployment, Packaging & Operations (Weeks 2-3)

**Goal:** Package Tamma for distribution and operational use.

### Key Deliverables

- Docker containers for orchestrator and worker modes
- npm package for CLI distribution
- Kubernetes manifests for production deployment
- CI/CD pipelines (GitHub Actions)
- Installation documentation

[GitHub Milestone: Epic 1.5](https://github.com/meywd/tamma/milestone/2)

---

## Epic 2: Autonomous Development Loop (Weeks 2-4)

**Goal:** Implement the core autonomous development workflow.

### Key Deliverables

- Issue analysis and planning service
- Code generation service with TDD workflow
- Test generation and execution service
- Code review and quality gate service
- PR creation and management service
- Autonomous loop orchestrator (70%+ completion rate)

[GitHub Milestone: Epic 2](https://github.com/meywd/tamma/milestone/3)

---

## Epic 3: Quality Gates & Intelligence (Weeks 4-6)

**Goal:** Add intelligence layers for decision-making and quality assurance.

### Key Deliverables

- Mandatory escalation service (user approval for critical decisions)
- Ambiguity detection and clarification service
- Quality gate enforcement service
- Test coverage and security scanning
- Performance regression detection

[GitHub Milestone: Epic 3](https://github.com/meywd/tamma/milestone/4)

---

## Epic 4: Event Sourcing & Audit Trail (Weeks 6-8)

**Goal:** Implement complete transparency via Development Context Bus (DCB).

### Key Deliverables

- DCB event bus (PostgreSQL + event store)
- Event sourcing for all state mutations
- Audit trail UI for transparency
- Replay and debugging capabilities
- Event-driven integration patterns

[GitHub Milestone: Epic 4](https://github.com/meywd/tamma/milestone/5)

---

## Epic 5: Observability & Production Readiness (Weeks 8-10)

**Goal:** Add monitoring, observability, and production hardening.

### Key Deliverables

- Prometheus metrics and Grafana dashboards
- OpenTelemetry distributed tracing
- Structured logging with log aggregation
- Health checks and graceful degradation
- Chaos engineering validation
- Load testing and performance optimization

[GitHub Milestone: Epic 5](https://github.com/meywd/tamma/milestone/6)

---

## Alpha Launch (Week 10)

**Goal:** Self-Maintenance Validation

### Success Criteria

1. Tamma successfully processes 10+ real Tamma issues autonomously
2. 70%+ completion rate without human intervention
3. All quality gates enforced (no broken changes merged)
4. Complete audit trail for all autonomous actions
5. Production monitoring and observability operational

### Launch Activities

- Internal dogfooding (Tamma maintains itself)
- Alpha user onboarding (selected early adopters)
- Documentation and tutorial creation
- Performance and reliability validation
- Community launch preparation

---

## Timeline Visualization

```
Weeks 0-2:  Epic 1  (Foundation)              [COMPLETED]
Concurrent: Epic 9  (Multi-Agent Management)  [COMPLETED]
Weeks 2-3:  Epic 1.5 (Deployment/Packaging)   [Pending]
Weeks 2-4:  Epic 2  (Autonomous Loop)         [Pending]
Weeks 4-6:  Epic 3  (Quality Gates)           [Pending]
Weeks 6-8:  Epic 4  (Event Sourcing)          [Pending]
Weeks 8-10: Epic 5  (Observability)           [Pending]
Week 10:    Alpha Launch
```

---

## Key Success Metrics

- **Autonomous Completion Rate:** 70%+ (target)
- **Time to Resolution:** <24 hours for most issues
- **Quality Gate Pass Rate:** 95%+ (mandatory escalation for failures)
- **System Uptime:** 99.5%+ (orchestrator mode)
- **Test Coverage:** 80%+ line coverage, 75%+ branch coverage

---

_For detailed technical specifications, see [Tech Spec Epic 1](https://github.com/meywd/tamma/blob/main/docs/tech-spec-epic-1.md) through [Tech Spec Epic 5](https://github.com/meywd/tamma/blob/main/docs/tech-spec-epic-5.md)._
