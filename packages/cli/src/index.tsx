#!/usr/bin/env node
import 'dotenv/config';
/**
 * @tamma/cli
 * CLI interface for the Tamma autonomous development platform.
 */

import { Command } from 'commander';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { initCommand } from './commands/init.js';
import { serverCommand } from './commands/server.js';
import { upgradeCommand } from './commands/upgrade.js';
import { checkForUpdates } from './update-check.js';
import { printBanner } from './components/Banner.js';

// TAMMA_VERSION is injected at bundle time by esbuild.
// Falls back to reading package.json during development (tsc --build).
declare const TAMMA_VERSION: string | undefined;
function getVersion(): string {
  if (typeof TAMMA_VERSION !== 'undefined') return TAMMA_VERSION;
  try {
    const { createRequire } = require('node:module');
    const r = createRequire(import.meta.url);
    return (r('../package.json') as { version: string }).version;
  } catch {
    return '0.0.0-dev';
  }
}

const program = new Command();

const version = getVersion();

program
  .name('tamma')
  .description('AI-powered autonomous development orchestration platform')
  .version(version);

program
  .command('start')
  .description('Start the Tamma engine')
  .option('--config <path>', 'Path to tamma.config.json', './tamma.config.json')
  .option('--dry-run', 'Select, analyze, plan, print plan, then exit')
  .option('--approval <mode>', 'Approval mode: cli | auto', 'cli')
  .option('--once', 'Process one issue then exit')
  .option('--verbose', 'Enable debug logging')
  .option('-i, --interactive', 'Interactively select which issue to process')
  .option('--debug', 'Enable debug logging and write logs to file')
  .option('--mode <mode>', 'Run mode: interactive (TUI) or service (headless)', 'interactive')
  .action(async (opts) => {
    // Fire-and-forget update check (never blocks startup)
    checkForUpdates(version).then(msg => { if (msg) console.log(msg); }).catch(() => {});

    const mode = opts.mode as 'interactive' | 'service' | undefined;
    if (mode !== 'service') {
      printBanner(version);
    }
    await startCommand({
      config: opts.config as string | undefined,
      dryRun: opts.dryRun === true,
      approval: opts.approval as 'cli' | 'auto' | undefined,
      once: opts.once === true,
      verbose: opts.verbose === true || opts.debug === true,
      interactive: opts.interactive === true,
      debug: opts.debug === true,
      mode,
    });
  });

program
  .command('status')
  .description('Show current engine state')
  .action(() => {
    statusCommand();
  });

program
  .command('init')
  .description('Interactive configuration file generator')
  .option('--full-stack', 'Generate Docker deployment files')
  .option('--force', 'Overwrite existing files')
  .action(async (opts) => {
    printBanner(version);
    if (opts.fullStack) {
      const { initFullStackCommand } = await import('./commands/init-fullstack.js');
      await initFullStackCommand({ force: opts.force === true });
      return;
    }
    await initCommand();
  });

program
  .command('server')
  .description('Start the Tamma HTTP server')
  .option('--config <path>', 'Path to tamma.config.json', './tamma.config.json')
  .option('--port <number>', 'Port to listen on', '3001')
  .option('--host <address>', 'Host to bind to', '127.0.0.1')
  .option('--verbose', 'Enable debug logging')
  .action(async (opts) => {
    printBanner(version);
    await serverCommand({
      config: opts.config as string | undefined,
      verbose: opts.verbose === true,
      port: parseInt(opts.port as string, 10),
      host: (opts.host as string | undefined) ?? '127.0.0.1',
    });
  });

program
  .command('upgrade')
  .description('Upgrade Tamma to the latest version')
  .option('--version <version>', 'Install a specific version')
  .option('--force', 'Re-install even if already on latest')
  .action(async (opts) => {
    await upgradeCommand({
      version: opts.version as string | undefined,
      force: opts.force === true,
    });
  });

program.parse();
