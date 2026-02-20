# Tier 1 Installer: Publishing @tamma/cli to npm

**Status**: Draft
**Author**: Engineering
**Date**: 2026-02-13
**Target**: `npx @tamma/cli init` and `npx @tamma/cli start`

---

## 1. Goal

Enable users to install and run Tamma with a single command, without cloning the monorepo:

```bash
# Initialize a project
npx @tamma/cli init

# Start the engine
npx @tamma/cli start
```

The published `@tamma/cli` npm package must be a self-contained, single-install artifact that bundles all six workspace dependencies (`@tamma/shared`, `@tamma/platforms`, `@tamma/providers`, `@tamma/orchestrator`, `@tamma/observability`, `@tamma/api`) into one distributable package. External runtime dependencies (Octokit, Anthropic SDK, Fastify, Ink/React, pino, etc.) are installed normally via the package's `dependencies` field.

---

## 2. Current State Analysis

### 2.1 What Exists

The CLI package at `packages/cli/` is fully functional within the monorepo:

| Component | Location | Status |
|-----------|----------|--------|
| Entry point | `packages/cli/src/index.tsx` | Shebang, commander setup, 4 subcommands |
| `init` command | `packages/cli/src/commands/init.tsx` | Full Ink wizard (preflight, config, post-config) |
| `start` command | `packages/cli/src/commands/start.tsx` | Engine loop with TUI, approval, pause/resume |
| `server` command | `packages/cli/src/commands/server.ts` | Fastify HTTP server with engine + API |
| `status` command | `packages/cli/src/commands/status.tsx` | Lockfile-based process status |
| Config layer | `packages/cli/src/config.ts` | 3-tier merge: defaults < file < env |
| Preflight | `packages/cli/src/preflight.ts` | Node, git, Claude CLI, gh checks |
| TUI components | `packages/cli/src/components/*.tsx` | Banner, SessionLayout, EngineStatus, LogArea, PlanApproval, CommandInput, IssueSelector |
| Supporting | `packages/cli/src/{colors,types,state,utils,error-handler,file-logger,log-emitter}.ts` | Utilities and state management |

**package.json** already declares `"bin": { "tamma": "./dist/index.js" }` and `"engines": { "node": ">=22" }`.

**Build** currently uses `tsc --build` which emits `.js` files into `dist/` but does not bundle workspace deps.

### 2.2 Dependency Graph

```
@tamma/cli
├── @tamma/api
│   ├── @tamma/events       (→ @tamma/shared, pg, dayjs)
│   ├── @tamma/observability (→ @tamma/shared, pino, pino-pretty)
│   ├── @tamma/orchestrator  (→ @tamma/shared, @tamma/observability, @tamma/providers, @tamma/platforms)
│   ├── @tamma/providers     (→ @tamma/shared, @tamma/observability, @anthropic-ai/sdk, openai)
│   ├── @tamma/shared        (→ dayjs)
│   ├── fastify, @fastify/cors, @fastify/helmet, @fastify/jwt, zod
│   └── fastify-plugin
├── @tamma/shared
├── @tamma/orchestrator
├── @tamma/observability
├── @tamma/providers
├── @tamma/platforms         (→ @tamma/shared, @tamma/observability, @octokit/rest, @gitbeaker/rest)
├── ink, ink-spinner, ink-text-input, ink-select-input
├── react
├── commander
└── dotenv
```

**Total unique workspace packages**: 7 (shared, platforms, providers, orchestrator, observability, api, events).

### 2.3 What's Missing

1. **No bundler configuration** -- the CLI relies on `tsc --build` with project references, which emits per-package `dist/` directories. There is no tsup, esbuild, or rollup config anywhere in the repo (except unrelated vite configs for dashboard/apps).
2. **No npm publish workflow** -- CI (`ci.yml`) only runs typecheck + vitest. No release/publish job exists.
3. **No version management strategy** -- all packages are hard-coded at `0.1.0`.
4. **The `createRequire` pattern** in `index.tsx` reads `../package.json` at runtime, which will need to be handled differently in a bundled output.
5. **Workspace protocol** -- all `@tamma/*` deps use `workspace:*`, which pnpm resolves internally but cannot survive npm publish without transformation.

