import React, { useState, useCallback, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import { EngineState } from '@tamma/shared';
import type { IssueData, DevelopmentPlan } from '@tamma/shared';
import { TammaEngine } from '@tamma/orchestrator';
import type { EngineStats, ApprovalHandler } from '@tamma/orchestrator';
import { ClaudeAgentProvider } from '@tamma/providers';
import { GitHubPlatform } from '@tamma/platforms';
import { createLogger } from '@tamma/observability';
import { loadConfig, validateConfig } from '../config.js';
import type { CLIOptions } from '../config.js';
import { writeLockfile, removeLockfile } from '../state.js';
import EngineStatus from '../components/EngineStatus.js';
import PlanApproval from '../components/PlanApproval.js';

/** Listener that receives engine state updates. */
type StateListener = (state: EngineState, issue: IssueData | null, stats: EngineStats) => void;

/** Simple pub/sub bridge between the engine callback (non-React) and the React component. */
interface StateEmitter {
  listener: StateListener | null;
  emit: StateListener;
  /** Re-emit the last known state. Used by approvalHandler to notify React after setting the ref. */
  reEmit: () => void;
}

function createStateEmitter(): StateEmitter {
  let lastArgs: [EngineState, IssueData | null, EngineStats] | null = null;
  const emitter: StateEmitter = {
    listener: null,
    emit(state, issue, stats) {
      lastArgs = [state, issue, stats];
      emitter.listener?.(state, issue, stats);
    },
    reEmit() {
      if (lastArgs !== null) {
        emitter.listener?.(...lastArgs);
      }
    },
  };
  return emitter;
}

/** Pending approval that the React component can resolve. */
interface PendingApproval {
  plan: DevelopmentPlan;
  resolve: (decision: 'approve' | 'reject' | 'skip') => void;
}

interface StartAppProps {
  engine: TammaEngine;
  once: boolean;
  stateEmitter: StateEmitter;
  approvalRef: React.MutableRefObject<PendingApproval | null>;
}

function StartApp({ engine, once, stateEmitter, approvalRef }: StartAppProps): React.JSX.Element {
  const [state, setState] = useState<EngineState>(EngineState.IDLE);
  const [issue, setIssue] = useState<{ number: number; title: string } | null>(null);
  const [stats, setStats] = useState<EngineStats>({ issuesProcessed: 0, totalCostUsd: 0, startedAt: Date.now() });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  // Subscribe to engine state changes
  useEffect(() => {
    stateEmitter.listener = (newState, newIssue, newStats) => {
      setState(newState);
      setIssue(newIssue !== null ? { number: newIssue.number, title: newIssue.title } : null);
      setStats(newStats);

      // Check if there's a pending approval to display
      if (newState === EngineState.AWAITING_APPROVAL && approvalRef.current !== null) {
        setPendingApproval(approvalRef.current);
      } else {
        setPendingApproval(null);
      }
    };

    return () => {
      stateEmitter.listener = null;
    };
  }, [stateEmitter, approvalRef]);

  const handleApprovalDecision = useCallback((decision: 'approve' | 'reject' | 'skip') => {
    if (pendingApproval !== null) {
      pendingApproval.resolve(decision);
      setPendingApproval(null);
      approvalRef.current = null;
    }
  }, [pendingApproval, approvalRef]);

  // Start the engine on first render
  useEffect(() => {
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
  }, [engine, once]);

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

  // Show PlanApproval when awaiting approval
  if (pendingApproval !== null) {
    return <PlanApproval plan={pendingApproval.plan} onDecision={handleApprovalDecision} />;
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

  // State emitter bridges engine callbacks → React state
  const stateEmitter = createStateEmitter();

  // Approval ref holds the pending promise for Ink-based approval
  const approvalRef: { current: PendingApproval | null } = { current: null };

  // Ink-based approval handler: sets up a promise and waits for the React component to resolve it.
  // Note: onStateChange fires BEFORE approvalHandler is called (setState → onStateChange → approvalHandler),
  // so we must re-emit after setting the ref to notify the React component.
  const approvalHandler: ApprovalHandler = (plan) => {
    return new Promise<'approve' | 'reject' | 'skip'>((resolve) => {
      approvalRef.current = { plan, resolve };
      stateEmitter.reEmit();
    });
  };

  // Create engine with combined state change handler
  const engine = new TammaEngine({
    config,
    platform,
    agent,
    logger,
    onStateChange: (state, issue, stats) => {
      writeLockfile(state, issue, stats);
      stateEmitter.emit(state, issue, stats);
    },
    approvalHandler,
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
      stateEmitter={stateEmitter}
      approvalRef={approvalRef}
    />,
  );

  await waitUntilExit();
}
