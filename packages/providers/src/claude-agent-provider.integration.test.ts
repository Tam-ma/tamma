import { describe, it, expect } from 'vitest';
import { ClaudeAgentProvider } from './claude-agent-provider.js';

const hasClaudeCli = process.env['INTEGRATION_TEST_CLAUDE'] === 'true';

describe.skipIf(!hasClaudeCli)('ClaudeAgentProvider Integration', () => {
  it('should verify claude CLI is available', async () => {
    const provider = new ClaudeAgentProvider();
    const available = await provider.isAvailable();
    expect(available).toBe(true);
    await provider.dispose();
  });

  it('should execute a simple task', async () => {
    const provider = new ClaudeAgentProvider();
    const result = await provider.executeTask({
      prompt: 'Respond with exactly: "hello integration test"',
      cwd: process.cwd(),
      maxBudgetUsd: 0.01,
    });
    expect(result.success).toBe(true);
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.costUsd).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThan(0);
    await provider.dispose();
  });

  it('should emit progress events', async () => {
    const provider = new ClaudeAgentProvider();
    const events: unknown[] = [];
    const result = await provider.executeTask(
      {
        prompt: 'Say hello',
        cwd: process.cwd(),
        maxBudgetUsd: 0.01,
      },
      (event) => events.push(event),
    );
    expect(result.success).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    await provider.dispose();
  });

  it('should support structured output with json schema', async () => {
    const provider = new ClaudeAgentProvider();
    const result = await provider.executeTask({
      prompt: 'Return a JSON object with a "greeting" field set to "hello"',
      cwd: process.cwd(),
      maxBudgetUsd: 0.01,
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { greeting: { type: 'string' } },
          required: ['greeting'],
        },
      },
    });
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output) as { greeting: string };
    expect(parsed.greeting).toBeDefined();
    await provider.dispose();
  });
});
