import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { EngineState } from '@tamma/shared';
import type { EngineStats } from '@tamma/orchestrator';
import { colorProp } from '../colors.js';
import { formatDuration } from '../utils.js';

interface EngineStatusProps {
  state: EngineState;
  issue: { number: number; title: string } | null;
  stats: EngineStats;
  compact?: boolean;
}

const STATE_LABELS: Record<EngineState, string> = {
  [EngineState.IDLE]: 'Idle — waiting for issues',
  [EngineState.SELECTING_ISSUE]: 'Selecting issue...',
  [EngineState.ANALYZING]: 'Analyzing issue...',
  [EngineState.PLANNING]: 'Generating plan...',
  [EngineState.AWAITING_APPROVAL]: 'Awaiting approval',
  [EngineState.IMPLEMENTING]: 'Implementing changes...',
  [EngineState.CREATING_PR]: 'Creating pull request...',
  [EngineState.MONITORING]: 'Monitoring CI...',
  [EngineState.MERGING]: 'Merging PR...',
  [EngineState.ERROR]: 'Error',
};

const STATE_COLORS: Record<EngineState, string> = {
  [EngineState.IDLE]: 'gray',
  [EngineState.SELECTING_ISSUE]: 'cyan',
  [EngineState.ANALYZING]: 'cyan',
  [EngineState.PLANNING]: 'yellow',
  [EngineState.AWAITING_APPROVAL]: 'magenta',
  [EngineState.IMPLEMENTING]: 'blue',
  [EngineState.CREATING_PR]: 'blue',
  [EngineState.MONITORING]: 'yellow',
  [EngineState.MERGING]: 'green',
  [EngineState.ERROR]: 'red',
};

function formatUptime(startedAt: number): string {
  return formatDuration(Date.now() - startedAt);
}

const isActive = (state: EngineState): boolean =>
  state !== EngineState.IDLE && state !== EngineState.ERROR;

export default function EngineStatus({ state, issue, stats, compact = false }: EngineStatusProps): React.JSX.Element {
  const [uptime, setUptime] = useState(formatUptime(stats.startedAt));

  useEffect(() => {
    const timer = setInterval(() => {
      setUptime(formatUptime(stats.startedAt));
    }, 1000);
    return () => { clearInterval(timer); };
  }, [stats.startedAt]);

  const c = STATE_COLORS[state];

  if (compact) {
    return (
      <Box paddingX={1}>
        <Text bold>Tamma Engine</Text>
        <Text> — </Text>
        {isActive(state) ? (
          <Text {...colorProp(c)}>
            <Spinner type="dots" /> {STATE_LABELS[state]}
          </Text>
        ) : (
          <Text {...colorProp(c)}>{STATE_LABELS[state]}</Text>
        )}
        {issue !== null && (
          <>
            <Text dimColor> | Issue: </Text>
            <Text>#{issue.number} {issue.title}</Text>
          </>
        )}
        <Text dimColor> | </Text>
        <Text>{uptime}</Text>
        <Text dimColor> | </Text>
        <Text>{stats.issuesProcessed} done</Text>
        <Text dimColor> | </Text>
        <Text>${stats.totalCostUsd.toFixed(2)}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold>Tamma Engine</Text>
        <Text> — </Text>
        {isActive(state) ? (
          <Text {...colorProp(c)}>
            <Spinner type="dots" /> {STATE_LABELS[state]}
          </Text>
        ) : (
          <Text {...colorProp(c)}>{STATE_LABELS[state]}</Text>
        )}
      </Box>

      {issue !== null && (
        <Box>
          <Text dimColor>Issue: </Text>
          <Text>#{issue.number} {issue.title}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Uptime: </Text>
        <Text>{uptime}</Text>
        <Text>  </Text>
        <Text dimColor>Processed: </Text>
        <Text>{stats.issuesProcessed}</Text>
        <Text>  </Text>
        <Text dimColor>Cost: </Text>
        <Text>${stats.totalCostUsd.toFixed(2)}</Text>
      </Box>
    </Box>
  );
}
