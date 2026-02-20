import { describe, it, expect } from 'vitest';
import { TammaError, EngineError, WorkflowError, ConfigurationError, PlatformError } from '@tamma/shared';
import { formatErrorWithSuggestions } from './error-handler.js';

describe('formatErrorWithSuggestions', () => {
  it('should return ENGINE_ERROR suggestions for EngineError', () => {
    const error = new EngineError('agent failed');
    const result = formatErrorWithSuggestions(error);
    expect(result.message).toBe('agent failed');
    expect(result.suggestions).toContain('Check ANTHROPIC_API_KEY is set and valid');
    expect(result.suggestions).toContain('Verify Claude CLI is installed (npm i -g @anthropic-ai/claude-code)');
    expect(result.suggestions).toContain('Run with --verbose for details');
  });

  it('should return WORKFLOW_ERROR suggestions for WorkflowError', () => {
    const error = new WorkflowError('branch push failed');
    const result = formatErrorWithSuggestions(error);
    expect(result.message).toBe('branch push failed');
    expect(result.suggestions).toContain('Check repository access permissions');
    expect(result.suggestions).toContain('Verify branch permissions allow push');
  });

  it('should return CONFIGURATION_ERROR suggestions for ConfigurationError', () => {
    const error = new ConfigurationError('missing token');
    const result = formatErrorWithSuggestions(error);
    expect(result.message).toBe('missing token');
    expect(result.suggestions).toContain('Run `tamma init` to recreate config');
    expect(result.suggestions).toContain('Verify tamma.config.json is valid JSON');
  });

  it('should return PLATFORM_ERROR suggestions for PlatformError', () => {
    const error = new PlatformError('API rate limited');
    const result = formatErrorWithSuggestions(error);
    expect(result.message).toBe('API rate limited');
    expect(result.suggestions).toContain('Verify GitHub token has required permissions (repo scope)');
  });

  it('should return default suggestions for generic Error', () => {
    const error = new Error('something went wrong');
    const result = formatErrorWithSuggestions(error);
    expect(result.message).toBe('something went wrong');
    expect(result.suggestions).toContain('Run with --verbose for details');
    expect(result.suggestions).toContain('Check your internet connection');
  });

  it('should return default suggestions for non-Error values', () => {
    const result = formatErrorWithSuggestions('string error');
    expect(result.message).toBe('string error');
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('should return default suggestions for TammaError with unknown code', () => {
    const error = new TammaError('custom error', 'UNKNOWN_CODE');
    const result = formatErrorWithSuggestions(error);
    expect(result.message).toBe('custom error');
    expect(result.suggestions).toContain('Run with --verbose for details');
  });
});
