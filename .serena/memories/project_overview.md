# Tamma Project Overview

## Purpose
Tamma ("It's Done") is an AI-powered autonomous development orchestration platform. It aims to take GitHub issues and produce merged PRs without human intervention.

## Current Status
**Pre-development phase** - Architecture and specifications are complete, but working code implementation is just beginning.

## Tech Stack
- **Runtime**: Node.js 22 LTS
- **Language**: TypeScript 5.7+
- **Database**: PostgreSQL 17 (event sourcing)
- **API Framework**: Fastify 5.x
- **Package Manager**: pnpm 9.x with workspaces
- **Testing**: Vitest
- **Build**: esbuild

## Architecture
- **Pattern**: Dynamic Consistency Boundary (DCB) with event sourcing
- **Modes**: Standalone CLI or distributed orchestrator/worker setup
- **Multi-provider**: Supports Claude, OpenAI, GitHub Copilot, and other AI providers
- **Platform agnostic**: GitHub, GitLab, and self-hosted Git support

## Monorepo Structure

### Packages (`packages/`)
- `api` - API layer
- `cli` - Command-line interface
- `dashboard` - Web dashboard
- `events` - Event sourcing
- `gates` - Quality gates
- `intelligence` - AI intelligence layer
- `observability` - Logging and metrics
- `orchestrator` - Task orchestration
- `platforms` - Git platform integrations
- `providers` - AI provider abstractions
- `shared` - Shared utilities
- `workers` - Distributed workers

### Apps (`apps/`)
- `tamma-engine` - Main engine
- `doc-review` - Documentation review tool
- `test-platform` - Testing platform
- `marketing-site` - Marketing website

## Documentation
Comprehensive documentation in `docs/`:
- `architecture.md` - System architecture
- `PRD.md` - Product requirements
- `epics.md` - Development epics
- `stories/` - User stories with technical context
