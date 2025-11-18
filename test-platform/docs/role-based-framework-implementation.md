# Role-Based Framework Implementation Summary

**Date**: November 17, 2024
**Status**: ✅ Framework Designed, 🔄 Implementation In Progress

---

## Overview

The test platform now supports **role-based evaluation** where the same task can be evaluated differently based on the agent's role (Developer, Architect, Tester, UX Designer, etc.).

### Key Concept

**Difficulty is relative to role**: A "Code Generation" task that is **Easy** for a Developer might be **Medium** for an Architect (who must also consider architecture) or **Hard** for a UX Designer (code gen is outside their primary expertise).

---

## Architecture Changes

### 1. Type Definitions (`src/types/test-bank.types.ts`)

**New Types Added:**

```typescript
// Agent roles that map to the 7 benchmark scenarios
export type AgentRole =
  | 'developer'           // Primary: Code Generation, Refactoring
  | 'architect'           // Primary: Code Review, System Design
  | 'tester'              // Primary: Test Generation, Debugging
  | 'ux-designer'         // Primary: Documentation
  | 'security-engineer'   // Primary: Security Scanning
  | 'devops-engineer'     // Primary: Deployment, CI/CD
  | 'data-engineer'       // Primary: Data Pipelines
  // ... plus junior/senior variants

// Scoring weights (sum to 100)
export interface ScoringWeights {
  // Developer weights
  correctness?: number
  codeQuality?: number
  requirements?: number
  documentation?: number

  // Architect weights
  architecture?: number
  maintainability?: number
  scalability?: number

  // Tester weights
  coverage?: number
  edgeCases?: number

  // UX Designer weights
  clarity?: number
  completeness?: number
  examples?: number
  accessibility?: number
}

// Role-specific evaluation criteria
export interface RoleEvaluation {
  role: AgentRole
  difficulty: Difficulty
  scoringWeights: ScoringWeights
  expectedCapabilities: string[]
}
```

**Updated TestBankTask:**

```typescript
export interface TestBankTask {
  // ... existing fields ...

  // NEW: Role-based evaluation
  primaryRole: AgentRole              // Primary role this task is for
  roleEvaluations?: RoleEvaluation[]  // How different roles are evaluated
}
```

### 2. Database Schema (`src/db/schema.ts`)

**New Fields in `testBank` table:**

```typescript
primaryRole: text('primary_role').notNull().default('developer'),
roleEvaluations: text('role_evaluations'), // JSON array
```

### 3. Role Evaluation Configurations (`src/db/seeds/role-evaluations.ts`)

**Reusable evaluation configurations** for different role + difficulty combinations:

```typescript
// Developer evaluations
DEVELOPER_CODE_GEN_EASY
DEVELOPER_CODE_GEN_MEDIUM
DEVELOPER_CODE_GEN_HARD

// Architect evaluations
ARCHITECT_CODE_GEN_EASY    // Same tasks, but judged on architecture
ARCHITECT_CODE_GEN_MEDIUM
ARCHITECT_CODE_GEN_HARD

// Tester evaluations
TESTER_CODE_GEN_EASY       // Same tasks, judged on testability
TESTER_CODE_GEN_MEDIUM
TESTER_CODE_GEN_HARD

// UX Designer evaluations
UX_DESIGNER_CODE_GEN_EASY  // Difficulty = Medium (code gen is harder for UX)
UX_DESIGNER_CODE_GEN_MEDIUM // Difficulty = Hard

// Helper function
getCodeGenRoleEvaluations(difficulty) // Returns array of all role evaluations
```

---

## Implementation Example

### Task Structure (Before)

```typescript
{
  title: "Email Validation Function",
  difficulty: "easy",
  // ... other fields
}
```

### Task Structure (After)

```typescript
{
  title: "Email Validation Function",
  difficulty: "easy",              // Base difficulty (for general agent)
  primaryRole: "developer",         // This is primarily a developer task
  roleEvaluations: [
    {
      role: "developer",
      difficulty: "easy",
      scoringWeights: {
        correctness: 35,
        codeQuality: 30,
        requirements: 20,
        documentation: 15
      },
      expectedCapabilities: [
        "Implement basic functions",
        "Handle simple edge cases",
        "Write basic documentation"
      ]
    },
    {
      role: "architect",
      difficulty: "easy",
      scoringWeights: {
        architecture: 30,
        correctness: 25,
        maintainability: 25,
        scalability: 10,
        documentation: 10
      },
      expectedCapabilities: [
        "Follow architectural principles",
        "Consider future extensibility",
        "Avoid tight coupling"
      ]
    },
    {
      role: "tester",
      difficulty: "easy",
      scoringWeights: {
        correctness: 30,
        edgeCases: 30,
        coverage: 25,
        codeQuality: 15
      },
      expectedCapabilities: [
        "Write testable code",
        "Identify edge cases",
        "Think about boundary conditions"
      ]
    },
    {
      role: "ux-designer",
      difficulty: "medium",  // Code gen is harder for UX
      scoringWeights: {
        clarity: 40,
        correctness: 30,
        documentation: 20,
        examples: 10
      },
      expectedCapabilities: [
        "Write self-documenting code",
        "Use clear names",
        "Provide excellent documentation"
      ]
    }
  ]
}
```

