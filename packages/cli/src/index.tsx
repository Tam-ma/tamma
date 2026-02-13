#!/usr/bin/env node
import 'dotenv/config';
/**
 * @tamma/cli
 * CLI interface for the Tamma autonomous development platform.
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { initCommand } from './commands/init.js';
import { serverCommand } from './commands/server.js';
import { printBanner } from './components/Banner.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('tamma')
  .description('AI-powered autonomous development orchestration platform')
  .version(pkg.version);

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
  .action(async (opts) => {
    printBanner(pkg.version);
    await startCommand({
      config: opts.config as string | undefined,
      dryRun: opts.dryRun === true,
      approval: opts.approval as 'cli' | 'auto' | undefined,
      once: opts.once === true,
      verbose: opts.verbose === true || opts.debug === true,
      interactive: opts.interactive === true,
      debug: opts.debug === true,
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
  .action(async () => {
    printBanner(pkg.version);
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
    printBanner(pkg.version);
    await serverCommand({
      config: opts.config as string | undefined,
      verbose: opts.verbose === true,
      port: parseInt(opts.port as string, 10),
      host: (opts.host as string | undefined) ?? '127.0.0.1',
    });
  });

program.parse();
