import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pino', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { default: vi.fn(() => mockLogger) };
});

import { createLogger } from './logger.js';
import pino from 'pino';

describe('createLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a logger with the given name', () => {
    createLogger('test-logger');
    expect(pino).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test-logger' }),
    );
  });

  it('should use specified log level', () => {
    createLogger('test', 'debug');
    expect(pino).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'debug' }),
    );
  });

  it('should default to info level', () => {
    createLogger('test');
    expect(pino).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info' }),
    );
  });

  it('should return an object satisfying ILogger', () => {
    const logger = createLogger('test');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should call pino methods with message only', () => {
    const logger = createLogger('test');
    const mockPino = vi.mocked(pino);
    const mockInstance = mockPino.mock.results[0]!.value as Record<string, ReturnType<typeof vi.fn>>;

    logger.info('hello');
    expect(mockInstance['info']).toHaveBeenCalledWith('hello');
  });

  it('should call pino methods with context and message', () => {
    const logger = createLogger('test');
    const mockPino = vi.mocked(pino);
    const mockInstance = mockPino.mock.results[0]!.value as Record<string, ReturnType<typeof vi.fn>>;

    logger.info('hello', { key: 'value' });
    expect(mockInstance['info']).toHaveBeenCalledWith({ key: 'value' }, 'hello');
  });
});
