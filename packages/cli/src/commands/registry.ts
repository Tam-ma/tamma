import type { SlashCommand, CommandContext } from '../types.js';
import { formatDuration } from '../utils.js';

/**
 * Build the registry of all available slash commands.
 */
export function createCommandRegistry(): Map<string, SlashCommand> {
  const registry = new Map<string, SlashCommand>();

  registry.set('status', {
    name: 'status',
    description: 'Show engine state, issue, cost, uptime',
    execute(_args, ctx) {
      const issue = ctx.issue !== null
        ? `#${ctx.issue.number} ${ctx.issue.title}`
        : 'none';
      const uptime = formatDuration(Date.now() - ctx.stats.startedAt);
      ctx.logEmitter.emit('info', `State: ${ctx.state} | Issue: ${issue} | Uptime: ${uptime} | Processed: ${ctx.stats.issuesProcessed} | Cost: $${ctx.stats.totalCostUsd.toFixed(2)}`);
    },
  });

  registry.set('approve', {
    name: 'approve',
    description: 'Approve pending plan',
    execute(_args, ctx) {
      ctx.approveCurrentPlan();
    },
  });

  registry.set('reject', {
    name: 'reject',
    description: 'Reject plan, optionally with feedback',
    execute(args, ctx) {
      ctx.rejectCurrentPlan(args || undefined);
    },
  });

  registry.set('skip', {
    name: 'skip',
    description: 'Skip current issue',
    execute(_args, ctx) {
      ctx.skipIssue();
    },
  });

  registry.set('pause', {
    name: 'pause',
    description: 'Pause poll loop',
    execute(_args, ctx) {
      ctx.setPaused(true);
      ctx.logEmitter.emit('info', 'Engine paused. Use /resume to continue.');
    },
  });

  registry.set('resume', {
    name: 'resume',
    description: 'Resume polling',
    execute(_args, ctx) {
      ctx.setPaused(false);
      ctx.logEmitter.emit('info', 'Engine resumed.');
    },
  });

  registry.set('stop', {
    name: 'stop',
    description: 'Graceful shutdown',
    execute(_args, ctx) {
      ctx.logEmitter.emit('info', 'Shutting down...');
      ctx.shutdown();
    },
  });

  registry.set('logs', {
    name: 'logs',
    description: 'Toggle debug log visibility',
    execute(_args, ctx) {
      const newValue = !ctx.showDebug;
      ctx.setShowDebug(newValue);
      ctx.logEmitter.emit('info', `Debug logs ${newValue ? 'enabled' : 'disabled'}`);
    },
  });

  registry.set('config', {
    name: 'config',
    description: 'Print current config',
    execute(_args, ctx) {
      const { github, agent, engine } = ctx.config;
      ctx.logEmitter.emit('info', `Config: owner=${github.owner} repo=${github.repo} model=${agent.model} budget=$${agent.maxBudgetUsd} approval=${engine.approvalMode} poll=${engine.pollIntervalMs}ms`);
    },
  });

  registry.set('help', {
    name: 'help',
    description: 'List available commands',
    execute(_args, ctx) {
      const lines = ['Available commands:'];
      for (const cmd of registry.values()) {
        lines.push(`  /${cmd.name} — ${cmd.description}`);
      }
      ctx.logEmitter.emit('info', lines.join('\n'));
    },
  });

  return registry;
}

/**
 * Parse and dispatch a slash command from user input.
 */
export function executeSlashCommand(
  input: string,
  registry: Map<string, SlashCommand>,
  ctx: CommandContext,
): void {
  if (!input.startsWith('/')) {
    ctx.logEmitter.emit('warn', `Unknown input. Type /help for commands.`);
    return;
  }

  const parts = input.slice(1).split(/\s+/);
  const name = parts[0]!.toLowerCase();
  const args = parts.slice(1).join(' ');

  const command = registry.get(name);
  if (command === undefined) {
    ctx.logEmitter.emit('warn', `Unknown command: /${name}. Type /help for commands.`);
    return;
  }

  command.execute(args, ctx);
}
