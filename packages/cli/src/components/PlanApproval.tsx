import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import type { DevelopmentPlan } from '@tamma/shared';
import { colorProp } from '../colors.js';

interface PlanApprovalProps {
  plan: DevelopmentPlan;
  onDecision: (decision: 'approve' | 'reject' | 'skip', feedback?: string) => void;
  onQuit?: () => void;
}

const COMPLEXITY_COLORS: Record<string, string> = {
  low: 'green',
  medium: 'yellow',
  high: 'red',
};

export default function PlanApproval({ plan, onDecision, onQuit }: PlanApprovalProps): React.JSX.Element {
  const [decided, setDecided] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedback, setFeedback] = useState('');
  const { exit } = useApp();

  useInput((input) => {
    if (decided || feedbackMode) return;

    if (input === 'y') {
      setDecided(true);
      onDecision('approve');
    } else if (input === 'n') {
      setFeedbackMode(true);
    } else if (input === 's') {
      setDecided(true);
      onDecision('skip');
    } else if (input === 'q') {
      if (onQuit !== undefined) {
        onQuit();
      }
      exit();
    }
  });

  const handleFeedbackSubmit = (value: string) => {
    setDecided(true);
    setFeedbackMode(false);
    onDecision('reject', value || undefined);
  };

  const complexityColor = COMPLEXITY_COLORS[plan.estimatedComplexity] ?? 'white';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold {...colorProp('cyan')}>{'═'.repeat(60)}</Text>
      </Box>
      <Box>
        <Text bold>Development Plan for Issue #{plan.issueNumber}</Text>
      </Box>
      <Box>
        <Text bold {...colorProp('cyan')}>{'═'.repeat(60)}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text bold>Summary: </Text>
          <Text>{plan.summary}</Text>
        </Box>

        <Box marginTop={1}>
          <Text bold>Approach: </Text>
          <Text>{plan.approach}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>File Changes:</Text>
          {plan.fileChanges.map((fc, i) => (
            <Box key={i} marginLeft={2}>
              <Text {...colorProp(fc.action === 'delete' ? 'red' : fc.action === 'create' ? 'green' : 'yellow')}>
                [{fc.action}]
              </Text>
              <Text> {fc.filePath}: </Text>
              <Text dimColor>{fc.description}</Text>
            </Box>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text bold>Testing: </Text>
          <Text>{plan.testingStrategy}</Text>
        </Box>

        <Box marginTop={1}>
          <Text bold>Complexity: </Text>
          <Text {...colorProp(complexityColor)}>{plan.estimatedComplexity}</Text>
        </Box>

        {plan.risks.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold {...colorProp('red')}>Risks:</Text>
            {plan.risks.map((risk, i) => (
              <Box key={i} marginLeft={2}>
                <Text>- {risk}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text bold {...colorProp('cyan')}>{'═'.repeat(60)}</Text>
      </Box>

      {feedbackMode && (
        <Box marginTop={1} flexDirection="column">
          <Text>Rejection feedback (press Enter to skip):</Text>
          <Box>
            <Text bold {...colorProp('red')}>&gt; </Text>
            <TextInput value={feedback} onChange={setFeedback} onSubmit={handleFeedbackSubmit} />
          </Box>
        </Box>
      )}

      {!decided && !feedbackMode && (
        <Box marginTop={1}>
          <Text bold>
            [<Text {...colorProp('green')}>y</Text>]es  [<Text {...colorProp('red')}>n</Text>]o  [<Text {...colorProp('yellow')}>s</Text>]kip  [<Text {...colorProp('gray')}>q</Text>]uit
          </Text>
        </Box>
      )}

      {decided && (
        <Box marginTop={1}>
          <Text dimColor>Decision recorded.</Text>
        </Box>
      )}
    </Box>
  );
}
