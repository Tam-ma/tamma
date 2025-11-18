/**
 * Role Evaluation Configurations
 * Reusable role-based evaluation criteria for different task types
 */

import type { RoleEvaluation, AgentRole, Difficulty } from '../../types/test-bank.types'

/**
 * Developer role evaluations for Code Generation tasks
 */
export const DEVELOPER_CODE_GEN_EASY: RoleEvaluation = {
  role: 'developer',
  difficulty: 'easy',
  scoringWeights: {
    correctness: 35,
    codeQuality: 30,
    requirements: 20,
    documentation: 15,
  },
  expectedCapabilities: [
    'Implement basic functions',
    'Handle simple edge cases',
    'Write basic documentation (JSDoc)',
    'Follow coding standards',
    'Use proper TypeScript types',
  ],
}

export const DEVELOPER_CODE_GEN_MEDIUM: RoleEvaluation = {
  role: 'developer',
  difficulty: 'medium',
  scoringWeights: {
    correctness: 30,
    codeQuality: 30,
    requirements: 25,
    documentation: 15,
  },
  expectedCapabilities: [
    'Implement complex algorithms',
    'Apply design patterns appropriately',
    'Handle comprehensive edge cases',
    'Write maintainable code with SOLID principles',
    'Use generics and advanced types',
    'Provide usage examples in documentation',
  ],
}

export const DEVELOPER_CODE_GEN_HARD: RoleEvaluation = {
  role: 'developer',
  difficulty: 'hard',
  scoringWeights: {
    correctness: 25,
    codeQuality: 30,
    requirements: 25,
    documentation: 20,
  },
  expectedCapabilities: [
    'Design extensible systems',
    'Optimize performance with benchmarks',
    'Handle concurrent scenarios',
    'Build reusable frameworks',
    'Write production-ready code',
    'Document architecture decisions (ADRs)',
  ],
}

/**
 * Architect role evaluations for same Code Generation tasks
 * (Architect doing Code Generation is harder than Developer)
 */
export const ARCHITECT_CODE_GEN_EASY: RoleEvaluation = {
  role: 'architect',
  difficulty: 'easy', // Same basic tasks, but judged on architecture
  scoringWeights: {
    architecture: 30,
    correctness: 25,
    maintainability: 25,
    scalability: 10,
    documentation: 10,
  },
  expectedCapabilities: [
    'Write code that follows architectural principles',
    'Consider future extensibility',
    'Avoid tight coupling',
    'Think about reusability',
  ],
}

export const ARCHITECT_CODE_GEN_MEDIUM: RoleEvaluation = {
  role: 'architect',
  difficulty: 'medium',
  scoringWeights: {
    architecture: 35,
    maintainability: 30,
    scalability: 20,
    documentation: 15,
  },
  expectedCapabilities: [
    'Design class hierarchies properly',
    'Apply architectural patterns (Strategy, Observer, etc.)',
    'Ensure loose coupling and high cohesion',
    'Consider scalability from the start',
    'Document design decisions',
  ],
}

export const ARCHITECT_CODE_GEN_HARD: RoleEvaluation = {
  role: 'architect',
  difficulty: 'hard',
  scoringWeights: {
    architecture: 40,
    maintainability: 25,
    scalability: 20,
    documentation: 15,
  },
  expectedCapabilities: [
    'Design distributed systems components',
    'Define clear system boundaries',
    'Make informed technology choices',
    'Balance trade-offs (performance vs maintainability)',
    'Create architecture documentation with diagrams',
  ],
}

/**
 * Tester role evaluations for Code Generation tasks
 * (Tester can implement, but focus is on testability)
 */
export const TESTER_CODE_GEN_EASY: RoleEvaluation = {
  role: 'tester',
  difficulty: 'easy',
  scoringWeights: {
    correctness: 30,
    edgeCases: 30,
    coverage: 25,
    codeQuality: 15,
  },
  expectedCapabilities: [
    'Write testable code',
    'Identify and handle edge cases',
    'Think about boundary conditions',
    'Write code that\'s easy to test',
  ],
}

export const TESTER_CODE_GEN_MEDIUM: RoleEvaluation = {
  role: 'tester',
  difficulty: 'medium',
  scoringWeights: {
    edgeCases: 35,
    coverage: 30,
    correctness: 25,
    codeQuality: 10,
  },
  expectedCapabilities: [
    'Comprehensive edge case handling',
    'Write code with high testability',
    'Consider all error paths',
    'Design for easy mocking/stubbing',
  ],
}

export const TESTER_CODE_GEN_HARD: RoleEvaluation = {
  role: 'tester',
  difficulty: 'hard',
  scoringWeights: {
    edgeCases: 35,
    coverage: 35,
    correctness: 20,
    codeQuality: 10,
  },
  expectedCapabilities: [
    'Handle complex edge cases (race conditions, etc.)',
    'Design test-friendly architecture',
    'Consider performance testing needs',
    'Account for integration testing scenarios',
  ],
}

/**
 * UX Designer role evaluations for Code Generation tasks
 * (UX Designer implementing code - judged mainly on clarity/documentation)
 */
export const UX_DESIGNER_CODE_GEN_EASY: RoleEvaluation = {
  role: 'ux-designer',
  difficulty: 'medium', // Code gen is harder for UX role
  scoringWeights: {
    clarity: 40,
    correctness: 30,
    documentation: 20,
    examples: 10,
  },
  expectedCapabilities: [
    'Write self-documenting code',
    'Use clear, meaningful names',
    'Provide excellent documentation',
    'Include usage examples',
  ],
}

export const UX_DESIGNER_CODE_GEN_MEDIUM: RoleEvaluation = {
  role: 'ux-designer',
  difficulty: 'hard', // Code gen is much harder for UX role
  scoringWeights: {
    clarity: 40,
    documentation: 30,
    examples: 20,
    correctness: 10,
  },
  expectedCapabilities: [
    'Create highly readable code',
    'Write comprehensive documentation',
    'Provide multiple usage examples',
    'Explain the "why" behind decisions',
  ],
}

/**
 * Get role evaluations for a code generation task based on difficulty
 */
export function getCodeGenRoleEvaluations(baseDifficulty: Difficulty): RoleEvaluation[] {
  switch (baseDifficulty) {
    case 'easy':
      return [
        DEVELOPER_CODE_GEN_EASY,
        ARCHITECT_CODE_GEN_EASY,
        TESTER_CODE_GEN_EASY,
        UX_DESIGNER_CODE_GEN_EASY,
      ]
    case 'medium':
      return [
        DEVELOPER_CODE_GEN_MEDIUM,
        ARCHITECT_CODE_GEN_MEDIUM,
        TESTER_CODE_GEN_MEDIUM,
        UX_DESIGNER_CODE_GEN_MEDIUM,
      ]
    case 'hard':
      return [
        DEVELOPER_CODE_GEN_HARD,
        ARCHITECT_CODE_GEN_HARD,
        TESTER_CODE_GEN_HARD,
        // Note: UX Designer hard tasks would be extremely difficult for code gen
        // Omitted unless specifically testing UX role on hard code gen
      ]
  }
}
