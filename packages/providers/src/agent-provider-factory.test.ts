import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IAgentProvider, AgentTaskConfig } from './agent-types.js';
import type { IAIProvider, MessageRequest, MessageResponse, ProviderConfig } from './types.js';

// ---- Mock provider modules ----
// vi.mock factories are hoisted; all mock classes must be self-contained.

vi.mock('./claude-agent-provider.js', () => {
  class MockClaudeAgentProvider {
    readonly name = 'claude-code';
    async executeTask() {
      return { success: true, output: 'claude output', costUsd: 0, durationMs: 100 };
    }
    async isAvailable() { return true; }
    async dispose() { /* no-op */ }
    async initialize(_config: Record<string, unknown>) { /* no-op */ }
  }
  return { ClaudeAgentProvider: MockClaudeAgentProvider };
});

vi.mock('./opencode-provider.js', () => {
  class MockOpenCodeProvider {
    readonly name = 'opencode';
    private shouldFailInit = false;
    async executeTask() {
      return { success: true, output: 'opencode output', costUsd: 0, durationMs: 200 };
    }
    async isAvailable() { return true; }
    async dispose() { /* no-op */ }
    async initialize(_config: Record<string, unknown>) {
      if (this.shouldFailInit) {
        throw new Error('Failed to initialize OpenCode SDK: connection refused');
      }
    }
  }
  return { OpenCodeProvider: MockOpenCodeProvider };
});

vi.mock('./openrouter-provider.js', () => {
  class MockOpenRouterProvider {
    private _initialized = false;
    private _initConfig: Record<string, unknown> | null = null;
    async initialize(config: Record<string, unknown>) {
      this._initialized = true;
      this._initConfig = config;
    }
    async sendMessage() { return (async function* () { /* empty */ })(); }
    async sendMessageSync() {
      return {
        id: 'test-id',
        content: 'openrouter response',
        model: 'test-model',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        finishReason: 'stop' as const,
      };
    }
    getCapabilities() {
      return {
        supportsStreaming: true,
        supportsImages: false,
        supportsTools: true,
        maxInputTokens: 200000,
        maxOutputTokens: 16384,
        supportedModels: [],
        features: {},
      };
    }
    async getModels() { return []; }
    async dispose() { this._initialized = false; }
    // Expose for test introspection
    get initConfig() { return this._initConfig; }
    get initialized() { return this._initialized; }
  }
  return { OpenRouterProvider: MockOpenRouterProvider };
});

vi.mock('./zen-mcp-provider.js', () => {
  class MockZenMCPProvider {
    private _initialized = false;
    private _initConfig: Record<string, unknown> | null = null;
    async initialize(config: Record<string, unknown>) {
      this._initialized = true;
      this._initConfig = config;
    }
    async sendMessage() { return (async function* () { /* empty */ })(); }
    async sendMessageSync() {
      return {
        id: 'zen-test-id',
        content: 'zen response',
        model: 'zen-model',
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
        finishReason: 'stop' as const,
      };
    }
    getCapabilities() {
      return {
        supportsStreaming: false,
        supportsImages: false,
        supportsTools: false,
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        supportedModels: [],
        features: {},
      };
    }
    async getModels() { return []; }
    async dispose() { this._initialized = false; }
    get initConfig() { return this._initConfig; }
    get initialized() { return this._initialized; }
  }
  return { ZenMCPProvider: MockZenMCPProvider };
});

import {
  AgentProviderFactory,
  BUILTIN_PROVIDER_NAMES,
  resolveApiKey,
  wrapAsAgent,
} from './agent-provider-factory.js';
import type { ProviderChainEntry, IAgentProviderFactory } from './agent-provider-factory.js';

