import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { colorProp } from '../colors.js';
import type { Issue } from '@tamma/platforms';

interface IssueSelectorProps {
  issues: Issue[];
  onSelect: (issue: Issue) => void;
  onSkip: () => void;
}

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(ms / 86_400_000);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

export default function IssueSelector({ issues, onSelect, onSkip }: IssueSelectorProps): React.JSX.Element {
  const items = [
    ...issues.slice(0, 10).map((issue) => ({
      label: `#${issue.number}: ${issue.title} [${issue.labels.join(', ')}] (${formatTimeAgo(issue.createdAt)})`,
      value: String(issue.number),
    })),
    { label: 'Skip — wait for next poll', value: '__skip__' },
  ];

  const handleSelect = (item: { value: string }): void => {
    if (item.value === '__skip__') {
      onSkip();
      return;
    }
    const selected = issues.find((i) => i.number === parseInt(item.value, 10));
    if (selected !== undefined) {
      onSelect(selected);
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold {...colorProp('cyan')}>Select an issue to process:</Text>
      <Text dimColor>{'─'.repeat(40)}</Text>
      <SelectInput items={items} onSelect={handleSelect} />
    </Box>
  );
}
