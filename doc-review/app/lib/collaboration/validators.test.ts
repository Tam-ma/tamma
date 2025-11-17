import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  validateCommentPayload,
  validateDiscussionPayload,
  validateSessionPayload,
  validateSuggestionPayload,
} from './validators';

describe('collaboration validators', () => {
  it('validates comment payloads', () => {
    const payload = validateCommentPayload({
      docPath: 'docs/prd.md',
      content: 'Looks good!',
      lineNumber: '42',
      lineContent: '## Heading',
    });

    expect(payload).toEqual({
      docPath: 'docs/prd.md',
      content: 'Looks good!',
      lineNumber: 42,
      lineContent: '## Heading',
    });
  });

  it('throws on invalid comment payload', () => {
    expect(() => validateCommentPayload({})).toThrow(ValidationError);
  });

  it('validates suggestion payloads', () => {
    const payload = validateSuggestionPayload({
      docPath: 'docs/test.md',
      description: 'Fix typo',
      originalText: 'teh',
      suggestedText: 'the',
      lineStart: '10',
      lineEnd: '10',
      sessionId: 'session-123',
    });

    expect(payload.lineStart).toBe(10);
    expect(payload.lineEnd).toBe(10);
  });

  it('validates discussion payloads', () => {
    const payload = validateDiscussionPayload({
      docPath: 'docs/prd.md',
      title: 'Clarification needed',
      message: 'What happens if the service restarts?',
      sessionId: 'session-123',
    });

    expect(payload.title).toContain('Clarification');
  });

  it('validates session payloads', () => {
    const payload = validateSessionPayload({
      title: 'Auth hardening',
      docPaths: ['docs/prd.md', 'docs/auth.md'],
      summary: 'Track rollout',
    });

    expect(payload.docPaths).toHaveLength(2);
  });
});