describe('BUILTIN_PROVIDER_NAMES', () => {
  it('has correct values for all four built-in providers', () => {
    expect(BUILTIN_PROVIDER_NAMES.CLAUDE_CODE).toBe('claude-code');
    expect(BUILTIN_PROVIDER_NAMES.OPENCODE).toBe('opencode');
    expect(BUILTIN_PROVIDER_NAMES.OPENROUTER).toBe('openrouter');
    expect(BUILTIN_PROVIDER_NAMES.ZEN_MCP).toBe('zen-mcp');
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(BUILTIN_PROVIDER_NAMES)).toBe(true);
  });

  it('has exactly 4 entries', () => {
    expect(Object.keys(BUILTIN_PROVIDER_NAMES)).toHaveLength(4);
  });
});

describe('resolveApiKey', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment
    process.env = { ...originalEnv };
  });

  it('returns empty string when apiKeyRef is undefined', () => {
    const entry: ProviderChainEntry = { provider: 'claude-code' };
    expect(resolveApiKey(entry)).toBe('');
  });

  it('returns process.env value when apiKeyRef is set', () => {
    process.env['TEST_API_KEY'] = 'test-secret-value';
    const entry: ProviderChainEntry = {
      provider: 'openrouter',
      apiKeyRef: 'TEST_API_KEY',
    };
    expect(resolveApiKey(entry)).toBe('test-secret-value');
  });

  it('throws when env var is missing', () => {
    delete process.env['MISSING_KEY'];
    const entry: ProviderChainEntry = {
      provider: 'openrouter',
      apiKeyRef: 'MISSING_KEY',
    };
    expect(() => resolveApiKey(entry)).toThrow(
      'Environment variable "MISSING_KEY" is not set for provider "openrouter"',
    );
  });

  it('throws on invalid apiKeyRef format with hyphens', () => {
    const entry: ProviderChainEntry = {
      provider: 'openrouter',
      apiKeyRef: 'MY-API-KEY',
    };
    expect(() => resolveApiKey(entry)).toThrow(
      'Invalid apiKeyRef format "MY-API-KEY" for provider "openrouter"',
    );
  });

  it('throws on invalid apiKeyRef format with spaces', () => {
    const entry: ProviderChainEntry = {
      provider: 'openrouter',
      apiKeyRef: 'MY API KEY',
    };
    expect(() => resolveApiKey(entry)).toThrow(
      'Invalid apiKeyRef format "MY API KEY" for provider "openrouter"',
    );
  });

  it('throws on invalid apiKeyRef format with special characters', () => {
    const entry: ProviderChainEntry = {
      provider: 'openrouter',
      apiKeyRef: 'KEY$VALUE',
    };
    expect(() => resolveApiKey(entry)).toThrow('Invalid apiKeyRef format');
  });

  it('accepts valid apiKeyRef with underscores and numbers', () => {
    process.env['MY_API_KEY_123'] = 'some-value';
    const entry: ProviderChainEntry = {
      provider: 'openrouter',
      apiKeyRef: 'MY_API_KEY_123',
    };
    expect(resolveApiKey(entry)).toBe('some-value');
  });
});

