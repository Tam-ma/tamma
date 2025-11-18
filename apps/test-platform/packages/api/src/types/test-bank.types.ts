/**
 * Test Bank Types
 * Defines the structure for benchmark tasks and test suites
 */

export type Language =
  | 'typescript'
  | 'python'
  | 'csharp'
  | 'java'
  | 'go'
  | 'ruby'
  | 'rust'

export type Scenario =
  | 'code-generation'
  | 'test-generation'
  | 'code-review'
  | 'refactoring'
  | 'debugging'
  | 'security'
  | 'documentation'

export type Difficulty = 'easy' | 'medium' | 'hard'

/**
 * Agent Roles for role-based evaluation
 * Maps to the 7 benchmark scenarios
 */
export type AgentRole =
  // Core Development Roles
  | 'developer'           // Code Generation, Refactoring
  | 'architect'           // Code Review (architecture focus), System Design
  | 'tester'              // Test Generation, Debugging
  | 'ux-designer'         // Documentation Generation, UI/UX tasks
  // Specialized Development Roles
  | 'security-engineer'   // Security Scanning, Secure Code Review
  | 'devops-engineer'     // Deployment, Infrastructure, CI/CD
  | 'data-engineer'       // Data pipelines, ETL, Analytics
  // Experience Levels (modifiers)
  | 'junior-developer'
  | 'senior-developer'
  | 'junior-architect'
  | 'senior-architect'
  | 'junior-tester'
  | 'senior-tester'

export interface TestCase {
  description: string
  input: any
  expected: any
}

export interface TestSuite {
  framework: string // 'vitest', 'jest', 'pytest', etc.
  setup?: string // Setup code to run before tests
  tests: TestCase[]
}

export interface ExpectedMetrics {
  testPassRate?: number // Expected pass rate (0-100)
  codeQualityMin?: number // Minimum acceptable code quality score (0-10)
  maxLines?: number // Maximum lines of code
  maxComplexity?: number // Maximum cyclomatic complexity
}

/**
 * Scoring weights for different evaluation criteria
 * Values should sum to 100 (representing percentages)
 */
export interface ScoringWeights {
  // General weights (for general-purpose agents)
  correctness?: number      // Does it work?
  codeQuality?: number      // Clean, maintainable?
  requirements?: number     // All requirements met?
  documentation?: number    // Adequately documented?

  // Role-specific weights
  // Developer role
  // (uses general weights above)

  // Architect role
  architecture?: number     // Sound design decisions?
  maintainability?: number  // Easy for team to maintain?
  scalability?: number      // Can it scale?

  // Tester role
  coverage?: number         // Test coverage percentage
  edgeCases?: number        // Edge cases handled?

  // UX Designer role
  clarity?: number          // Clear and understandable?
  completeness?: number     // All aspects covered?
  examples?: number         // Good examples provided?
  accessibility?: number    // Accessible to all users?

  // Security Engineer role
  domainExpertise?: number  // Shows security knowledge?
  bestPractices?: number    // Follows security best practices?
  comprehensiveness?: number // Complete security coverage?
  remediationQuality?: number // Quality of fixes/recommendations?
}

/**
 * Role-specific difficulty and scoring for a task
 */
export interface RoleEvaluation {
  role: AgentRole
  difficulty: Difficulty
  scoringWeights: ScoringWeights
  expectedCapabilities: string[] // What this role should demonstrate for this task
}

export interface TestBankTask {
  id: string
  language: Language
  scenario: Scenario
  difficulty: Difficulty // Base difficulty (for general-purpose agent)

  // Task content
  title: string
  description: string
  prompt: string
  starterCode?: string

  // Ground truth
  solution: string
  testSuite: TestSuite
  expectedMetrics?: ExpectedMetrics

  // Role-based evaluation
  primaryRole: AgentRole // Primary role this task is designed for
  roleEvaluations?: RoleEvaluation[] // How different roles should be evaluated on this task

  // Metadata
  createdAt: Date
  createdBy?: string
  tags?: string[]
  source?: string
}

/**
 * Helper type for creating tasks (without auto-generated fields)
 */
export type CreateTestBankTask = Omit<TestBankTask, 'id' | 'createdAt'>
