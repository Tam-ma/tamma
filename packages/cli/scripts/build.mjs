/**
 * packages/cli/scripts/build.mjs
 *
 * Bundles @tamma/cli into a single ESM file for npm distribution.
 * All @tamma/* workspace packages are inlined (bundled).
 * All third-party packages are kept external (installed via npm).
 *
 * Usage:
 *   node packages/cli/scripts/build.mjs
 *   node packages/cli/scripts/build.mjs --analyze
 */

import { build } from 'esbuild';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliDir = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf-8'));

const analyze = process.argv.includes('--analyze');

// Third-party packages that must NOT be bundled.
// They are installed by npm from the published package's dependencies.
const external = [
  // Ink / React (JSX runtime must match the installed version)
  'ink', 'ink-spinner', 'ink-text-input', 'ink-select-input',
  'react', 'react/jsx-runtime', 'react/jsx-dev-runtime',
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

const result = await build({
  entryPoints: [join(cliDir, 'src/index.tsx')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: join(cliDir, 'dist/index.js'),
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  external,
  define: {
    'TAMMA_VERSION': JSON.stringify(pkg.version),
  },
  treeShaking: true,
  sourcemap: true,
  keepNames: true,
  minifySyntax: false,
  minifyWhitespace: true,
  minifyIdentifiers: false,
  metafile: analyze,
  logLevel: 'info',
});

// Report bundle size
const outfile = join(cliDir, 'dist/index.js');
const stats = statSync(outfile);
const sizeKB = (stats.size / 1024).toFixed(1);
console.log(`\nBundle: dist/index.js (${sizeKB} KB)`);

if (stats.size > 512_000) {
  console.warn(`WARNING: Bundle size ${sizeKB} KB exceeds 500 KB budget`);
}

// Print analysis if requested
if (analyze && result.metafile) {
  const { analyzeMetafile } = await import('esbuild');
  const text = await analyzeMetafile(result.metafile, { verbose: false });
  console.log('\nBundle analysis:\n');
  console.log(text);
}