---

## Evaluation Flow

### 1. Task Assignment
```
User specifies: "Test Agent X on TypeScript Code Generation tasks"
System identifies: Agent X role = "developer"
```

### 2. Task Retrieval
```
Query: Get tasks where primaryRole = "developer" OR "developer" in roleEvaluations
Returns: All 50 Easy Code Gen tasks
```

### 3. Task Execution
```
Agent X implements: validateEmail function
System collects: Generated code
```

### 4. Role-Based Scoring
```
Find role evaluation: roleEvaluations.find(r => r.role === "developer")
Apply weights:
  - Correctness (35%): 95/100 → 33.25 points
  - Code Quality (30%): 90/100 → 27 points
  - Requirements (20%): 100/100 → 20 points
  - Documentation (15%): 80/100 → 12 points
Total Score: 92.25/100
```

---

## Scoring Weight Breakdown by Role

### Developer (Code Generation)
| Difficulty | Correctness | Code Quality | Requirements | Documentation |
|------------|-------------|--------------|--------------|---------------|
| **Easy**   | 35%         | 30%          | 20%          | 15%           |
| **Medium** | 30%         | 30%          | 25%          | 15%           |
| **Hard**   | 25%         | 30%          | 25%          | 20%           |

### Architect (Code Generation)
| Difficulty | Architecture | Correctness | Maintainability | Scalability | Documentation |
|------------|--------------|-------------|-----------------|-------------|---------------|
| **Easy**   | 30%          | 25%         | 25%             | 10%         | 10%           |
| **Medium** | 35%          | -           | 30%             | 20%         | 15%           |
| **Hard**   | 40%          | -           | 25%             | 20%         | 15%           |

### Tester (Code Generation)
| Difficulty | Edge Cases | Coverage | Correctness | Code Quality |
|------------|------------|----------|-------------|--------------|
| **Easy**   | 30%        | 25%      | 30%         | 15%          |
| **Medium** | 35%        | 30%      | 25%         | 10%          |
| **Hard**   | 35%        | 35%      | 20%         | 10%          |

### UX Designer (Code Generation)
| Difficulty | Clarity | Correctness | Documentation | Examples |
|------------|---------|-------------|---------------|----------|
| **Easy**   | 40%     | 30%         | 20%           | 10%      |
| **Medium** | 40%     | 10%         | 30%           | 20%      |

*(Note: UX Designer difficulty is elevated - Easy tasks become Medium, Medium becomes Hard)*

---

## Expected Capabilities by Role

### Developer - Easy Tasks
- ✅ Implement basic functions
- ✅ Handle simple edge cases
- ✅ Write basic documentation (JSDoc)
- ✅ Follow coding standards
- ✅ Use proper TypeScript types

### Developer - Medium Tasks
- ✅ Implement complex algorithms
- ✅ Apply design patterns appropriately
- ✅ Handle comprehensive edge cases
- ✅ Write maintainable code with SOLID principles
- ✅ Use generics and advanced types
- ✅ Provide usage examples

### Developer - Hard Tasks
- ✅ Design extensible systems
- ✅ Optimize performance with benchmarks
- ✅ Handle concurrent scenarios
- ✅ Build reusable frameworks
- ✅ Write production-ready code
- ✅ Document architecture decisions (ADRs)

### Architect - Easy Tasks (same code as Developer Easy, different expectations)
- ✅ Write code following architectural principles
- ✅ Consider future extensibility
- ✅ Avoid tight coupling
- ✅ Think about reusability

### Tester - Easy Tasks (same code, testing focus)
- ✅ Write testable code
- ✅ Identify and handle edge cases
- ✅ Think about boundary conditions
- ✅ Design code that's easy to test

