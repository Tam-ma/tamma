/**
 * Core types for benchmark execution infrastructure
 */

import type { TestBankTask, AgentRole, Difficulty } from '../../types/test-bank.types'

/**
 * AI Model Provider Configuration
 */
export interface ModelConfig {
  provider: 'anthropic' | 'openai' | 'google' | 'mistral' | 'cohere' | 'custom'
  model: string
  apiKey?: string
  baseURL?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

/**
 * Task Execution Request
 */
export interface TaskExecutionRequest {
  task: TestBankTask
  modelConfig: ModelConfig
  role?: AgentRole
  timeout?: number // milliseconds
  attempts?: number // retry attempts
}

/**
 * Task Execution Result
 */
export interface TaskExecutionResult {
  taskId: string
  modelConfig: ModelConfig
  role: AgentRole
  difficulty: Difficulty

  // Execution details
  generatedCode: string
  executionTime: number // milliseconds
  attempts: number

  // Test results
  testResults: TestRunResult

  // Scoring
  scores: TaskScores

  // Metadata
  timestamp: Date
  error?: string
}

/**
 * Test execution results
 */
export interface TestRunResult {
  framework: 'vitest' | 'jest' | 'mocha'
  passed: number
  failed: number
  total: number
  passRate: number // 0-100
  failures: TestFailure[]
  coverage?: CoverageReport
  executionTime: number
}

export interface TestFailure {
  testName: string
  expected: any
  actual: any
  error: string
  stack?: string
}

export interface CoverageReport {
  lines: CoverageMetric
  statements: CoverageMetric
  functions: CoverageMetric
  branches: CoverageMetric
}

export interface CoverageMetric {
  total: number
  covered: number
  percentage: number
}

/**
 * Automated scoring results
 */
export interface TaskScores {
  // Overall score (weighted average based on role)
  overall: number // 0-100

  // Individual scores
  correctness: number // 0-100 (based on test pass rate)
  codeQuality: number // 0-100 (static analysis)
  requirements: number // 0-100 (all requirements met)
  documentation: number // 0-100 (JSDoc completeness)

  // Role-specific scores
  architecture?: number // 0-100 (for architect role)
  maintainability?: number // 0-100
  scalability?: number // 0-100
  coverage?: number // 0-100 (test coverage)
  edgeCases?: number // 0-100
  clarity?: number // 0-100 (code readability)

  // Detailed breakdown
  breakdown: ScoreBreakdown
}

export interface ScoreBreakdown {
  testPassRate: number
  codeComplexity: number // cyclomatic complexity
  linesOfCode: number
  maintainabilityIndex: number
  documentationScore: number
  typeScore: number // TypeScript type usage
  errorHandlingScore: number
  performanceScore?: number
}

/**
 * Benchmark Run Configuration
 */
export interface BenchmarkRunConfig {
  name: string
  description?: string

  // Task selection
  language?: string
  scenario?: string
  difficulty?: Difficulty | Difficulty[]
  taskIds?: string[]
  limit?: number

  // Model configuration
  models: ModelConfig[]

  // Execution settings
  parallel?: boolean
  maxConcurrency?: number
  timeout?: number
  retryFailures?: boolean

  // Output settings
  saveResults?: boolean
  outputPath?: string
  verbose?: boolean
}

/**
 * Benchmark Run Results
 */
export interface BenchmarkRunResult {
  runId: string
  config: BenchmarkRunConfig
  startTime: Date
  endTime: Date
  duration: number

  // Results
  tasks: TaskExecutionResult[]
  summary: BenchmarkSummary

  // Metadata
  totalTasks: number
  completedTasks: number
  failedTasks: number
}

export interface BenchmarkSummary {
  byModel: Record<string, ModelSummary>
  byDifficulty: Record<Difficulty, DifficultySummary>
  byRole: Record<AgentRole, RoleSummary>
  overall: OverallSummary
}

export interface ModelSummary {
  model: string
  tasksCompleted: number
  averageScore: number
  averageTime: number
  passRate: number
  scoresByDifficulty: Record<Difficulty, number>
}

export interface DifficultySummary {
  difficulty: Difficulty
  tasksCompleted: number
  averageScore: number
  averagePassRate: number
}

export interface RoleSummary {
  role: AgentRole
  tasksCompleted: number
  averageScore: number
  topScores: TaskExecutionResult[]
  bottomScores: TaskExecutionResult[]
}

export interface OverallSummary {
  totalTasks: number
  totalTime: number
  averageScore: number
  averagePassRate: number
  modelsRanked: Array<{ model: string; score: number }>
}

/**
 * Code quality analysis
 */
export interface CodeQualityAnalysis {
  complexity: ComplexityAnalysis
  maintainability: MaintainabilityAnalysis
  documentation: DocumentationAnalysis
  typeUsage: TypeUsageAnalysis
  errorHandling: ErrorHandlingAnalysis
  bestPractices: BestPracticesAnalysis
}

export interface ComplexityAnalysis {
  cyclomaticComplexity: number
  cognitiveComplexity: number
  linesOfCode: number
  maxNestingDepth: number
  score: number // 0-100
}

export interface MaintainabilityAnalysis {
  maintainabilityIndex: number // 0-100
  functionCount: number
  averageFunctionLength: number
  duplicateCode: number // percentage
  score: number // 0-100
}

export interface DocumentationAnalysis {
  jsdocCoverage: number // percentage
  commentDensity: number // comments per 100 lines
  hasExamples: boolean
  hasTypes: boolean
  score: number // 0-100
}

export interface TypeUsageAnalysis {
  typeAnnotationCoverage: number // percentage
  anyTypeUsage: number // count of 'any' types
  genericsUsage: number
  advancedTypesUsage: number
  score: number // 0-100
}

export interface ErrorHandlingAnalysis {
  tryCatchBlocks: number
  errorTypes: number // custom error types
  errorValidation: boolean
  score: number // 0-100
}

export interface BestPracticesAnalysis {
  namingConventions: boolean
  singleResponsibility: boolean
  dryPrinciple: boolean
  solidPrinciples: number // 0-5
  score: number // 0-100
}
