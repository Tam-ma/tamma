import { describe, it, expect } from 'vitest';
import {
  mapRepository,
  mapBranch,
  mapIssue,
  mapComment,
  mapPullRequest,
  mapCIStatus,
} from '../github/github-mappers.js';
import {
  mockRepoResponse,
  mockRefResponse,
  mockIssueResponse,
  mockCommentResponse,
  mockPullRequestResponse,
  mockCombinedStatusResponse,
  mockCheckRunsResponse,
} from './fixtures/github-responses.js';

describe('GitHub Mappers', () => {
  describe('mapRepository', () => {
    it('should map repository response', () => {
      const result = mapRepository(mockRepoResponse);
      expect(result.owner).toBe('test-owner');
      expect(result.name).toBe('test-repo');
      expect(result.fullName).toBe('test-owner/test-repo');
      expect(result.defaultBranch).toBe('main');
      expect(result.isPrivate).toBe(false);
    });
  });

  describe('mapBranch', () => {
    it('should map branch/ref response', () => {
      const result = mapBranch(mockRefResponse, 'main');
      expect(result.name).toBe('main');
      expect(result.sha).toBe('abc123');
    });
  });

  describe('mapIssue', () => {
    it('should map issue response with labels', () => {
      const result = mapIssue(mockIssueResponse);
      expect(result.number).toBe(42);
      expect(result.title).toBe('Fix authentication bug');
      expect(result.labels).toEqual(['bug', 'tamma']);
      expect(result.state).toBe('open');
    });

    it('should include comments when provided', () => {
      const comments = [mapComment(mockCommentResponse)];
      const result = mapIssue(mockIssueResponse, comments);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0]!.author).toBe('reviewer');
    });
  });

  describe('mapComment', () => {
    it('should map comment response', () => {
      const result = mapComment(mockCommentResponse);
      expect(result.id).toBe(1);
      expect(result.author).toBe('reviewer');
      expect(result.body).toContain('#10');
    });
  });

  describe('mapPullRequest', () => {
    it('should map pull request response', () => {
      const result = mapPullRequest(mockPullRequestResponse);
      expect(result.number).toBe(99);
      expect(result.state).toBe('open');
      expect(result.head).toBe('feature/42-fix-auth-bug');
      expect(result.base).toBe('main');
    });

    it('should set state to merged when merged is true', () => {
      const merged = { ...mockPullRequestResponse, merged: true, state: 'closed' };
      const result = mapPullRequest(merged);
      expect(result.state).toBe('merged');
    });
  });

  describe('mapCIStatus', () => {
    it('should map combined status and check runs', () => {
      const result = mapCIStatus(mockCombinedStatusResponse, mockCheckRunsResponse);
      expect(result.state).toBe('success');
      expect(result.totalCount).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
    });

    it('should report failure when any check fails', () => {
      const failedChecks = {
        check_runs: [
          { status: 'completed', conclusion: 'failure', name: 'test' },
        ],
      };
      const result = mapCIStatus({ statuses: [] }, failedChecks);
      expect(result.state).toBe('failure');
      expect(result.failureCount).toBe(1);
    });

    it('should report pending when checks are in progress', () => {
      const pendingChecks = {
        check_runs: [
          { status: 'in_progress', conclusion: null, name: 'build' },
        ],
      };
      const result = mapCIStatus({ statuses: [] }, pendingChecks);
      expect(result.state).toBe('pending');
      expect(result.pendingCount).toBe(1);
    });

    it('should report success when no checks exist', () => {
      const result = mapCIStatus({ statuses: [] }, { check_runs: [] });
      expect(result.state).toBe('success');
      expect(result.totalCount).toBe(0);
    });
  });
});
