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
import { printBanner } from './components/Banner.js';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('tamma')
  .description('AI-powered autonomous development orchestration platform')
  .version(VERSION);

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
    printBanner(VERSION);
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
    printBanner(VERSION);
    await initCommand();
  });

program.parse();
