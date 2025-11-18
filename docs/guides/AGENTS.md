# Repository Guidelines

## Project Structure & Module Organization
- `packages/` is the pnpm workspace root: `packages/orchestrator` (event store + scheduling), `packages/workers` (execution nodes), `packages/cli` (developer interface), `packages/shared` (DTOs/utilities), and `packages/config` (typed settings). Keep new services here and co-locate tests beside source files (`src/__tests__` or `feature.unit.test.ts`).
- Specs and story briefs live in `docs/` (see `docs/stories/`) with supplemental notes in `wiki/`. Marketing assets reside in `marketing-site/`, while compiled output belongs in `dist/`.

## Build, Test, and Development Commands
- `pnpm install` bootstraps all workspaces; rerun whenever the lockfile changes. `pnpm dev` starts every watcher for full-stack flows.
- `pnpm build`, `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` must succeed before review; they surface bundling, style, and type regressions early.
- `pnpm test`, `pnpm test:unit`, `pnpm test:integration`, and `pnpm test:coverage` invoke Vitest. Integration runs expect a local Postgres instance for orchestrator tasks.
- Database work uses the scoped scripts: `pnpm migrate:latest` / `migrate:rollback` via `@tamma/orchestrator`.

## Coding Style & Naming Conventions
- ESLint (TypeScript strict configs) blocks implicit `any`, unused symbols, floating promises, and loose boolean checks; keep explicit return types unless writing short inline expressions.
- Prettier controls layout (2-space indent, trailing commas, LF endings). Run `pnpm format` before committing.
- Use `camelCase` for functions and fields, `PascalCase` for classes/types, and `kebab-case` for package or directory names (for example `packages/intelligence`, `docs/event-sourcing`).
- Maintain the domain/adapters/config directory split and keep `index.ts` files limited to safe re-exports.

## Testing Guidelines
- Write Vitest specs beside the code, naming them `*.unit.test.ts` or `*.integration.test.ts`. Use shared fixtures in `packages/orchestrator/test-utils` (or package-specific equivalents) rather than duplicating mocks.
- Run `pnpm test` during development and `pnpm test:coverage` before opening a PR; explain any intentional gaps.

## Commit & Pull Request Guidelines
- Follow the conventional format already in history (`feat:`, `docs:`, `chore:`) and scope by package when helpful (`feat(workers): add retry planner`).
- PR descriptions must cover intent, linked story/issue, behavioral evidence (screenshots/logs), and the commands you ran (`pnpm build && pnpm test`). Keep diffs focused; land documentation-only changes separately when possible.

## Security & Configuration Tips
- Load secrets via helpers in `packages/config` and store actual values in `.env.local`, which is already git-ignored.
- Test migrations or other privileged scripts in a disposable Postgres instance with `pnpm migrate:latest` before sharing them.
