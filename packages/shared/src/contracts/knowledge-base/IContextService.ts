/**
 * Context Testing Service Contract
 *
 * Defines the interface for interactive context retrieval testing.
 */

import type {
  ContextTestRequest,
  ContextTestResult,
  ContextFeedbackRequest,
} from '../../types/knowledge-base/context-types.js';

export interface IContextService {
  testContext(request: ContextTestRequest): Promise<ContextTestResult>;
  submitFeedback(feedback: ContextFeedbackRequest): Promise<void>;
  getRecentTests(limit?: number): Promise<ContextTestResult[]>;
}