### UX Designer - Easy Tasks (elevated to Medium difficulty)
- ✅ Write self-documenting code
- ✅ Use clear, meaningful names
- ✅ Provide excellent documentation
- ✅ Include usage examples

---

## Current Status

### ✅ Completed
1. **Type Definitions** - Added AgentRole, ScoringWeights, RoleEvaluation types
2. **Database Schema** - Added primaryRole and roleEvaluations fields
3. **Role Configurations** - Created reusable role evaluation configs
4. **Seeder Updates** - Updated seeder to handle new fields
5. **First Task** - Added role metadata to Task #1 (Email Validation)

### 🔄 In Progress
1. **Add Role Metadata to Tasks 2-50** - Need to add `primaryRole` and `roleEvaluations` to remaining 49 tasks

### 📋 Pending
1. **Database Migration** - Generate Drizzle migration for schema changes
2. **50 Medium Tasks** - Create Medium difficulty tasks for Developer role
3. **50 Hard Tasks** - Create Hard difficulty tasks for Developer role
4. **Role-Specific Variants** - Create task variants optimized for Architect, Tester, UX Designer roles

---

## Next Steps

### Immediate (Today)
1. **Batch update remaining 49 tasks** with role metadata:
   ```typescript
   primaryRole: 'developer',
   roleEvaluations: getCodeGenRoleEvaluations('easy'),
   ```

2. **Generate database migration**:
   ```bash
   npm run db:generate
   ```

3. **Test the seeder** with updated tasks:
   ```bash
   npm run db:seed
   ```

### Short Term (This Week)
1. Create 50 Medium difficulty Code Generation tasks
2. Create 50 Hard difficulty Code Generation tasks
3. Complete Developer role test bank (150 tasks total)

### Medium Term (Next 2 Weeks)
1. Create Architect-focused tasks (Code Review, Refactoring scenarios)
2. Create Tester-focused tasks (Test Generation, Debugging scenarios)
3. Create UX Designer-focused tasks (Documentation scenario)

### Long Term (Next Month)
1. Expand to other 6 languages (Python, C#, Java, Go, Ruby, Rust)
2. Complete full test bank: **7,350 tasks total**
   - 7 languages × 7 scenarios × 150 tasks per scenario
   - Each task evaluated across 4 primary roles
   - Total evaluation combinations: 29,400

---

## Impact on Benchmark Results

### Before (Single Difficulty)
```
Model A: 85/100 on "Email Validation" (Easy task)
```

### After (Role-Based Evaluation)
```
Model A as Developer:   92/100 (excels at implementation)
Model A as Architect:   78/100 (weaker on architecture considerations)
Model A as Tester:      88/100 (good edge case handling)
Model A as UX Designer: 65/100 (documentation needs improvement)
```

This provides **4x more nuanced evaluation** - we can see that Model A is a strong general developer but needs improvement in architectural thinking and documentation quality.

---

## File Structure

```
packages/api/src/
├── types/
│   └── test-bank.types.ts          # ✅ Updated with role types
├── db/
│   ├── schema.ts                   # ✅ Updated with role fields
│   └── seeds/
│       ├── role-evaluations.ts     # ✅ NEW - Role configs
│       ├── test-bank-ts-codegen-easy.ts  # 🔄 Task 1 updated, 49 pending
│       └── seed-test-bank.ts       # ✅ Updated to handle roles
└── docs/
    ├── test-bank-difficulty-criteria.md  # ✅ Role framework defined
    └── role-based-framework-implementation.md  # ✅ This document
```

---

## Questions & Decisions

### Q: Should every task have evaluations for ALL roles?
**A**: No. Tasks have a `primaryRole` and role evaluations for relevant roles only.
- Code Generation tasks: Developer (primary), Architect, Tester, (UX Designer optional)
- Code Review tasks: Architect (primary), Developer, Security Engineer
- Test Generation tasks: Tester (primary), Developer
- Documentation tasks: UX Designer (primary), Developer

### Q: How do we handle role expertise modifiers (junior vs senior)?
**A**: For Phase 1, focus on the 4 core roles. Junior/Senior modifiers can be:
1. Separate role evaluations with adjusted weights
2. Applied as multipliers to the base score
3. Phase 2 feature

### Q: Can we automatically generate role evaluations?
**A**: Partially. The `getCodeGenRoleEvaluations(difficulty)` helper generates standard evaluations, but tasks with unique characteristics may need custom role evaluations.

---

**Status**: Framework designed and partially implemented. Ready to complete remaining 49 tasks and proceed with Medium/Hard difficulty tiers.