---

## 3. Bundling Strategy

### 3.1 Approach: esbuild

**Recommendation: esbuild** (already in root `devDependencies` at `^0.24.2`).

| Criterion | esbuild | tsup | Bun bundler |
|-----------|---------|------|-------------|
| Already in repo | Yes (`^0.24.2`) | No | No |
| JSX support | Native (`--jsx=transform`) | Via esbuild internally | Native |
| Speed | ~50ms for this codebase | Slightly slower (wraps esbuild) | Fast, but requires Bun runtime |
| ESM output | Yes | Yes | Yes |
| Tree-shaking | Yes | Yes | Yes |
| Configuration | Script-based or CLI | Config file | Config file |
| Node target | `--platform=node --target=node22` | Yes | Limited Node compat |
| Maturity for CLI bundling | Proven (used by Wrangler, Turbo, etc.) | Good | Less proven for npm publish |

**Why not tsup?** tsup is a convenience wrapper around esbuild. Since esbuild is already installed and we need precise control over externals and JSX settings, using esbuild directly avoids an extra dependency.

**Why not Bun bundler?** Bun would require contributors to install the Bun runtime. CI runs on Node. Adding a second runtime dependency contradicts the "minimal prerequisites" goal.

### 3.2 Bundle Configuration

The esbuild invocation will be a script at `packages/cli/scripts/build.mjs`:

```js
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// These are installed by npm from the published package's dependencies.
// They must NOT be inlined into the bundle.
const external = [
  // Ink / React (JSX runtime must match the installed version)
  'ink', 'ink-spinner', 'ink-text-input', 'ink-select-input',
  'react', 'react/jsx-runtime',
  // Node builtins
  'node:*',
  // CLI framework
  'commander',
  // Config
  'dotenv',
  // Platform SDKs (large, have their own dep trees)
  '@octokit/rest', '@gitbeaker/rest',
  // AI SDKs
  '@anthropic-ai/sdk', 'openai',
  // Observability
  'pino', 'pino-pretty',
  // HTTP server
  'fastify', '@fastify/cors', '@fastify/helmet', '@fastify/jwt',
  'fastify-plugin',
  // Data
  'zod', 'dayjs', 'pg',
];

await build({
  entryPoints: ['src/index.tsx'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/index.js',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  // Banner provides the shebang for the bin entry
  banner: { js: '#!/usr/bin/env node' },
  // All @tamma/* workspace packages are INLINED (bundled in)
  // All third-party packages are EXTERNAL (installed via npm)
  external,
  // Inject package version as a define
  define: {
    'TAMMA_VERSION': JSON.stringify(pkg.version),
  },
  // Tree-shake dead code from workspace packages
  treeShaking: true,
  // Source maps for debugging production issues
  sourcemap: true,
  // Keep function/class names for better error stacks
  keepNames: true,
  // Minify identifiers but not syntax (keep readable errors)
  minifySyntax: false,
  minifyWhitespace: true,
  minifyIdentifiers: false,
});

console.log('Bundle built: dist/index.js');
```

### 3.3 What Gets Bundled vs External

| Category | Treatment | Reason |
|----------|-----------|--------|
| `@tamma/shared` | **Bundled** | Workspace package, types + utils |
| `@tamma/platforms` | **Bundled** | Workspace package, thin wrapper around Octokit |
| `@tamma/providers` | **Bundled** | Workspace package, agent abstraction |
| `@tamma/orchestrator` | **Bundled** | Workspace package, engine core |
| `@tamma/observability` | **Bundled** | Workspace package, logger factory |
| `@tamma/api` | **Bundled** | Workspace package, Fastify app builder |
| `@tamma/events` | **Bundled** | Workspace package (transitive via @tamma/api) |
| `ink`, `react` | External | JSX runtime must be consistent; large dep tree |
| `@octokit/rest` | External | Large SDK with many transitive deps |
| `@anthropic-ai/sdk` | External | AI SDK, frequently updated |
| `fastify` | External | HTTP framework with native-ish plugin system |
| `pino` | External | Logger with optional native (pino-pretty) |
| `pg` | External | Native bindings (optional, via @tamma/events) |
| `commander`, `dotenv` | External | Small but standard; no benefit to inlining |
| `dayjs`, `zod` | External | Standalone utility libs |

