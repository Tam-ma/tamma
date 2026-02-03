import { describe, it, expect } from 'vitest';
import {
  TammaError,
  EngineError,
  WorkflowError,
  ConfigurationError,
  PlatformError,
} from './errors.js';

describe('Error Classes', () => {
  describe('TammaError', () => {
    it('should set message and code', () => {
      const error = new TammaError('test error', 'TEST_CODE');
      expect(error.message).toBe('test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('TammaError');
    });

    it('should default retryable to false', () => {
      const error = new TammaError('test', 'TEST');
      expect(error.retryable).toBe(false);
    });

    it('should accept retryable option', () => {
      const error = new TammaError('test', 'TEST', { retryable: true });
      expect(error.retryable).toBe(true);
    });

    it('should accept context', () => {
      const error = new TammaError('test', 'TEST', { context: { issueNumber: 42 } });
      expect(error.context).toEqual({ issueNumber: 42 });
    });

    it('should default context to empty object', () => {
      const error = new TammaError('test', 'TEST');
      expect(error.context).toEqual({});
    });

    it('should accept a cause', () => {
      const cause = new Error('root cause');
      const error = new TammaError('test', 'TEST', { cause });
      expect(error.cause).toBe(cause);
    });

    it('should be an instance of Error', () => {
      const error = new TammaError('test', 'TEST');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('EngineError', () => {
    it('should have ENGINE_ERROR code', () => {
      const error = new EngineError('engine failed');
      expect(error.code).toBe('ENGINE_ERROR');
      expect(error.name).toBe('EngineError');
    });

    it('should be an instance of TammaError', () => {
      const error = new EngineError('test');
      expect(error).toBeInstanceOf(TammaError);
    });
  });

  describe('WorkflowError', () => {
    it('should have WORKFLOW_ERROR code', () => {
      const error = new WorkflowError('workflow failed');
      expect(error.code).toBe('WORKFLOW_ERROR');
      expect(error.name).toBe('WorkflowError');
    });

    it('should support retryable flag', () => {
      const retryable = new WorkflowError('retry me', { retryable: true });
      expect(retryable.retryable).toBe(true);

      const notRetryable = new WorkflowError('do not retry', { retryable: false });
      expect(notRetryable.retryable).toBe(false);
    });
  });

  describe('ConfigurationError', () => {
    it('should have CONFIGURATION_ERROR code and never be retryable', () => {
      const error = new ConfigurationError('bad config');
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.name).toBe('ConfigurationError');
      expect(error.retryable).toBe(false);
    });
  });

  describe('PlatformError', () => {
    it('should have PLATFORM_ERROR code', () => {
      const error = new PlatformError('github down');
      expect(error.code).toBe('PLATFORM_ERROR');
      expect(error.name).toBe('PlatformError');
    });

    it('should support retryable flag', () => {
      const error = new PlatformError('rate limited', { retryable: true });
      expect(error.retryable).toBe(true);
    });
  });
});
