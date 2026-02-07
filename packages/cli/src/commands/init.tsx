import React, { useState, useCallback } from 'react';
import { render, Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateConfigFile } from '../config.js';

type Step = 'token' | 'owner' | 'repo' | 'labels' | 'approval' | 'done';

interface Answers {
  token: string;
  owner: string;
  repo: string;
  labels: string;
  approvalMode: string;
}

function InitWizard(): React.JSX.Element {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('token');
  const [inputValue, setInputValue] = useState('');
  const [answers, setAnswers] = useState<Answers>({
    token: '',
    owner: '',
    repo: '',
    labels: 'tamma',
    approvalMode: 'cli',
  });
  const [outputPath, setOutputPath] = useState<string>('');

  const handleSubmit = useCallback(
    (value: string) => {
      setInputValue('');
      switch (step) {
        case 'token':
          setAnswers((a) => ({ ...a, token: value }));
          setStep('owner');
          break;
        case 'owner':
          setAnswers((a) => ({ ...a, owner: value }));
          setStep('repo');
          break;
        case 'repo':
          setAnswers((a) => ({ ...a, repo: value }));
          setStep('labels');
          break;
        case 'labels':
          setAnswers((a) => ({ ...a, labels: value || 'tamma' }));
          setStep('approval');
          break;
        default:
          break;
      }
    },
    [step],
  );

  const handleApprovalSelect = useCallback(
    (item: { value: string }) => {
      const updatedAnswers = { ...answers, approvalMode: item.value };
      setAnswers(updatedAnswers);

      // Write config file
      const configContent = generateConfigFile(updatedAnswers);
      const dest = path.resolve('tamma.config.json');
      fs.writeFileSync(dest, configContent, 'utf-8');
      setOutputPath(dest);
      setStep('done');

      // Exit after a brief delay
      setTimeout(() => { exit(); }, 100);
    },
    [answers, exit],
  );

  if (step === 'done') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="green" bold>Configuration saved to {outputPath}</Text>
        <Text dimColor>
          Tip: Add your GitHub token to the GITHUB_TOKEN environment variable
          instead of storing it in the config file.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Tamma Configuration Wizard</Text>
      <Text dimColor>{'─'.repeat(40)}</Text>

      {step === 'token' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>GitHub Token (or press enter to use GITHUB_TOKEN env var):</Text>
          <TextInput value={inputValue} onChange={setInputValue} onSubmit={handleSubmit} />
        </Box>
      )}

      {step === 'owner' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>GitHub Owner (organization or username):</Text>
          <TextInput value={inputValue} onChange={setInputValue} onSubmit={handleSubmit} />
        </Box>
      )}

      {step === 'repo' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>GitHub Repository name:</Text>
          <TextInput value={inputValue} onChange={setInputValue} onSubmit={handleSubmit} />
        </Box>
      )}

      {step === 'labels' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Issue labels (comma-separated, default: tamma):</Text>
          <TextInput value={inputValue} onChange={setInputValue} onSubmit={handleSubmit} />
        </Box>
      )}

      {step === 'approval' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Approval mode:</Text>
          <SelectInput
            items={[
              { label: 'CLI — manual approval before implementation', value: 'cli' },
              { label: 'Auto — approve all plans automatically', value: 'auto' },
            ]}
            onSelect={handleApprovalSelect}
          />
        </Box>
      )}
    </Box>
  );
}

export async function initCommand(): Promise<void> {
  const dest = path.resolve('tamma.config.json');
  if (fs.existsSync(dest)) {
    console.log(`Config file already exists at ${dest}`);
    console.log('Delete it first if you want to regenerate.');
    return;
  }

  const { waitUntilExit } = render(<InitWizard />);
  await waitUntilExit();
}
