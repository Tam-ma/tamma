import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import { EngineState } from '@tamma/shared';
import type { IssueData } from '@tamma/shared';
import type { EngineStats } from '@tamma/orchestrator';
import type { StateEmitter, PendingApproval, CommandContext } from '../types.js';
import type { LogEmitter } from '../log-emitter.js';
import { createCommandRegistry, executeSlashCommand } from '../commands/registry.js';
import EngineStatus from './EngineStatus.js';
import LogArea from './LogArea.js';
import CommandInput from './CommandInput.js';
import PlanApproval from './PlanApproval.js';

interface SessionLayoutProps {
  stateEmitter: StateEmitter;
  logEmitter: LogEmitter;
  approvalRef: React.MutableRefObject<PendingApproval | null>;
  commandContext: CommandContext;
}

export default function SessionLayout({
  stateEmitter,
  logEmitter,
  approvalRef,
  commandContext,
}: SessionLayoutProps): React.JSX.Element {
  const [state, setState] = useState<EngineState>(EngineState.IDLE);
  const [issue, setIssue] = useState<{ number: number; title: string } | null>(null);
  const [stats, setStats] = useState<EngineStats>({ issuesProcessed: 0, totalCostUsd: 0, startedAt: Date.now() });
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [showDebug, setShowDebug] = useState(commandContext.showDebug);
  const [registry] = useState(() => createCommandRegistry());

  // Keep commandContext in sync with local state
  useEffect(() => {
    commandContext.setShowDebug = (show: boolean) => { setShowDebug(show); };
  }, [commandContext]);

  // Subscribe to engine state changes
  useEffect(() => {
    stateEmitter.listener = (newState, newIssue: IssueData | null, newStats) => {
      setState(newState);
      setIssue(newIssue !== null ? { number: newIssue.number, title: newIssue.title } : null);
      setStats(newStats);

      // Sync context for slash commands
      commandContext.state = newState;
      commandContext.issue = newIssue;
      commandContext.stats = newStats;

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
  }, [stateEmitter, approvalRef, commandContext]);

  const handleApprovalDecision = useCallback((decision: 'approve' | 'reject' | 'skip', feedback?: string) => {
    if (pendingApproval !== null) {
      pendingApproval.resolve(decision);
      setPendingApproval(null);
      approvalRef.current = null;

      if (decision === 'reject' && feedback !== undefined) {
        logEmitter.emit('info', `Rejection feedback: ${feedback}`);
      }
    }
  }, [pendingApproval, approvalRef, logEmitter]);

  const handleCommand = useCallback((input: string) => {
    // Update context with latest values
    commandContext.showDebug = showDebug;
    executeSlashCommand(input, registry, commandContext);
  }, [registry, commandContext, showDebug]);

  const terminalHeight = process.stdout.rows ?? 24;
  // Reserve: 1 header + 1 separator + 1 command input + 2 padding = 5 lines
  const logHeight = Math.max(5, terminalHeight - 5);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <EngineStatus state={state} issue={issue} stats={stats} compact />
      <Box paddingX={1}>
        <Text dimColor>{'─'.repeat(Math.min(80, (process.stdout.columns ?? 80) - 2))}</Text>
      </Box>

      {/* Main area */}
      {pendingApproval !== null ? (
        <PlanApproval plan={pendingApproval.plan} onDecision={handleApprovalDecision} onQuit={() => { commandContext.shutdown(); }} />
      ) : (
        <Box paddingX={1}>
          <LogArea logEmitter={logEmitter} showDebug={showDebug} height={logHeight} />
        </Box>
      )}

      {/* Separator */}
      <Box paddingX={1}>
        <Text dimColor>{'─'.repeat(Math.min(80, (process.stdout.columns ?? 80) - 2))}</Text>
      </Box>

      {/* Command input */}
      <Box paddingX={1}>
        <CommandInput onSubmit={handleCommand} />
      </Box>
    </Box>
  );
}
