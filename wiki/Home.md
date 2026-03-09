# Welcome to the Tamma Wiki

**Tamma** is an autonomous development platform that maintains itself. This wiki provides comprehensive documentation for understanding, contributing to, and using Tamma.

## Quick Links

- [Project Roadmap](Roadmap) - Epic breakdown and timeline
- [Epic 1: Foundation](Epic-1-Foundation) - Core infrastructure (86 tasks)
- [Epic 9: Agent Management](Epic-9-Agent-Management) - Config-driven multi-agent system
- [Stories](Stories) - Detailed story documentation
- [Architecture](Architecture) - System architecture overview
- [Contributing](Contributing) - How to contribute to Tamma
- [GitHub Issues](https://github.com/meywd/tamma/issues) - Track progress

## What is Tamma?

Tamma is an **autonomous development platform** designed to achieve **70%+ autonomous completion** of software development tasks without human intervention. The platform's ultimate goal is **self-maintenance** - Tamma will maintain its own codebase.

### Key Features

- **Autonomous Development Loop** - 70%+ completion rate without human intervention
- **Multi-Provider Flexibility** - 8 AI providers, 7 Git platforms, no vendor lock-in
- **Config-Driven Multi-Agent System** - Role-based agent selection with provider chains, fallback, and circuit breakers
- **Production-Ready Security** - Content sanitization, URL validation, action gating, and SSRF protection
- **Diagnostics Pipeline** - Per-provider cost, token, latency, and error tracking
- **Self-Maintenance** - Tamma maintains its own codebase (MVP validation goal)

### Architecture Highlights

- **Hybrid Orchestrator/Worker Architecture** - Stateful coordinator + stateless workers
- **Interface-Based Provider Abstraction** - Swap AI providers (Claude, GPT-4, Gemini, local LLMs)
- **Platform-Agnostic Git Integration** - GitHub, GitLab, Gitea, Forgejo, Bitbucket, Azure DevOps
- **Event Sourcing and Audit Trail** - Complete transparency via DCB (Development Context Bus)
- **Role-Based Agent Resolution** - Workflow phases map to agent roles; each role has an ordered provider chain
- **Defense-in-Depth Security** - Content sanitization at prompt and output boundaries, secure fetch with SSRF protection

## Current Status

**Phase:** Active Implementation
**Completed Epics:** Epic 1 (Foundation), Epic 9 (Config-Driven Multi-Agent Management)
**In Progress:** Engine integration and CLI wiring

View [Open Issues on GitHub](https://github.com/meywd/tamma/issues)

## Getting Started

1. Read the [Architecture](Architecture) overview
2. Review the [Roadmap](Roadmap) to understand the project timeline
3. Check out [Epic 1](Epic-1-Foundation) to see foundational work
4. See [Epic 9](Epic-9-Agent-Management) for the multi-agent system
5. Visit [Contributing](Contributing) to learn how to help

## Documentation

All technical documentation is maintained in the [/docs](https://github.com/meywd/tamma/tree/main/docs) directory:

- [PRD](https://github.com/meywd/tamma/blob/main/docs/PRD.md) - Product requirements
- [Architecture](https://github.com/meywd/tamma/blob/main/docs/architecture.md) - Technical architecture
- [Epics](https://github.com/meywd/tamma/blob/main/docs/epics.md) - Epic breakdown
- [Tech Specs](https://github.com/meywd/tamma/tree/main/docs) - Technical specifications per epic
- [Stories](https://github.com/meywd/tamma/tree/main/docs/stories) - User story documentation

---

_Last updated: 2026-03-09 | Maintained by: meywd & Bob (Scrum Master AI)_