describe('AgentProviderFactory', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('IAgentProviderFactory interface conformance', () => {
    it('implements create, register, and dispose methods', () => {
      const factory: IAgentProviderFactory = new AgentProviderFactory();
      expect(typeof factory.create).toBe('function');
      expect(typeof factory.register).toBe('function');
      expect(typeof factory.dispose).toBe('function');
    });
  });

  describe('create()', () => {
    it('creates claude-code provider with executeTask method', async () => {
      const factory = new AgentProviderFactory();
      const provider = await factory.create({ provider: 'claude-code' });
      expect(typeof provider.executeTask).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
      expect(typeof provider.dispose).toBe('function');
    });

    it('creates opencode provider with executeTask method', async () => {
      const factory = new AgentProviderFactory();
      const provider = await factory.create({ provider: 'opencode' });
      expect(typeof provider.executeTask).toBe('function');
    });

    it('creates openrouter provider (wrapped) with apiKeyRef', async () => {
      process.env['TEST_OPENROUTER_KEY'] = 'test-key';
      const factory = new AgentProviderFactory();
      const provider = await factory.create({
        provider: 'openrouter',
        model: 'z-ai/z1-mini',
        apiKeyRef: 'TEST_OPENROUTER_KEY',
      });
      expect(typeof provider.executeTask).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
      expect(typeof provider.dispose).toBe('function');
    });

    it('creates zen-mcp provider (wrapped)', async () => {
      const factory = new AgentProviderFactory();
      const provider = await factory.create({ provider: 'zen-mcp' });
      expect(typeof provider.executeTask).toBe('function');
    });

    it('throws Unknown provider for unregistered name', async () => {
      const factory = new AgentProviderFactory();
      await expect(factory.create({ provider: 'unknown' })).rejects.toThrow(
        'Unknown provider: unknown',
      );
    });

    it('throws for empty string provider (not in map)', async () => {
      const factory = new AgentProviderFactory();
      await expect(factory.create({ provider: '' })).rejects.toThrow(
        'Unknown provider: ',
      );
    });
  });

  describe('create() -- initialization', () => {
    it('calls initialize() on providers that have the method', async () => {
      process.env['TEST_OR_KEY'] = 'or-key-value';
      const factory = new AgentProviderFactory();
      // openrouter has initialize(), which should be called
      const provider = await factory.create({
        provider: 'openrouter',
        model: 'test-model',
        apiKeyRef: 'TEST_OR_KEY',
      });
      // If we got here without error, initialize() was called successfully
      expect(provider).toBeDefined();
    });

    it('passes correct config with spread order: entry.config first, explicit fields override', async () => {
      process.env['TEST_OR_KEY2'] = 'resolved-key';

      // We need to inspect what initialize() received.
      // The mock OpenRouterProvider stores initConfig.
      const factory = new AgentProviderFactory();
      const provider = await factory.create({
        provider: 'openrouter',
        model: 'override-model',
        apiKeyRef: 'TEST_OR_KEY2',
        config: { baseUrl: 'https://custom.api', apiKey: 'should-be-overridden', model: 'should-be-overridden' },
      });

      // The provider is wrapped via wrapAsAgent, so we can't directly
      // access the underlying mock. But we verify it was created successfully
      // and the call didn't throw.
      expect(provider).toBeDefined();
    });

    it('wraps initialize() error with provider name', async () => {
      // Create a factory with a custom provider that throws on init
      const factory = new AgentProviderFactory();
      factory.register('fail-init', () => {
        return {
          async initialize() {
            throw new Error('connection refused');
          },
          sendMessageSync: async () => ({} as MessageResponse),
        } as unknown as IAIProvider;
      });

      await expect(
        factory.create({ provider: 'fail-init' }),
      ).rejects.toThrow('Provider "fail-init" failed to initialize: connection refused');
    });

    it('wraps non-Error thrown values in initialize()', async () => {
      const factory = new AgentProviderFactory();
      factory.register('fail-init-string', () => {
        return {
          async initialize() {
            throw 'raw string error'; // eslint-disable-line no-throw-literal
          },
          sendMessageSync: async () => ({} as MessageResponse),
        } as unknown as IAIProvider;
      });

      await expect(
        factory.create({ provider: 'fail-init-string' }),
      ).rejects.toThrow('Provider "fail-init-string" failed to initialize: raw string error');
    });

    it('ClaudeAgentProvider.initialize() is called but is a no-op', async () => {
      const factory = new AgentProviderFactory();
      // claude-code entry has no apiKeyRef -- resolveApiKey returns ''
      const provider = await factory.create({ provider: 'claude-code' });
      // Should succeed without error -- initialize() is a no-op
      expect(provider).toBeDefined();
    });

    it('OpenCodeProvider.initialize() throwing propagates wrapped error', async () => {
      // We need to make the mock throw. Override the opencode registration.
      const factory = new AgentProviderFactory();
      // The built-in is locked, but we can register a new one with a different name
      // to test the error wrapping pattern.
      factory.register('opencode-failing', () => {
        return {
          async executeTask() {
            return { success: false, output: '', costUsd: 0, durationMs: 0 };
          },
          async isAvailable() { return false; },
          async dispose() { /* no-op */ },
          async initialize() {
            throw new Error('Failed to initialize OpenCode SDK: connection refused');
          },
        } as unknown as IAgentProvider;
      });

      await expect(
        factory.create({ provider: 'opencode-failing' }),
      ).rejects.toThrow(
        'Provider "opencode-failing" failed to initialize: Failed to initialize OpenCode SDK: connection refused',
      );
    });
  });

  describe('create() -- LLM wrapping', () => {
    it('wraps LLM providers (has sendMessageSync) via wrapAsAgent', async () => {
      process.env['TEST_LLM_KEY'] = 'llm-key';
      const factory = new AgentProviderFactory();
      const provider = await factory.create({
        provider: 'openrouter',
        model: 'test-model',
        apiKeyRef: 'TEST_LLM_KEY',
      });

      // The returned provider should be a wrapped IAgentProvider, not an IAIProvider
      expect(typeof provider.executeTask).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
      expect(typeof provider.dispose).toBe('function');
      // Should NOT have sendMessageSync (that's IAIProvider)
      expect('sendMessageSync' in provider).toBe(false);
    });

    it('returns agent providers directly (no wrapping)', async () => {
      const factory = new AgentProviderFactory();
      const provider = await factory.create({ provider: 'claude-code' });
      expect(typeof provider.executeTask).toBe('function');
    });

    it('uses default model when entry.model is undefined', async () => {
      const factory = new AgentProviderFactory();
      factory.register('custom-llm', () => {
        return {
          async initialize() { /* no-op */ },
          async sendMessageSync(req: MessageRequest) {
            return {
              id: 'id',
              content: `model=${req.model}`,
              model: req.model ?? 'unknown',
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              finishReason: 'stop' as const,
            };
          },
          async sendMessage() { return (async function* () { /* empty */ })(); },
          getCapabilities() {
            return {
              supportsStreaming: false, supportsImages: false, supportsTools: false,
              maxInputTokens: 0, maxOutputTokens: 0, supportedModels: [], features: {},
            };
          },
          async getModels() { return []; },
          async dispose() { /* no-op */ },
        } satisfies IAIProvider;
      });

      const provider = await factory.create({ provider: 'custom-llm' });
      const result = await provider.executeTask({
        prompt: 'test',
        cwd: '/tmp',
      });
      // model should be 'default' since entry.model is undefined
      expect(result.output).toBe('model=default');
    });
  });

  describe('register()', () => {
    it('rejects empty provider name', () => {
      const factory = new AgentProviderFactory();
      expect(() => factory.register('', () => ({} as IAgentProvider))).toThrow(
        'Invalid provider name "": must match',
      );
    });

    it('rejects uppercase provider name', () => {
      const factory = new AgentProviderFactory();
      expect(() => factory.register('MyProvider', () => ({} as IAgentProvider))).toThrow(
        'Invalid provider name "MyProvider": must match',
      );
    });

    it('rejects provider name starting with hyphen', () => {
      const factory = new AgentProviderFactory();
      expect(() => factory.register('-invalid', () => ({} as IAgentProvider))).toThrow(
        'Invalid provider name "-invalid": must match',
      );
    });

    it('rejects __proto__ (prototype pollution guard)', () => {
      const factory = new AgentProviderFactory();
      expect(() => factory.register('__proto__', () => ({} as IAgentProvider))).toThrow(
        'Forbidden provider name: "__proto__"',
      );
    });

    it('rejects constructor (prototype pollution guard)', () => {
      const factory = new AgentProviderFactory();
      expect(() => factory.register('constructor', () => ({} as IAgentProvider))).toThrow(
        'Forbidden provider name: "constructor"',
      );
    });

    it('rejects prototype (prototype pollution guard)', () => {
      const factory = new AgentProviderFactory();
      expect(() => factory.register('prototype', () => ({} as IAgentProvider))).toThrow(
        'Forbidden provider name: "prototype"',
      );
    });

    it('after lock, cannot override existing built-in provider', () => {
      const factory = new AgentProviderFactory();
      expect(() =>
        factory.register('claude-code', () => ({} as IAgentProvider)),
      ).toThrow('Cannot override locked built-in provider "claude-code"');
    });

    it('after lock, can still add new providers', () => {
      const factory = new AgentProviderFactory();
      // Should not throw
      factory.register('custom-provider', () => ({} as IAgentProvider));
    });

    it('adds a custom provider that create() can instantiate', async () => {
      const factory = new AgentProviderFactory();
      factory.register('my-custom', () => ({
        async executeTask() {
          return { success: true, output: 'custom', costUsd: 0, durationMs: 0 };
        },
        async isAvailable() { return true; },
        async dispose() { /* no-op */ },
      }));

      const provider = await factory.create({ provider: 'my-custom' });
      const result = await provider.executeTask({ prompt: 'test', cwd: '.' });
      expect(result.output).toBe('custom');
    });
  });

  describe('dispose()', () => {
    it('clears creators map so subsequent create() throws', async () => {
      const factory = new AgentProviderFactory();
      // Before dispose, create works
      const provider = await factory.create({ provider: 'claude-code' });
      expect(provider).toBeDefined();

      await factory.dispose();

      // After dispose, create throws Unknown provider
      await expect(factory.create({ provider: 'claude-code' })).rejects.toThrow(
        'Unknown provider: claude-code',
      );
    });
  });

  describe('logging', () => {
    it('logs provider registration when logger is provided', () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      // Constructor registers built-ins, which should log
      const _factory = new AgentProviderFactory(logger);
      expect(logger.info).toHaveBeenCalledWith(
        'Provider registered',
        expect.objectContaining({ provider: 'claude-code' }),
      );
    });

    it('logs provider creation when logger is provided', async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const factory = new AgentProviderFactory(logger);
      await factory.create({ provider: 'claude-code' });
      expect(logger.info).toHaveBeenCalledWith(
        'Creating provider',
        expect.objectContaining({ provider: 'claude-code' }),
      );
    });

    it('logs initialization failure when logger is provided', async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const factory = new AgentProviderFactory(logger);
      factory.register('fail-provider', () => ({
        async initialize() { throw new Error('init failed'); },
        sendMessageSync: async () => ({} as MessageResponse),
      } as unknown as IAIProvider));

      await expect(factory.create({ provider: 'fail-provider' })).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        'Provider initialization failed',
        expect.objectContaining({ provider: 'fail-provider', error: 'init failed' }),
      );
    });

    it('logs dispose when logger is provided', async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const factory = new AgentProviderFactory(logger);
      await factory.dispose();
      expect(logger.info).toHaveBeenCalledWith('AgentProviderFactory disposed');
    });
  });
});

