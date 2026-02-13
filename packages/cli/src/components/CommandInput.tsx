import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { colorProp } from '../colors.js';

interface CommandInputProps {
  onSubmit: (input: string) => void;
}

export default function CommandInput({ onSubmit }: CommandInputProps): React.JSX.Element {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(
    (input: string) => {
      if (input.trim().length > 0) {
        onSubmit(input.trim());
      }
      setValue('');
    },
    [onSubmit],
  );

  return (
    <Box>
      <Text bold {...colorProp('cyan')}>&gt; </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder="Type /help for commands..."
      />
    </Box>
  );
}
