#!/usr/bin/env node
/**
 * @tamma/cli
 * CLI interface for the Tamma autonomous development platform.
 */

import { Command } from 'commander';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { initCommand } from './commands/init.js';

const program = new Command();

program
  .name('tamma')
  .description('AI-powered autonomous development orchestration platform')
  .version('0.1.0');

program
  .command('start')
  .description('Start the Tamma engine')
  .option('--config <path>', 'Path to tamma.config.json', './tamma.config.json')
  .option('--dry-run', 'Select, analyze, plan, print plan, then exit')
  .option('--approval <mode>', 'Approval mode: cli | auto', 'cli')
  .option('--once', 'Process one issue then exit')
  .option('--verbose', 'Enable debug logging')
  .action(async (opts) => {
    await startCommand({
      config: opts.config as string | undefined,
      dryRun: opts.dryRun === true,
      approval: opts.approval as 'cli' | 'auto' | undefined,
      once: opts.once === true,
      verbose: opts.verbose === true,
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
    await initCommand();
  });

program.parse();
