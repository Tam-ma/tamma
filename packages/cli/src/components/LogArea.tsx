import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { colorProp } from '../colors.js';
import type { LogEmitter } from '../log-emitter.js';
import type { LogEntry } from '../types.js';

interface LogAreaProps {
  logEmitter: LogEmitter;
  showDebug?: boolean;
  height?: number;
}

const LEVEL_COLORS: Record<string, string> = {
  debug: 'gray',
  info: 'white',
  warn: 'yellow',
  error: 'red',
};

const LEVEL_LABELS: Record<string, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function LogArea({ logEmitter, showDebug = false, height = 20 }: LogAreaProps): React.JSX.Element {
  const [entries, setEntries] = useState<LogEntry[]>(() => [...logEmitter.getHistory()]);

  useEffect(() => {
    const unsubscribe = logEmitter.subscribe((entry) => {
      setEntries((prev) => {
        const next = [...prev, entry];
        return next.length > 1000 ? next.slice(-1000) : next;
      });
    });
    return unsubscribe;
  }, [logEmitter]);

  const filtered = showDebug
    ? entries
    : entries.filter((e) => e.level !== 'debug');

  const visible = filtered.slice(-height);

  return (
    <Box flexDirection="column" height={height}>
      {visible.map((entry, i) => {
        const c = LEVEL_COLORS[entry.level] ?? 'white';
        const label = LEVEL_LABELS[entry.level] ?? 'UNK';
        return (
          <Box key={i}>
            <Text dimColor>[{formatTimestamp(entry.timestamp)}]</Text>
            <Text {...colorProp(c)}> {label} </Text>
            <Text {...colorProp(c)}>{entry.message}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