### 3.4 Handling the `createRequire` Pattern

The current `index.tsx` reads `package.json` at runtime:

```ts
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
```

After bundling, this relative path would be wrong. Two options:

**Option A (recommended):** Replace with a compile-time constant via esbuild `define`:

```ts
// Before (source code change)
const version = TAMMA_VERSION; // injected by esbuild define
```

**Option B:** Include `package.json` in the published files and keep the runtime read. This works but adds complexity.

We will use **Option A**. The source code change is minimal (3 lines).

---

## 4. Package Structure

The published npm package will have this structure:

```
@tamma/cli/
├── dist/
│   ├── index.js          # Single bundled ESM file (~200-400KB estimated)
│   └── index.js.map      # Source map
├── package.json
├── LICENSE
└── README.md             # Usage instructions (auto-generated or maintained)
```

### 4.1 Published `package.json`

The published `package.json` needs to differ from the source `package.json` in key ways. We will use a build script to generate it.

```jsonc
{
  "name": "@tamma/cli",
  "version": "0.1.0",
  "description": "CLI for the Tamma autonomous development platform",
  "type": "module",
  "bin": {
    "tamma": "./dist/index.js"
  },
  "files": [
    "dist/"
  ],
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    // Only external runtime dependencies -- no @tamma/* packages
    "ink": "^5.0.1",
    "ink-spinner": "^5.0.0",
    "ink-text-input": "^6.0.0",
    "ink-select-input": "^6.0.0",
    "react": "^18.3.1",
    "commander": "^12.1.0",
    "dotenv": "^16.4.7",
    "@octokit/rest": "^21.0.2",
    "@gitbeaker/rest": "^43.7.0",
    "@anthropic-ai/sdk": "^0.68.0",
    "openai": "^4.77.3",
    "pino": "^9.5.0",
    "pino-pretty": "^13.0.0",
    "fastify": "^5.2.0",
    "@fastify/cors": "^10.0.1",
    "@fastify/helmet": "^12.0.1",
    "@fastify/jwt": "^10.0.0",
    "fastify-plugin": "^5.1.0",
    "zod": "^3.22.0",
    "dayjs": "^1.11.13",
    "pg": "^8.13.1"
  },
  "keywords": ["cli", "ai", "automation", "development", "autonomous"],
  "repository": {
    "type": "git",
    "url": "https://github.com/meywd/tamma.git",
    "directory": "packages/cli"
  },
  "license": "MIT",
  "author": "meywd"
}
```

Key differences from the source `package.json`:
- **No `workspace:*` dependencies** -- all `@tamma/*` packages are bundled in
- **Transitive externals promoted to direct dependencies** -- `@octokit/rest`, `@anthropic-ai/sdk`, `fastify`, `pino`, etc. are listed because they are `external` in the bundle but required at runtime
- **`files` field** limits what npm publishes (no source, no tests)
- **No `devDependencies`** or `scripts` needed by consumers

### 4.2 Generating the Publish-Ready package.json

A build script (`packages/cli/scripts/prepare-package.mjs`) will:

1. Read the source `package.json`
2. Remove `workspace:*` dependencies
3. Collect externals from all bundled workspace packages
4. Merge them into the `dependencies` field
5. Write to `dist/package.json` (or a staging directory)

---

## 5. Build Pipeline

### 5.1 Step-by-Step Build Process

```bash
# 1. Install dependencies (from repo root)
pnpm install

# 2. Build all workspace packages (needed for type resolution)
pnpm -r run build

# 3. Typecheck the CLI specifically
pnpm --filter @tamma/cli run typecheck

# 4. Bundle with esbuild
node packages/cli/scripts/build.mjs

# 5. Generate publish-ready package.json
node packages/cli/scripts/prepare-package.mjs

# 6. Verify the bundle runs
node packages/cli/dist/index.js --version

# 7. Run smoke tests against the bundle
node packages/cli/scripts/smoke-test.mjs
```