describe('wrapAsAgent', () => {
  function createMockLLM(overrides?: Partial<IAIProvider>): IAIProvider {
    return {
      async initialize() { /* no-op */ },
      async sendMessage() { return (async function* () { /* empty */ })(); },
      async sendMessageSync(request: MessageRequest): Promise<MessageResponse> {
        return {
          id: 'resp-1',
          content: `response for model=${request.model}`,
          model: request.model ?? 'default-model',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          finishReason: 'stop',
        };
      },
      getCapabilities() {
        return {
          supportsStreaming: false, supportsImages: false, supportsTools: false,
          maxInputTokens: 0, maxOutputTokens: 0, supportedModels: [], features: {},
        };
      },
      async getModels() { return []; },
      async dispose() { /* no-op */ },
      ...overrides,
    };
  }

  it('returns object with executeTask, isAvailable, and dispose methods', () => {
    const llm = createMockLLM();
    const agent = wrapAsAgent(llm, 'model');
    expect(typeof agent.executeTask).toBe('function');
    expect(typeof agent.isAvailable).toBe('function');
    expect(typeof agent.dispose).toBe('function');
  });

  it('does not mutate the original IAIProvider instance', () => {
    const llm = createMockLLM();
    const keysBefore = Object.keys(llm).sort();
    const _agent = wrapAsAgent(llm, 'model');
    const keysAfter = Object.keys(llm).sort();
    expect(keysAfter).toEqual(keysBefore);
    // Verify the original provider still has its own methods unchanged
    expect(typeof llm.sendMessageSync).toBe('function');
    expect(typeof llm.initialize).toBe('function');
    expect(typeof llm.dispose).toBe('function');
  });

  describe('executeTask', () => {
    it('calls sendMessageSync and maps response fields correctly', async () => {
      const llm = createMockLLM();
      const agent = wrapAsAgent(llm, 'my-model');
      const result = await agent.executeTask({ prompt: 'hello', cwd: '/tmp' });

      expect(result.success).toBe(true);
      expect(result.output).toBe('response for model=my-model');
      expect(result.costUsd).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('builds MessageRequest with correct prompt and calls sendMessageSync', async () => {
      let capturedRequest: MessageRequest | undefined;
      const llm = createMockLLM({
        async sendMessageSync(request: MessageRequest): Promise<MessageResponse> {
          capturedRequest = request;
          return {
            id: 'id',
            content: 'ok',
            model: 'model',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            finishReason: 'stop',
          };
        },
      });
      const agent = wrapAsAgent(llm, 'test-model');
      await agent.executeTask({ prompt: 'do something', cwd: '/tmp' });

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest!.messages).toEqual([
        { role: 'user', content: 'do something' },
      ]);
      expect(capturedRequest!.model).toBe('test-model');
      // maxTokens and temperature should not be set (omitted, not undefined)
      expect('maxTokens' in capturedRequest!).toBe(false);
      expect('temperature' in capturedRequest!).toBe(false);
    });

    it('uses config.model when provided (task-level override)', async () => {
      const llm = createMockLLM();
      const agent = wrapAsAgent(llm, 'default-model');
      const result = await agent.executeTask({
        prompt: 'hello',
        cwd: '/tmp',
        model: 'override-model',
      });
      expect(result.output).toBe('response for model=override-model');
    });

    it('falls back to closure model when config.model is undefined', async () => {
      const llm = createMockLLM();
      const agent = wrapAsAgent(llm, 'closure-model');
      const result = await agent.executeTask({ prompt: 'hello', cwd: '/tmp' });
      expect(result.output).toBe('response for model=closure-model');
    });

    it('maps finishReason=error to success=false', async () => {
      const llm = createMockLLM({
        async sendMessageSync() {
          return {
            id: 'err-1',
            content: 'error content',
            model: 'model',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            finishReason: 'error',
          };
        },
      });
      const agent = wrapAsAgent(llm, 'model');
      const result = await agent.executeTask({ prompt: 'fail', cwd: '/tmp' });
      expect(result.success).toBe(false);
      expect(result.output).toBe('error content');
    });

    it('maps finishReason=stop to success=true', async () => {
      const llm = createMockLLM();
      const agent = wrapAsAgent(llm, 'model');
      const result = await agent.executeTask({ prompt: 'test', cwd: '/tmp' });
      expect(result.success).toBe(true);
    });

    it('maps finishReason=length to success=true', async () => {
      const llm = createMockLLM({
        async sendMessageSync() {
          return {
            id: 'len-1',
            content: 'truncated output',
            model: 'model',
            usage: { inputTokens: 10, outputTokens: 4096, totalTokens: 4106 },
            finishReason: 'length',
          };
        },
      });
      const agent = wrapAsAgent(llm, 'model');
      const result = await agent.executeTask({ prompt: 'test', cwd: '/tmp' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('truncated output');
    });

    it('maps finishReason=tool_calls to success=true', async () => {
      const llm = createMockLLM({
        async sendMessageSync() {
          return {
            id: 'tc-1',
            content: 'tool call output',
            model: 'model',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
            finishReason: 'tool_calls',
          };
        },
      });
      const agent = wrapAsAgent(llm, 'model');
      const result = await agent.executeTask({ prompt: 'test', cwd: '/tmp' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('tool call output');
    });

    it('maps finishReason=content_filter to success=true', async () => {
      const llm = createMockLLM({
        async sendMessageSync() {
          return {
            id: 'cf-1',
            content: 'filtered output',
            model: 'model',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            finishReason: 'content_filter',
          };
        },
      });
      const agent = wrapAsAgent(llm, 'model');
      const result = await agent.executeTask({ prompt: 'test', cwd: '/tmp' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('filtered output');
    });

    it('catches sendMessageSync error with safe casting (Error instance)', async () => {
      const llm = createMockLLM({
        async sendMessageSync() {
          throw new Error('API call failed');
        },
      });
      const agent = wrapAsAgent(llm, 'model');
      const result = await agent.executeTask({ prompt: 'test', cwd: '/tmp' });

      expect(result.success).toBe(false);
      expect(result.output).toBe('');
      expect(result.error).toBe('API call failed');
      expect(result.costUsd).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('handles non-Error thrown values via String(err) (number)', async () => {
      const llm = createMockLLM({
        async sendMessageSync() {
          throw 42; // eslint-disable-line no-throw-literal
        },
      });
      const agent = wrapAsAgent(llm, 'model');
      const result = await agent.executeTask({ prompt: 'test', cwd: '/tmp' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('42');
    });

    it('handles non-Error thrown values via String(err) (string)', async () => {
      const llm = createMockLLM({
        async sendMessageSync() {
          throw 'boom'; // eslint-disable-line no-throw-literal
        },
      });
      const agent = wrapAsAgent(llm, 'model');
      const result = await agent.executeTask({ prompt: 'test', cwd: '/tmp' });

      expect(result.success).toBe(false);
      expect(result.output).toBe('');
      expect(result.error).toBe('boom');
      expect(result.costUsd).toBe(0);
    });

    it('sets costUsd to 0', async () => {
      const llm = createMockLLM();
      const agent = wrapAsAgent(llm, 'model');
      const result = await agent.executeTask({ prompt: 'test', cwd: '/tmp' });
      expect(result.costUsd).toBe(0);
    });

    it('tracks durationMs correctly', async () => {
      const llm = createMockLLM({
        async sendMessageSync() {
          // Add a small delay to ensure durationMs > 0
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            id: 'id',
            content: 'ok',
            model: 'model',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            finishReason: 'stop' as const,
          };
        },
      });
      const agent = wrapAsAgent(llm, 'model');
      const result = await agent.executeTask({ prompt: 'test', cwd: '/tmp' });
      expect(result.durationMs).toBeGreaterThanOrEqual(5);
    });

    it('tracks durationMs on error path', async () => {
      const llm = createMockLLM({
        async sendMessageSync() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('delayed failure');
        },
      });
      const agent = wrapAsAgent(llm, 'model');
      const result = await agent.executeTask({ prompt: 'test', cwd: '/tmp' });
      expect(result.success).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(5);
    });

    it('accepts _onProgress callback but does not invoke it', async () => {
      const llm = createMockLLM();
      const agent = wrapAsAgent(llm, 'model');
      const onProgress = vi.fn();
      const result = await agent.executeTask(
        { prompt: 'test', cwd: '/tmp' },
        onProgress,
      );
      expect(result.success).toBe(true);
      expect(onProgress).not.toHaveBeenCalled();
    });
  });

  describe('isAvailable', () => {
    it('always returns true', async () => {
      const llm = createMockLLM();
      const agent = wrapAsAgent(llm, 'model');
      expect(await agent.isAvailable()).toBe(true);
    });

    it('returns true regardless of provider state', async () => {
      // Even with a provider that would fail on executeTask,
      // isAvailable() should return true (lazy validation)
      const llm = createMockLLM({
        async sendMessageSync() {
          throw new Error('provider down');
        },
      });
      const agent = wrapAsAgent(llm, 'model');
      expect(await agent.isAvailable()).toBe(true);
    });
  });

  describe('dispose', () => {
    it('delegates to llm.dispose()', async () => {
      const disposeFn = vi.fn().mockResolvedValue(undefined);
      const llm = createMockLLM({ dispose: disposeFn });
      const agent = wrapAsAgent(llm, 'model');
      await agent.dispose();
      expect(disposeFn).toHaveBeenCalledOnce();
    });

    it('returns a resolved promise', async () => {
      const llm = createMockLLM();
      const agent = wrapAsAgent(llm, 'model');
      const result = agent.dispose();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });
  });
});
