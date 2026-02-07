import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { DevelopmentPlan } from '@tamma/shared';

interface PlanApprovalProps {
  plan: DevelopmentPlan;
  onDecision: (decision: 'approve' | 'reject' | 'skip') => void;
}

const COMPLEXITY_COLORS: Record<string, string> = {
  low: 'green',
  medium: 'yellow',
  high: 'red',
};

export default function PlanApproval({ plan, onDecision }: PlanApprovalProps): React.JSX.Element {
  const [decided, setDecided] = useState(false);
  const { exit } = useApp();

  useInput((input) => {
    if (decided) return;

    if (input === 'y') {
      setDecided(true);
      onDecision('approve');
    } else if (input === 'n') {
      setDecided(true);
      onDecision('reject');
    } else if (input === 's') {
      setDecided(true);
      onDecision('skip');
    } else if (input === 'q') {
      exit();
    }
  });

  const complexityColor = COMPLEXITY_COLORS[plan.estimatedComplexity] ?? 'white';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold color="cyan">{'═'.repeat(60)}</Text>
      </Box>
      <Box>
        <Text bold>Development Plan for Issue #{plan.issueNumber}</Text>
      </Box>
      <Box>
        <Text bold color="cyan">{'═'.repeat(60)}</Text>
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
              <Text color={fc.action === 'delete' ? 'red' : fc.action === 'create' ? 'green' : 'yellow'}>
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
          <Text color={complexityColor}>{plan.estimatedComplexity}</Text>
        </Box>

        {plan.risks.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold color="red">Risks:</Text>
            {plan.risks.map((risk, i) => (
              <Box key={i} marginLeft={2}>
                <Text>- {risk}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text bold color="cyan">{'═'.repeat(60)}</Text>
      </Box>

      {!decided && (
        <Box marginTop={1}>
          <Text bold>
            [<Text color="green">y</Text>]es  [<Text color="red">n</Text>]o  [<Text color="yellow">s</Text>]kip  [<Text color="gray">q</Text>]uit
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