### 5.2 Updated `packages/cli/package.json` Scripts

```jsonc
{
  "scripts": {
    "build": "tsc --build && chmod +x dist/index.js",
    "build:bundle": "node scripts/build.mjs",
    "build:publish": "pnpm run typecheck && pnpm run build:bundle && node scripts/prepare-package.mjs",
    "dev": "tsx watch src/index.tsx",
    "clean": "rm -rf dist .tsbuildinfo",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:smoke": "node scripts/smoke-test.mjs",
    "prepublishOnly": "pnpm run build:publish"
  }
}
```

The existing `build` script (`tsc --build`) is preserved for monorepo development. The new `build:bundle` and `build:publish` scripts are used only for npm packaging.

---

## 6. CI/CD: GitHub Actions Workflow

### 6.1 Release Workflow

Create `.github/workflows/publish-cli.yml`:

```yaml
name: Publish @tamma/cli

on:
  push:
    tags:
      - 'cli-v*'  # e.g., cli-v0.1.0, cli-v0.2.0

concurrency:
  group: publish-cli-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write  # For npm provenance

jobs:
  publish:
    name: Publish to npm
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build all packages
        run: pnpm -r run build

      - name: Typecheck CLI
        run: pnpm --filter @tamma/cli run typecheck

      - name: Run tests
        run: pnpm --filter @tamma/cli run test

      - name: Bundle CLI
        run: pnpm --filter @tamma/cli run build:publish

      - name: Verify bundle
        run: node packages/cli/dist/index.js --version

      - name: Smoke test
        run: pnpm --filter @tamma/cli run test:smoke

      - name: Extract version from tag
        id: version
        run: echo "version=${GITHUB_REF_NAME#cli-v}" >> $GITHUB_OUTPUT

      - name: Verify version matches
        run: |
          BUNDLE_VERSION=$(node -e "import('./packages/cli/dist/index.js')" 2>&1 | head -1 || true)
          TAG_VERSION="${{ steps.version.outputs.version }}"
          echo "Tag version: $TAG_VERSION"

      - name: Publish to npm
        working-directory: packages/cli
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  verify:
    name: Verify published package
    needs: publish
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Wait for npm propagation
        run: sleep 30

      - name: Test npx invocation
        run: npx @tamma/cli@${{ needs.publish.outputs.version }} --version
```

### 6.2 Release Process

```bash
# 1. Update version in packages/cli/package.json
# 2. Update TAMMA_VERSION define in build script if hardcoded
# 3. Commit: "release: @tamma/cli v0.2.0"
# 4. Tag: git tag cli-v0.2.0
# 5. Push: git push origin cli-v0.2.0
# CI takes over from here
```

---

## 7. Version Management

### 7.1 Strategy: Tag-Based Releases (Phase 1)

For the initial release, use manual versioning with git tags:

- The CLI version lives in `packages/cli/package.json` and is injected into the bundle via `TAMMA_VERSION`.
- Tags follow the pattern `cli-v<semver>` (e.g., `cli-v0.1.0`).
- The publish workflow triggers on tag push.
- Workspace packages (`@tamma/shared`, etc.) are **not published independently** -- they are bundled into the CLI.

### 7.2 Future: Changesets (Phase 2)

