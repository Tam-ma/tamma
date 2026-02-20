/**
 * Tests for Knowledge Prompt Builder
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgePromptBuilder } from '../prompt/knowledge-prompt-builder.js';
import type { KnowledgeCheckResult, KnowledgeEntry } from '@tamma/shared';
import type { TaskContext, DevelopmentPlan } from '../types.js';

describe('KnowledgePromptBuilder', () => {
  let builder: KnowledgePromptBuilder;

  const createTestEntry = (overrides?: Partial<KnowledgeEntry>): KnowledgeEntry => ({
    id: 'test-id',
    type: 'recommendation',
    title: 'Test Entry',
    description: 'Test description',
    scope: 'global',
    keywords: ['test'],
    priority: 'medium',
    source: 'manual',
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'test',
    enabled: true,
    timesApplied: 0,
    timesHelpful: 0,
    ...overrides,
  });

  const createTestTask = (): TaskContext => ({
    taskId: 'task-123',
    type: 'implement_feature',
    description: 'Implement user authentication with OAuth 2.0',
    projectId: 'my-project',
    agentType: 'implementer',
  });

  const createTestPlan = (): DevelopmentPlan => ({
    summary: 'Add OAuth 2.0 authentication',
    approach: 'Use Passport.js with Google and GitHub providers',
    fileChanges: [
      { path: 'src/auth/oauth.ts', action: 'create', description: 'OAuth handler' },
      { path: 'src/config/passport.ts', action: 'create', description: 'Passport config' },
    ],
  });

  const createTestCheckResult = (
    overrides?: Partial<KnowledgeCheckResult>
  ): KnowledgeCheckResult => ({
    canProceed: true,
    recommendations: [],
    warnings: [],
    blockers: [],
    learnings: [],
    ...overrides,
  });

  beforeEach(() => {
    builder = new KnowledgePromptBuilder();
  });

  describe('buildAgentPrompt', () => {
    it('should build complete prompt with task and plan', () => {
      const task = createTestTask();
      const plan = createTestPlan();
      const check = createTestCheckResult();

      const prompt = builder.buildAgentPrompt(task, plan, check);

      expect(prompt).toContain('## Task');
      expect(prompt).toContain(task.description);
      expect(prompt).toContain('## Plan');
      expect(prompt).toContain(plan.summary);
    });

    it('should include blockers section', () => {
      const task = createTestTask();
      const plan = createTestPlan();
      const check = createTestCheckResult({
        canProceed: false,
        blockers: [
          {
            knowledge: createTestEntry({
              type: 'prohibition',
              title: 'Critical Security Issue',
              description: 'Do not expose credentials',
              priority: 'critical',
            }),
            matchReason: 'Pattern matched: credentials',
            matchScore: 0.9,
          },
        ],
      });

      const prompt = builder.buildAgentPrompt(task, plan, check);

      expect(prompt).toContain('CRITICAL BLOCKERS');
      expect(prompt).toContain('DO NOT PROCEED');
      expect(prompt).toContain('Critical Security Issue');
      expect(prompt).toContain('credentials');
    });

    it('should include warnings section', () => {
      const task = createTestTask();
      const plan = createTestPlan();
      const check = createTestCheckResult({
        warnings: [
          {
            knowledge: createTestEntry({
              type: 'prohibition',
              title: 'Potential Issue',
              description: 'Be careful with this pattern',
              priority: 'high',
            }),
            matchReason: 'Keyword match',
            matchScore: 0.7,
          },
        ],
      });

      const prompt = builder.buildAgentPrompt(task, plan, check);

      expect(prompt).toContain('Warnings');
      expect(prompt).toContain('Proceed with Caution');
      expect(prompt).toContain('Potential Issue');
    });

    it('should include recommendations section', () => {
      const task = createTestTask();
      const plan = createTestPlan();
      const check = createTestCheckResult({
        recommendations: [
          {
            knowledge: createTestEntry({
              type: 'recommendation',
              title: 'Use TypeScript strict mode',
              description: 'Enable strict mode for better type safety',
              details: 'Set strict: true in tsconfig.json',
            }),
            matchReason: 'Keyword match: typescript',
            matchScore: 0.8,
            applicability: 0.85,
          },
        ],
      });

      const prompt = builder.buildAgentPrompt(task, plan, check);

      expect(prompt).toContain('Recommendations');
      expect(prompt).toContain('Use TypeScript strict mode');
      expect(prompt).toContain('85% applicable');
    });

    it('should include learnings section with examples', () => {
      const task = createTestTask();
      const plan = createTestPlan();
      const check = createTestCheckResult({
        learnings: [
          {
            knowledge: createTestEntry({
              type: 'learning',
              title: 'OAuth token handling',
              description: 'Refresh tokens before expiry',
              sourceRef: 'PR #123',
              examples: [
                {
                  scenario: 'Token about to expire',
                  goodApproach: 'Refresh 5 minutes before expiry',
                  badApproach: 'Wait until token fails',
                  outcome: 'Reduced auth failures by 90%',
                },
              ],
            }),
            matchReason: 'Semantic match: authentication',
            matchScore: 0.75,
          },
        ],
      });

      const prompt = builder.buildAgentPrompt(task, plan, check);

      expect(prompt).toContain('Relevant Learnings');
      expect(prompt).toContain('OAuth token handling');
      expect(prompt).toContain('PR #123');
      expect(prompt).toContain('Good approach');
      expect(prompt).toContain('Refresh 5 minutes before expiry');
    });

    it('should not include empty sections', () => {
      const task = createTestTask();
      const plan = createTestPlan();
      const check = createTestCheckResult(); // All empty

      const prompt = builder.buildAgentPrompt(task, plan, check);

      expect(prompt).not.toContain('Knowledge Base Context');
      expect(prompt).not.toContain('CRITICAL BLOCKERS');
      expect(prompt).not.toContain('Warnings');
      expect(prompt).not.toContain('Recommendations');
      expect(prompt).not.toContain('Learnings');
    });
  });

  describe('buildKnowledgeContext', () => {
    it('should build only knowledge context section', () => {
      const check = createTestCheckResult({
        recommendations: [
          {
            knowledge: createTestEntry({ title: 'Test Rec' }),
            matchReason: 'match',
            matchScore: 0.8,
          },
        ],
      });

      const context = builder.buildKnowledgeContext(check);

      expect(context).toContain('Knowledge Base Context');
      expect(context).toContain('Recommendations');
      expect(context).not.toContain('## Task');
    });

    it('should return empty string when no knowledge', () => {
      const check = createTestCheckResult();

      const context = builder.buildKnowledgeContext(check);

      expect(context).toBe('');
    });
  });

  describe('buildKnowledgeSummary', () => {
    it('should summarize check result', () => {
      const check = createTestCheckResult({
        canProceed: false,
        blockers: [
          { knowledge: createTestEntry(), matchReason: '', matchScore: 0 },
          { knowledge: createTestEntry(), matchReason: '', matchScore: 0 },
        ],
        warnings: [
          { knowledge: createTestEntry(), matchReason: '', matchScore: 0 },
        ],
        recommendations: [
          { knowledge: createTestEntry(), matchReason: '', matchScore: 0 },
          { knowledge: createTestEntry(), matchReason: '', matchScore: 0 },
          { knowledge: createTestEntry(), matchReason: '', matchScore: 0 },
        ],
        learnings: [
          { knowledge: createTestEntry(), matchReason: '', matchScore: 0 },
        ],
      });

      const summary = builder.buildKnowledgeSummary(check);

      expect(summary).toContain('BLOCKED');
      expect(summary).toContain('2 critical prohibition');
      expect(summary).toContain('1 warning');
      expect(summary).toContain('3 recommendation');
      expect(summary).toContain('1 relevant learning');
    });

    it('should return message when no knowledge found', () => {
      const check = createTestCheckResult();

      const summary = builder.buildKnowledgeSummary(check);

      expect(summary).toBe('No relevant knowledge found');
    });
  });

  describe('compact format', () => {
    it('should use compact format when enabled', () => {
      builder.setOptions({ compactFormat: true });

      const task = createTestTask();
      const plan = createTestPlan();
      const check = createTestCheckResult({
        recommendations: [
          {
            knowledge: createTestEntry({
              title: 'Test Recommendation',
              description: 'Short description',
            }),
            matchReason: 'keyword',
            matchScore: 0.8,
          },
        ],
        blockers: [
          {
            knowledge: createTestEntry({
              type: 'prohibition',
              title: 'Test Blocker',
              description: 'Block description',
              priority: 'critical',
            }),
            matchReason: 'pattern',
            matchScore: 0.9,
          },
        ],
      });

      const prompt = builder.buildAgentPrompt(task, plan, check);

      // Compact format should be shorter
      expect(prompt).toContain('## Task');
      expect(prompt).not.toContain('**ID:**');
      expect(prompt).not.toContain('**Type:**');
    });
  });

  describe('options', () => {
    it('should respect includeBlockers option', () => {
      builder.setOptions({ includeBlockers: false });

      const check = createTestCheckResult({
        blockers: [
          {
            knowledge: createTestEntry({ title: 'Blocker' }),
            matchReason: 'match',
            matchScore: 1,
          },
        ],
      });

      const context = builder.buildKnowledgeContext(check);

      expect(context).not.toContain('CRITICAL BLOCKERS');
    });

    it('should respect includeWarnings option', () => {
      builder.setOptions({ includeWarnings: false });

      const check = createTestCheckResult({
        warnings: [
          {
            knowledge: createTestEntry({ title: 'Warning' }),
            matchReason: 'match',
            matchScore: 0.8,
          },
        ],
      });

      const context = builder.buildKnowledgeContext(check);

      expect(context).not.toContain('Warning');
    });

    it('should respect includeRecommendations option', () => {
      builder.setOptions({ includeRecommendations: false });

      const check = createTestCheckResult({
        recommendations: [
          {
            knowledge: createTestEntry({ title: 'Recommendation' }),
            matchReason: 'match',
            matchScore: 0.8,
          },
        ],
      });

      const context = builder.buildKnowledgeContext(check);

      expect(context).not.toContain('Recommendation');
    });

    it('should respect includeLearnings option', () => {
      builder.setOptions({ includeLearnings: false });

      const check = createTestCheckResult({
        learnings: [
          {
            knowledge: createTestEntry({ type: 'learning', title: 'Learning' }),
            matchReason: 'match',
            matchScore: 0.7,
          },
        ],
      });

      const context = builder.buildKnowledgeContext(check);

      expect(context).not.toContain('Learning');
    });

    it('should respect includeExamples option', () => {
      builder.setOptions({ includeExamples: false });

      const check = createTestCheckResult({
        learnings: [
          {
            knowledge: createTestEntry({
              type: 'learning',
              examples: [{ scenario: 'Test scenario', goodApproach: 'Good' }],
            }),
            matchReason: 'match',
            matchScore: 0.7,
          },
        ],
      });

      const context = builder.buildKnowledgeContext(check);

      expect(context).not.toContain('Example');
      expect(context).not.toContain('Good approach');
    });

    it('should limit examples per learning', () => {
      builder.setOptions({ maxExamplesPerLearning: 1 });

      const check = createTestCheckResult({
        learnings: [
          {
            knowledge: createTestEntry({
              type: 'learning',
              title: 'Learning with examples',
              examples: [
                { scenario: 'Scenario 1', goodApproach: 'Approach 1' },
                { scenario: 'Scenario 2', goodApproach: 'Approach 2' },
                { scenario: 'Scenario 3', goodApproach: 'Approach 3' },
              ],
            }),
            matchReason: 'match',
            matchScore: 0.7,
          },
        ],
      });

      const context = builder.buildKnowledgeContext(check);

      expect(context).toContain('Scenario 1');
      expect(context).not.toContain('Scenario 2');
      expect(context).not.toContain('Scenario 3');
    });

    it('should get and set options', () => {
      const initialOptions = builder.getOptions();
      expect(initialOptions.compactFormat).toBe(false);

      builder.setOptions({ compactFormat: true, maxExamplesPerLearning: 2 });

      const updatedOptions = builder.getOptions();
      expect(updatedOptions.compactFormat).toBe(true);
      expect(updatedOptions.maxExamplesPerLearning).toBe(2);
    });
  });
});
