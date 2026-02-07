import React, { useState, useCallback } from 'react';
import { render, Box, Text } from 'ink';
import { EngineState } from '@tamma/shared';
import type { IssueData } from '@tamma/shared';
import { TammaEngine } from '@tamma/orchestrator';
import type { EngineStats } from '@tamma/orchestrator';
import { ClaudeAgentProvider } from '@tamma/providers';
import { GitHubPlatform } from '@tamma/platforms';
import { createLogger } from '@tamma/observability';
import { loadConfig, validateConfig } from '../config.js';
import type { CLIOptions } from '../config.js';
import { writeLockfile, removeLockfile } from '../state.js';
import EngineStatus from '../components/EngineStatus.js';

interface StartAppProps {
  engine: TammaEngine;
  once: boolean;
}

function StartApp({ engine, once }: StartAppProps): React.JSX.Element {
  const [state, setState] = useState<EngineState>(EngineState.IDLE);
  const [issue, setIssue] = useState<{ number: number; title: string } | null>(null);
  const [stats, setStats] = useState<EngineStats>({ issuesProcessed: 0, totalCostUsd: 0, startedAt: Date.now() });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // These would be wired via onStateChange callback
  const _handleStateChange = useCallback((_state: EngineState, _issue: IssueData | null, _stats: EngineStats) => {
    setState(_state);
    setIssue(_issue !== null ? { number: _issue.number, title: _issue.title } : null);
    setStats(_stats);
  }, []);

  // Start the engine on first render
  React.useEffect(() => {
    void (async () => {
      try {
        await engine.initialize();

        if (once) {
          await engine.processOneIssue();
          setDone(true);
        } else {
          await engine.run();
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      void engine.dispose();
      removeLockfile();
    };
  }, [engine, once, _handleStateChange]);

  if (error !== null) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red" bold>Error: {error}</Text>
      </Box>
    );
  }

  if (done) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="green" bold>Processing complete.</Text>
      </Box>
    );
  }

  return <EngineStatus state={state} issue={issue} stats={stats} />;
}

export async function startCommand(options: CLIOptions): Promise<void> {
  const config = loadConfig(options);
  const errors = validateConfig(config);

  if (errors.length > 0) {
    console.error('Configuration errors:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  const logger = createLogger('tamma', config.logLevel);

  // For dry-run mode, force auto-approval and stop after planning
  if (options.dryRun === true) {
    config.engine.approvalMode = 'auto';
  }

  // Set up platform
  const platform = new GitHubPlatform();
  await platform.initialize({ token: config.github.token });

  // Set up agent provider
  const agent = new ClaudeAgentProvider();

  // Create engine with lockfile updates on state change
  const engine = new TammaEngine({
    config,
    platform,
    agent,
    logger,
    onStateChange: (state, issue, stats) => {
      writeLockfile(state, issue, stats);
    },
  });

  // Handle graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');
    await engine.dispose();
    removeLockfile();
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });

  if (options.dryRun === true) {
    // Dry run: select → analyze → plan → print → exit
    try {
      await engine.initialize();
      const issue = await engine.selectIssue();
      if (issue === null) {
        console.log('No issues found matching configured labels.');
        await engine.dispose();
        return;
      }

      const context = await engine.analyzeIssue(issue);
      const plan = await engine.generatePlan(issue, context);

      console.log('\n' + '='.repeat(60));
      console.log(`Development Plan for Issue #${plan.issueNumber}`);
      console.log('='.repeat(60));
      console.log(`\nSummary: ${plan.summary}`);
      console.log(`\nApproach: ${plan.approach}`);
      console.log('\nFile Changes:');
      for (const fc of plan.fileChanges) {
        console.log(`  - [${fc.action}] ${fc.filePath}: ${fc.description}`);
      }
      console.log(`\nTesting Strategy: ${plan.testingStrategy}`);
      console.log(`Complexity: ${plan.estimatedComplexity}`);
      console.log(`Risks: ${plan.risks.length > 0 ? plan.risks.join(', ') : 'None identified'}`);
      console.log('='.repeat(60));

      await engine.dispose();
      removeLockfile();
    } catch (err: unknown) {
      console.error('Dry run failed:', err instanceof Error ? err.message : String(err));
      await engine.dispose();
      removeLockfile();
      process.exit(1);
    }
    return;
  }

  // Interactive mode with Ink rendering
  const { waitUntilExit } = render(
    <StartApp
      engine={engine}
      once={options.once === true}
    />,
  );

  await waitUntilExit();
}