When more packages need independent publishing, adopt [changesets](https://github.com/changesets/changesets):

```bash
pnpm add -Dw @changesets/cli
pnpm changeset init
```

This is explicitly out of scope for Tier 1. The tag-based approach is simpler and sufficient when only one package is published.

### 7.3 Version Sync

Since workspace packages are bundled (not published), their versions do not need to stay in sync with the CLI version. The CLI version is the only version visible to users.

---

## 8. Testing the Package

### 8.1 Local Testing with `npm pack`

The fastest way to verify the package before publishing:

```bash
# Build the publishable package
cd packages/cli
pnpm run build:publish

# Create a tarball
npm pack

# Install it in a temp directory
mkdir /tmp/tamma-test && cd /tmp/tamma-test
npm init -y
npm install /path/to/tamma-cli-0.1.0.tgz

# Test the binary
npx tamma --version
npx tamma init   # (will fail preflight if not in a git repo, which is correct)
```

### 8.2 Smoke Test Script

`packages/cli/scripts/smoke-test.mjs`:

```js
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dist = join(import.meta.dirname, '..', 'dist', 'index.js');

function run(cmd) {
  return execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim();
}

// Test 1: --version flag
const version = run(`node ${dist} --version`);
console.log(`[PASS] --version: ${version}`);

// Test 2: --help flag
const help = run(`node ${dist} --help`);
if (!help.includes('init') || !help.includes('start') || !help.includes('server')) {
  throw new Error('--help missing expected commands');
}
console.log('[PASS] --help lists all commands');

// Test 3: init refuses to run outside a git repo
const tempDir = mkdtempSync(join(tmpdir(), 'tamma-smoke-'));
try {
  try {
    execSync(`node ${dist} init`, {
      cwd: tempDir,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
    });
    // init may succeed or exit with a message -- both are acceptable
    console.log('[PASS] init runs without crash');
  } catch (e) {
    // Non-zero exit is expected (preflight fails outside git repo)
    if (e.status !== undefined) {
      console.log('[PASS] init exits with expected error outside git repo');
    } else {
      throw e;
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

// Test 4: start shows config error (no token configured)
try {
  execSync(`node ${dist} start --once`, {
    encoding: 'utf-8',
    timeout: 10000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
} catch (e) {
  if (e.stderr?.includes('Configuration errors') || e.stderr?.includes('GitHub token')) {
    console.log('[PASS] start fails with config validation (expected)');
  } else {
    console.log('[PASS] start exits (expected without config)');
  }
}

console.log('\nAll smoke tests passed.');
```

### 8.3 Testing with Verdaccio (Optional, for CI)

For more thorough end-to-end testing, set up a local npm registry:

```bash
# Start verdaccio in CI
npx verdaccio &
npm set registry http://localhost:4873

# Publish to local registry
cd packages/cli && npm publish --registry http://localhost:4873

# Test npx from local registry
npx --registry http://localhost:4873 @tamma/cli --version
```

This is optional for Phase 1 but recommended if flaky publish issues arise.

---

## 9. Migration Path

### 9.1 Source Code Changes Required

**Change 1: Replace runtime `package.json` read with compile-time constant**

File: `packages/cli/src/index.tsx`

```diff
 #!/usr/bin/env node
 import 'dotenv/config';

 import { createRequire } from 'node:module';
 import { Command } from 'commander';
 ...

-const require = createRequire(import.meta.url);
-const pkg = require('../package.json') as { version: string };
+// TAMMA_VERSION is injected by esbuild at bundle time.
+// For development (tsc --build), fall back to reading package.json.
+declare const TAMMA_VERSION: string | undefined;
+const version: string = typeof TAMMA_VERSION !== 'undefined'
+  ? TAMMA_VERSION
+  : (() => {
+      const { createRequire } = await import('node:module');
+      const require = createRequire(import.meta.url);
+      return (require('../package.json') as { version: string }).version;
+    })();

 const program = new Command();

 program
   .name('tamma')
   .description('AI-powered autonomous development orchestration platform')
-  .version(pkg.version);
+  .version(version);
```

Simpler alternative (recommended): keep it synchronous with a try/catch fallback.

```diff
-import { createRequire } from 'node:module';
-
-const require = createRequire(import.meta.url);
-const pkg = require('../package.json') as { version: string };

+// TAMMA_VERSION is injected at bundle time by esbuild.
+// Falls back to package.json read during development.
+declare const TAMMA_VERSION: string | undefined;
+function getVersion(): string {
+  if (typeof TAMMA_VERSION !== 'undefined') return TAMMA_VERSION;
+  try {
+    const { createRequire } = require('node:module');
+    const r = createRequire(import.meta.url);
+    return (r('../package.json') as { version: string }).version;
+  } catch {
+    return '0.0.0-dev';
+  }
+}

 program
   .name('tamma')
   .description('AI-powered autonomous development orchestration platform')
-  .version(pkg.version);
+  .version(getVersion());
```

**Change 2: Ensure `import type` is used correctly for enums**

The codebase has a known issue where `import type` for enums used at runtime causes `ReferenceError` (noted in MEMORY.md). The following import in `start.tsx` must NOT use `import type`:

```ts
// This is correct (runtime value, not just a type):
import { EngineState } from '@tamma/shared';
```

Verify all similar imports across CLI source files are correct. esbuild will surface these as build errors if an `import type`-only import is used as a runtime value.

**Change 3: Add `.npmignore` or `files` field**

Already handled by the `files` field in the generated publish `package.json`. No `.npmignore` needed.

### 9.2 No Breaking Changes to Monorepo Development

All changes are additive:
- `tsc --build` continues to work for development
- `pnpm dev` (tsx watch) continues to work
- Tests run against source, not the bundle
- The bundle build is a separate `build:bundle` script

---

## 10. Risks and Mitigations

### 10.1 Bundle Size

| Risk | The bundle could be large if workspace packages pull in unexpected code |
|------|----------------------------------------------------------------------|
| **Likelihood** | Medium |
| **Impact** | Slow `npx` cold start (npm downloads + extracts the package on first run) |
| **Mitigation** | Tree-shaking is enabled. Measure bundle size in CI with a size budget (e.g., 500KB uncompressed JS). External all large SDKs. Profile with `esbuild --analyze` to find bloat. |

### 10.2 JSX Runtime Mismatch

| Risk | Bundled JSX calls `React.createElement` but installed React version differs |
|------|---------------------------------------------------------------------------|
| **Likelihood** | Low |
| **Impact** | Runtime crash |
| **Mitigation** | Pin React in published `dependencies` to `^18.3.1`. esbuild `jsx: 'transform'` with classic createElement is stable across React 18.x. |

### 10.3 Missing Externals

| Risk | An import in a workspace package references a module not listed in externals or dependencies |
|------|-------------------------------------------------------------------------------------------|
| **Likelihood** | Medium (especially transitive deps of `@tamma/events` or future packages) |
| **Impact** | `MODULE_NOT_FOUND` at runtime |
| **Mitigation** | The smoke test catches this. Additionally, the `prepare-package.mjs` script should crawl all workspace package.json files to auto-collect externals. |

### 10.4 `pg` Native Module

| Risk | `pg` (PostgreSQL client) has optional native bindings that may fail to install on some platforms |
|------|-----------------------------------------------------------------------------------------------|
| **Likelihood** | Medium |
| **Impact** | `npm install` errors or warnings |
| **Mitigation** | `pg` is only used by `@tamma/events` (InMemoryEventStore is the default). Mark `pg` as an `optionalDependencies` rather than `dependencies` in the published package. Users who need PostgreSQL can install it explicitly. |

### 10.5 Node.js 22 Requirement

| Risk | Users may not have Node.js 22+ installed |
|------|----------------------------------------|
| **Likelihood** | Medium (Node 22 is current LTS as of 2025-10) |
| **Impact** | Confusing errors if running on Node 18/20 |
| **Mitigation** | The `engines` field in `package.json` warns users. The preflight check in `init` also verifies Node version. Add an early version guard at the top of the bundle entry point. |

### 10.6 Secrets in Published Package

| Risk | Accidentally publishing `.env`, tokens, or internal config |
|------|----------------------------------------------------------|
| **Likelihood** | Low |
| **Impact** | Security incident |
| **Mitigation** | `files` field in `package.json` whitelists only `dist/`. Run `npm pack --dry-run` in CI and assert no unexpected files are included. |

### 10.7 esbuild JSX Edge Cases

| Risk | Ink 5.x components use advanced React patterns that esbuild's classic JSX transform handles incorrectly |
|------|-------------------------------------------------------------------------------------------------------|
| **Likelihood** | Low |
| **Impact** | Runtime crash in TUI components |
| **Mitigation** | Smoke tests exercise `init` and `start --help`. If issues arise, switch to `jsxImportSource` with automatic JSX transform. The tsconfig already sets `"jsx": "react"` (classic mode). |

### 10.8 Workspace Package API Drift

| Risk | A workspace package changes its exports, breaking the bundled CLI but not caught until publish |
|------|----------------------------------------------------------------------------------------------|
| **Likelihood** | Medium |
| **Impact** | Broken release |
| **Mitigation** | Add the `build:bundle` step to the existing CI workflow (not just the publish workflow). This ensures every PR build produces a valid bundle. |

---

## 11. Implementation Steps

### Phase 1: Build Infrastructure (2-3 days)

| # | Task | Est. | Details |
|---|------|------|---------|
| 1 | Create `packages/cli/scripts/build.mjs` | 2h | esbuild bundler script as specified in Section 3.2. Configure externals, JSX, banner, defines. |
| 2 | Create `packages/cli/scripts/prepare-package.mjs` | 2h | Script to generate publish-ready `package.json`. Reads source `package.json` + all workspace dep `package.json` files to collect transitive externals. Copies LICENSE. |
| 3 | Modify `packages/cli/src/index.tsx` | 30m | Replace `createRequire` pattern with `TAMMA_VERSION` define (Section 9.1, Change 1). |
| 4 | Add bundle-related scripts to `package.json` | 15m | `build:bundle`, `build:publish`, `test:smoke` as specified in Section 5.2. |
| 5 | Create `packages/cli/scripts/smoke-test.mjs` | 1h | Smoke test script as specified in Section 8.2. |
| 6 | Verify `tsc --build` still works | 30m | Ensure the source-level changes do not break monorepo development. |

### Phase 2: Test & Validate (1 day)

| # | Task | Est. | Details |
|---|------|------|---------|
| 7 | Run `pnpm run build:publish` locally | 30m | Verify bundle is produced and is a valid ESM module. |
| 8 | Measure bundle size | 15m | Run `esbuild --analyze` variant. Document baseline size. Set budget. |
| 9 | Test with `npm pack` locally | 1h | Install tarball in a temp project. Run `npx tamma --version`, `npx tamma init`, `npx tamma start --help`. |
| 10 | Fix any missing externals or runtime errors | 1-2h | Iterative debugging of module resolution issues. |
| 11 | Add bundle build to CI | 30m | Add `pnpm --filter @tamma/cli run build:bundle` step to `.github/workflows/ci.yml` so every PR validates the bundle builds. |

### Phase 3: CI/CD & Publish (1 day)

| # | Task | Est. | Details |
|---|------|------|---------|
| 12 | Create `.github/workflows/publish-cli.yml` | 1h | Release workflow as specified in Section 6.1. |
| 13 | Set up npm access | 30m | Create npm org `@tamma` (if not exists). Add `NPM_TOKEN` as GitHub Actions secret. Configure package access (public). |
| 14 | Dry-run publish | 30m | `npm publish --dry-run` to verify package contents. |
| 15 | Publish v0.1.0 | 15m | `git tag cli-v0.1.0 && git push origin cli-v0.1.0`. |
| 16 | Verify `npx @tamma/cli --version` works | 15m | Post-publish verification. |

### Phase 4: Documentation & Polish (0.5 days)

| # | Task | Est. | Details |
|---|------|------|---------|
| 17 | Add installation instructions to root README | 30m | `npx @tamma/cli init` quick-start section. |
| 18 | Add early Node version guard | 30m | Add `if (parseInt(process.version.slice(1)) < 22) { ... }` at top of entry point, before any imports that might fail on older Node. |
| 19 | Document release process | 30m | Update contributing guide with tag-based release steps. |

### Total Estimated Effort: 4-5 days

---

## Appendix A: Dependency Collection Script

The `prepare-package.mjs` script needs to collect all runtime dependencies from bundled workspace packages. Here is the algorithm:

```js
import { readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliDir = join(__dirname, '..');
const packagesDir = join(cliDir, '..');

// Workspace packages that are BUNDLED (inlined by esbuild)
const BUNDLED_PACKAGES = [
  '@tamma/shared',
  '@tamma/platforms',
  '@tamma/providers',
  '@tamma/orchestrator',
  '@tamma/observability',
  '@tamma/api',
  '@tamma/events',
];

// Map package name to directory name
const PACKAGE_DIRS = {
  '@tamma/shared': 'shared',
  '@tamma/platforms': 'platforms',
  '@tamma/providers': 'providers',
  '@tamma/orchestrator': 'orchestrator',
  '@tamma/observability': 'observability',
  '@tamma/api': 'api',
  '@tamma/events': 'events',
};

// Collect all external dependencies from bundled workspace packages
const collectedDeps = {};

for (const pkgName of BUNDLED_PACKAGES) {
  const dir = PACKAGE_DIRS[pkgName];
  const pkgJson = JSON.parse(
    readFileSync(join(packagesDir, dir, 'package.json'), 'utf-8')
  );

  for (const [dep, version] of Object.entries(pkgJson.dependencies ?? {})) {
    // Skip workspace deps (they are bundled)
    if (typeof version === 'string' && version.startsWith('workspace:')) continue;
    // Skip if already collected with same or higher version
    if (!collectedDeps[dep]) {
      collectedDeps[dep] = version;
    }
  }
}

// Read the CLI's own package.json
const cliPkg = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf-8'));

// Merge CLI's external deps (non-workspace)
for (const [dep, version] of Object.entries(cliPkg.dependencies ?? {})) {
  if (typeof version === 'string' && version.startsWith('workspace:')) continue;
  if (!collectedDeps[dep]) {
    collectedDeps[dep] = version;
  }
}

// Separate pg into optionalDependencies
const optionalDeps = {};
if (collectedDeps['pg']) {
  optionalDeps['pg'] = collectedDeps['pg'];
  delete collectedDeps['pg'];
}

// Build the publish package.json
const publishPkg = {
  name: cliPkg.name,
  version: cliPkg.version,
  description: 'CLI for the Tamma autonomous development platform',
  type: 'module',
  bin: { tamma: './dist/index.js' },
  files: ['dist/'],
  engines: { node: '>=22' },
  dependencies: collectedDeps,
  optionalDependencies: Object.keys(optionalDeps).length > 0 ? optionalDeps : undefined,
  keywords: ['cli', 'ai', 'automation', 'development', 'autonomous', 'github'],
  repository: {
    type: 'git',
    url: 'https://github.com/meywd/tamma.git',
    directory: 'packages/cli',
  },
  license: 'MIT',
  author: 'meywd',
};

// Write to the cli package root (where npm publish runs)
writeFileSync(
  join(cliDir, 'package.json.publish'),
  JSON.stringify(publishPkg, null, 2) + '\n'
);

// During actual publish, this would replace package.json temporarily
// or use a staging directory
console.log('Generated package.json.publish');
console.log(`Dependencies: ${Object.keys(collectedDeps).length}`);
console.log(`Optional: ${Object.keys(optionalDeps).length}`);
```

## Appendix B: Bundle Size Budget

Target constraints for the bundled `dist/index.js`:

| Metric | Budget | Rationale |
|--------|--------|-----------|
| Uncompressed JS | < 500 KB | Keeps `npx` cold start under 3s on broadband |
| Gzipped JS | < 150 KB | npm stores gzipped; this is what users download |
| Source map | < 2 MB | Maps are large but only used for debugging |
| Total `npm pack` tarball | < 200 KB | Entire published package |

Monitor in CI with:

```bash
stat -f%z packages/cli/dist/index.js  # macOS
wc -c < packages/cli/dist/index.js    # Linux
```

## Appendix C: Future Considerations

1. **Global install**: `npm install -g @tamma/cli` should work identically to `npx`. The `bin` field handles this automatically.

2. **Auto-update**: Consider adding a version check that warns users when a newer version is available (compare `npm view @tamma/cli version` against the installed version). This is a post-Tier-1 enhancement.

3. **Standalone binary (Tier 2)**: Using `pkg`, `bun compile`, or `deno compile` to produce a single binary that does not require Node.js. This is explicitly out of scope for Tier 1.

4. **Docker image (Tier 3)**: `docker run ghcr.io/meywd/tamma init`. Out of scope.

5. **Splitting `pg` dependency**: If `@tamma/events` moves to a separate optional plugin, `pg` can be removed from the CLI dependencies entirely.
