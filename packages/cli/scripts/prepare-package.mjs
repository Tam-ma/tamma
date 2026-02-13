/**
 * packages/cli/scripts/prepare-package.mjs
 *
 * Generates a publish-ready package.json for the @tamma/cli npm package.
 * Replaces workspace:* dependencies with collected external deps from all
 * bundled workspace packages.
 *
 * Usage:
 *   node packages/cli/scripts/prepare-package.mjs
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliDir = join(__dirname, '..');
const packagesDir = join(cliDir, '..');
const repoRoot = join(packagesDir, '..');

// Workspace packages that are BUNDLED (inlined by esbuild)
const BUNDLED_PACKAGES = {
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

for (const [pkgName, dirName] of Object.entries(BUNDLED_PACKAGES)) {
  const pkgPath = join(packagesDir, dirName, 'package.json');
  if (!existsSync(pkgPath)) {
    console.warn(`WARNING: ${pkgPath} not found, skipping ${pkgName}`);
    continue;
  }

  const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  for (const [dep, version] of Object.entries(pkgJson.dependencies ?? {})) {
    // Skip workspace deps (they are bundled)
    if (typeof version === 'string' && version.startsWith('workspace:')) continue;
    // Keep first encountered version (they should be consistent across packages)
    if (!collectedDeps[dep]) {
      collectedDeps[dep] = version;
    }
  }
}

// Read the CLI's own package.json
const cliPkg = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf-8'));

// Merge CLI's own external deps (non-workspace)
for (const [dep, version] of Object.entries(cliPkg.dependencies ?? {})) {
  if (typeof version === 'string' && version.startsWith('workspace:')) continue;
  if (!collectedDeps[dep]) {
    collectedDeps[dep] = version;
  }
}

// Separate pg into optionalDependencies (only needed by @tamma/events for PostgreSQL)
const optionalDeps = {};
if (collectedDeps['pg']) {
  optionalDeps['pg'] = collectedDeps['pg'];
  delete collectedDeps['pg'];
}

// Sort dependencies alphabetically
const sortObject = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

// Build the publish package.json
const publishPkg = {
  name: cliPkg.name,
  version: cliPkg.version,
  description: 'CLI for the Tamma autonomous development platform',
  type: 'module',
  bin: { tamma: './dist/index.js' },
  files: ['dist/'],
  engines: { node: '>=22' },
  dependencies: sortObject(collectedDeps),
  ...(Object.keys(optionalDeps).length > 0 ? { optionalDependencies: sortObject(optionalDeps) } : {}),
  keywords: ['cli', 'ai', 'automation', 'development', 'autonomous', 'github'],
  repository: {
    type: 'git',
    url: 'https://github.com/meywd/tamma.git',
    directory: 'packages/cli',
  },
  license: 'MIT',
  author: 'meywd',
};

// Write the publish-ready package.json alongside the source one
const publishPath = join(cliDir, 'package.json.publish');
writeFileSync(publishPath, JSON.stringify(publishPkg, null, 2) + '\n');

// Copy LICENSE from repo root if it exists
const licenseSrc = join(repoRoot, 'LICENSE');
const licenseDst = join(cliDir, 'LICENSE');
if (existsSync(licenseSrc) && !existsSync(licenseDst)) {
  copyFileSync(licenseSrc, licenseDst);
  console.log('Copied LICENSE from repo root');
}

// Summary
console.log(`\nGenerated: ${publishPath}`);
console.log(`  Dependencies: ${Object.keys(collectedDeps).length}`);
console.log(`  Optional: ${Object.keys(optionalDeps).length}`);
console.log(`  Version: ${publishPkg.version}`);
console.log('\nDependencies:');
for (const [dep, ver] of Object.entries(sortObject(collectedDeps))) {
  console.log(`  ${dep}: ${ver}`);
}
if (Object.keys(optionalDeps).length > 0) {
  console.log('\nOptional:');
  for (const [dep, ver] of Object.entries(optionalDeps)) {
    console.log(`  ${dep}: ${ver}`);
  }
}
