# Test Bank Difficulty Criteria

**Purpose**: Define clear, objective criteria for categorizing tasks as Easy, Medium, or Hard across all scenarios and languages.

**Last Updated**: November 17, 2024

---

## Core Philosophy

**Difficulty measures how hard it is to produce HIGH-QUALITY, REQUIREMENTS-COMPLIANT code**, not just "working" code.

A task's difficulty is based on:
1. **Requirement Clarity**: How ambiguous are the requirements?
2. **Requirement Adherence**: How many subtle requirements must be satisfied?
3. **Process Adherence**: How much discipline is needed (testing, error handling, documentation)?
4. **Code Quality Standards**: How high is the bar for clean, maintainable code?

**Key Principle**: An "easy" task with strict quality requirements becomes "medium". A "medium" task with ambiguous requirements becomes "hard".

---

## The Four Pillars of Difficulty

### 1. **Requirement Accuracy & Adherence**
*How precisely must the implementation match requirements?*

#### Easy
- **Requirements**: Crystal clear, unambiguous
- **Success Criteria**: Single correct interpretation
- **Hidden Requirements**: None - all requirements explicit
- **Validation**: Simple test cases cover everything
- **Example**: "Return true if number is even"
  - No ambiguity about what "even" means
  - No edge cases requiring interpretation

#### Medium
- **Requirements**: Mostly clear, 1-2 subtle requirements
- **Success Criteria**: Multiple valid approaches, must choose correctly
- **Hidden Requirements**: 1-2 implied requirements (e.g., "efficient" implies O(n) not O(n²))
- **Validation**: Requires understanding implicit expectations
- **Example**: "Parse JSON safely with validation"
  - Must handle malformed JSON (implied)
  - Must validate schema (what schema? need to ask or infer)
  - "Safely" implies no crashes (implied requirement)

#### Hard
- **Requirements**: Ambiguous, requires clarifying questions
- **Success Criteria**: Multiple constraints that conflict, must balance trade-offs
- **Hidden Requirements**: 3+ implied requirements that aren't stated
- **Validation**: Edge cases not obvious from requirements
- **Example**: "Implement rate limiter for API"
  - Per-user or global? (ambiguous)
  - What happens when limit exceeded? (not specified)
  - Distributed or single-instance? (architecture decision needed)
  - Thread-safe? (implied for production)
  - How to handle burst traffic? (design decision)

---

### 2. **Ambiguity Recognition & Clarification**
*How well must the model identify and handle unclear requirements?*

#### Easy
- **Ambiguity Level**: None - requirements are complete and unambiguous
- **Expected Behavior**: Implement exactly as specified
- **Questions Required**: 0 clarifying questions needed
- **Assumptions**: No assumptions needed
- **Example**: "Write function that adds two numbers"
  - No ambiguity about what "add" means
  - Input/output types clear
  - No edge cases requiring interpretation

#### Medium
- **Ambiguity Level**: 1-2 minor ambiguities
- **Expected Behavior**: Make reasonable assumptions OR ask clarifying questions
- **Questions Required**: 1-2 questions demonstrate good judgment
- **Assumptions**: If assumptions made, must state them explicitly
- **Example**: "Implement debounce function"
  - Should it trigger on leading edge, trailing edge, or both? (ambiguous)
  - Model should either: (a) ask, or (b) state assumption clearly
  - Default behavior not specified - good model asks or documents choice

#### Hard
- **Ambiguity Level**: 3+ significant ambiguities
- **Expected Behavior**: MUST ask clarifying questions before implementation
- **Questions Required**: 3+ questions needed to avoid wrong solution
- **Assumptions**: Making assumptions without clarification = failure
- **Example**: "Build authentication system"
  - Session-based or JWT? (major design decision)
  - What's the threat model? (affects implementation)
  - Password requirements? (security vs UX trade-off)
  - Multi-factor auth? (scope question)
  - **A model that immediately implements without questions FAILS**

---

### 3. **Process & Best Practices Adherence**
*How much engineering discipline is required?*

#### Easy
- **Error Handling**: Basic validation (null checks)
- **Testing**: Simple happy path + 2-3 edge cases
- **Documentation**: Function-level JSDoc/docstring
- **Code Quality**: Basic clean code (no magic numbers, clear names)
- **Type Safety**: Basic types (number, string, boolean)
- **Example Requirements**:
  - Handle null/undefined input
  - Add basic JSDoc
  - Use const/let instead of var
  - Pass all tests

#### Medium
- **Error Handling**: Comprehensive error handling with specific error types
- **Testing**: Happy path + edge cases + error cases (80%+ coverage)
- **Documentation**: Function docs + usage examples + edge case docs
- **Code Quality**: SOLID principles, extract functions, no duplication
- **Type Safety**: Generics, union types, proper interfaces
- **Example Requirements**:
  - Throw specific error types with helpful messages
  - Write tests for all error conditions
  - Document why certain design decisions were made
  - No code duplication
  - Type-safe with proper generics

#### Hard
- **Error Handling**: Exhaustive error handling + recovery strategies
- **Testing**: Unit + integration + edge cases + performance tests (95%+ coverage)
- **Documentation**: Complete API docs + architecture decisions + migration guides
- **Code Quality**: Design patterns, separation of concerns, extensibility
- **Type Safety**: Advanced types (conditional types, mapped types, branded types)
- **Example Requirements**:
  - Implement circuit breaker pattern for failures
  - Write integration tests with mocking
  - Document architecture trade-offs with ADRs
  - Follow specific design patterns (observer, strategy, etc.)
  - Type-safe at compile time with zero `any` types
  - Performance benchmarks required

---

### 4. **Code Quality Standards**
*How high is the bar for production-ready code?*

#### Easy
- **Readability**: Clear variable names, basic comments
- **Maintainability**: Simple structure, obvious logic flow
- **Performance**: No obvious inefficiencies
- **Scoring**:
  - ✅ Works correctly (tests pass) = 60%
  - ✅ Clean code (no smells) = +20%
  - ✅ Well documented = +10%
  - ✅ Good naming = +10%
- **Example**: Email validation
  - Must work (regex correct)
  - Must handle edge cases
  - Must have clear function name
  - Must have JSDoc

#### Medium
- **Readability**: Self-documenting code, meaningful abstractions
- **Maintainability**: Easy to extend, loosely coupled, testable
- **Performance**: Optimal time complexity for problem
- **Scoring**:
  - ✅ Works correctly = 40%
  - ✅ Clean code + patterns = +20%
  - ✅ Well tested = +20%
  - ✅ Good architecture = +10%
  - ✅ Complete documentation = +10%
- **Example**: Deep clone function
  - Must handle all types correctly (including circular refs)
  - Must be type-safe with generics
  - Must have performance considerations documented
  - Must have comprehensive tests
  - Must be easily maintainable

#### Hard
- **Readability**: Publication-quality code, exemplary structure
- **Maintainability**: Follows all SOLID principles, design patterns applied correctly
- **Performance**: Optimized, benchmarked, trade-offs documented
- **Scoring**:
  - ✅ Works correctly = 30%
  - ✅ Production-ready quality = +20%
  - ✅ Comprehensive tests = +20%
  - ✅ Excellent architecture = +15%
  - ✅ Complete docs + ADRs = +15%
- **Example**: LRU Cache
  - Must be O(1) for get/put operations
  - Must be thread-safe if specified
  - Must have comprehensive tests (including concurrency)
  - Must document design decisions (why doubly-linked list + hash map?)
  - Must be production-ready with error handling
  - Must include performance benchmarks

---

## Role-Based Difficulty Modifiers

**Critical Insight**: Difficulty is RELATIVE to the agent's role and specialization.

### Agent Role Categories

#### **1. General-Purpose Coding Agent**
*Expected to handle any coding task*

- **Easy**: Basic programming tasks any developer should handle
- **Medium**: Tasks requiring specific knowledge but standard for professional developers
- **Hard**: Complex systems requiring deep expertise

**Example**: For a general agent, "implement OAuth2" is Hard. For a security specialist, it's Medium.

---

#### **2. Specialized Agent (e.g., Security Expert, Performance Engineer)**
*Deep expertise in specific domain*

- **Easy**: Basic tasks in their domain that any specialist should know
  - Security Agent: Identify SQL injection → Easy
  - Performance Agent: Find O(n²) loop → Easy
  - Frontend Agent: Center a div → Easy

- **Medium**: Nuanced tasks requiring domain expertise
  - Security Agent: Identify second-order injection → Medium
  - Performance Agent: Optimize React re-renders → Medium
  - Frontend Agent: Implement accessible modal → Medium

- **Hard**: Cutting-edge or extremely complex domain problems
  - Security Agent: Find timing-based side-channel attack → Hard
  - Performance Agent: Optimize distributed cache coherency → Hard
  - Frontend Agent: Build custom virtual scroll with a11y → Hard

**Key Principle**: What's "hard" for a general agent might be "easy" for a specialist.

---

#### **3. Junior vs Senior Agent Personas**

##### Junior Agent (Expected Capabilities)
- **Easy**:
  - Implement well-defined functions
  - Follow style guides
  - Write basic tests
  - Fix obvious bugs

- **Medium**:
  - Design simple classes/modules
  - Handle ambiguous requirements with guidance
  - Write comprehensive tests
  - Debug complex issues

- **Hard**:
  - System architecture decisions
  - Performance optimization
  - Security audits
  - Production incident response

##### Senior Agent (Expected Capabilities)
- **Easy**:
  - Everything in Junior's "Medium"
  - Design simple systems
  - Mentor-level code reviews

- **Medium**:
  - Complex system architecture
  - Performance optimization across system
  - Security architecture
  - Handle vague business requirements

- **Hard**:
  - Distributed systems design
  - Cross-cutting refactoring of large codebases
  - Build frameworks/libraries
  - Navigate conflicting stakeholder requirements

---

### Role-Based Scoring Adjustments

#### Security Review Task Example

**Task**: "Review this authentication code for vulnerabilities"

| Agent Role | Difficulty | Scoring Breakdown |
|------------|-----------|-------------------|
| **General Agent** | Hard | Must find 3/5 critical issues (60%), suggest fixes (20%), explain impact (20%) |
| **Security Specialist** | Medium | Must find 5/5 critical issues (40%), suggest fixes (20%), explain attack vectors (20%), provide remediation plan (20%) |
| **Senior Security** | Easy | Must find all issues including subtle ones (30%), full remediation (30%), threat modeling (20%), security architecture recommendations (20%) |

**Same task, different expectations based on role.**

---

#### Code Generation Task Example

**Task**: "Implement rate limiter with Redis"

| Agent Role | Difficulty | What's Expected |
|------------|-----------|-----------------|
| **Junior Agent** | Hard | Basic sliding window implementation, handles happy path, basic error handling |
| **General Agent** | Medium | Correct algorithm, edge cases, error handling, basic tests |
| **Backend Specialist** | Medium | Production-ready, comprehensive error handling, extensive tests, performance considerations |
| **Senior Backend** | Easy | Production-ready, distributed considerations, fallback strategies, monitoring, benchmarks |
| **Performance Engineer** | Easy (implementation) → Hard (optimization) | Implementation is trivial, but must optimize for specific throughput/latency targets |

---

### Scenario-Specific Role Expectations

#### Code Review Scenario

| Reviewer Role | Easy Expectations | Hard Expectations |
|---------------|------------------|-------------------|
| **Junior** | Find syntax errors, basic bugs | Find architectural issues |
| **General** | Find bugs, basic security issues | Find subtle race conditions |
| **Security Specialist** | Find OWASP Top 10 | Find zero-day vulnerabilities |
| **Architect** | Identify poor patterns | Redesign entire architecture |

---

#### Debugging Scenario

| Debugger Role | Easy Task | Hard Task |
|---------------|-----------|-----------|
| **Junior** | Fix typo, off-by-one | Debug async race condition |
| **General** | Fix logic bugs | Debug memory leak |
| **Performance Engineer** | Identify slow query | Optimize distributed system latency |
| **Senior Full-Stack** | Fix any bug | Debug production incident across multiple services |

---

#### Refactoring Scenario

| Refactor Role | Easy Task | Hard Task |
|---------------|-----------|-----------|
| **Junior** | Rename variables, extract constants | Apply design pattern |
| **General** | Extract functions, apply SOLID | Migrate to new architecture |
| **Architect** | Apply design pattern | Re-architect entire system |
| **Legacy Modernization Specialist** | Modernize syntax | Migrate monolith to microservices |

---

### Domain-Specific Difficulty

#### Frontend Tasks

**Task**: "Build accessible dropdown menu"

| Agent Type | Difficulty | Requirements |
|------------|-----------|--------------|
| **General Agent** | Hard | Must work, basic keyboard nav (60%), ARIA labels (20%), style (20%) |
| **Frontend Agent** | Medium | Full keyboard nav (30%), complete ARIA (30%), focus management (20%), style (20%) |
| **Accessibility Specialist** | Easy | Perfect a11y (40%), screen reader tested (30%), meets WCAG AAA (30%) |

#### Backend Tasks

**Task**: "Implement database transaction with rollback"

| Agent Type | Difficulty | Requirements |
|------------|-----------|--------------|
| **General Agent** | Medium | Basic transaction (60%), rollback on error (40%) |
| **Backend Agent** | Easy | Transaction (30%), rollback (20%), deadlock handling (20%), isolation level correct (30%) |
| **Database Specialist** | Easy | All of above is baseline (50%), + performance optimization (25%), + monitoring (25%) |

---

### Evaluation Rubric by Role

#### General Agent Scoring
```
Correctness:        40%  // Does it work?
Requirements:       25%  // All requirements met?
Code Quality:       20%  // Clean, maintainable?
Documentation:      15%  // Adequately documented?
```

#### Specialist Agent Scoring (Domain-Specific)
```
Domain Expertise:   35%  // Shows deep domain knowledge?
Correctness:        25%  // Works correctly in domain?
Best Practices:     25%  // Follows domain best practices?
Edge Cases:         15%  // Handles domain-specific edge cases?
```

#### Senior Agent Scoring
```
Architecture:       30%  // Sound design decisions?
Production Ready:   25%  // Ready for production deployment?
Maintainability:    20%  // Easy for team to maintain?
Documentation:      15%  // Complete docs including ADRs?
Knowledge Sharing:  10%  // Educates others via code/comments?
```

---

### Task Tagging by Role Suitability

Each task should be tagged with recommended agent roles:

```typescript
interface TestBankTask {
  // ... existing fields

  // NEW: Role-specific metadata
  recommendedRoles: AgentRole[]
  difficultyByRole: Map<AgentRole, Difficulty>
  scoringWeightsByRole: Map<AgentRole, ScoringWeights>
}

// Example
{
  title: "Review authentication code for security issues",
  recommendedRoles: ['security-specialist', 'general-agent', 'senior-full-stack'],
  difficultyByRole: {
    'general-agent': 'hard',
    'security-specialist': 'medium',
    'senior-full-stack': 'medium',
  },
  scoringWeightsByRole: {
    'general-agent': {
      correctness: 60,
      requirements: 40
    },
    'security-specialist': {
      domainExpertise: 40,
      comprehensiveness: 30,
      remediationQuality: 30
    }
  }
}
```

---

### Role Definition Framework

```typescript
/**
 * Primary Software Development Roles
 * These map to the 7 benchmark scenarios
 */
type AgentRole =
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

interface RoleProfile {
  role: AgentRole
  primaryScenarios: Scenario[]    // Scenarios where this role excels
  secondaryScenarios: Scenario[]  // Scenarios where role has basic competency
  expertise: string[]
  expectedCapabilities: {
    easy: string[]
    medium: string[]
    hard: string[]
  }
  scoringWeights: ScoringWeights
}

// Example: Developer Role Profile
const DEVELOPER_PROFILE: RoleProfile = {
  role: 'developer',
  primaryScenarios: ['code-generation', 'refactoring'],
  secondaryScenarios: ['debugging', 'test-generation'],
  expertise: [
    'Writing clean code',
    'Implementing algorithms',
    'Following best practices',
    'Code organization'
  ],
  expectedCapabilities: {
    easy: [
      'Implement basic functions',
      'Handle simple edge cases',
      'Write basic documentation',
      'Follow coding standards'
    ],
    medium: [
      'Implement complex algorithms',
      'Apply design patterns',
      'Handle comprehensive edge cases',
      'Write maintainable code'
    ],
    hard: [
      'Design extensible systems',
      'Optimize performance',
      'Handle concurrent scenarios',
      'Build reusable frameworks'
    ]
  },
  scoringWeights: {
    correctness: 35,
    codeQuality: 30,
    requirements: 20,
    documentation: 15
  }
}

// Example: Architect Role Profile
const ARCHITECT_PROFILE: RoleProfile = {
  role: 'architect',
  primaryScenarios: ['code-review', 'refactoring'],
  secondaryScenarios: ['code-generation', 'documentation'],
  expertise: [
    'System design',
    'Design patterns',
    'SOLID principles',
    'Scalability & maintainability'
  ],
  expectedCapabilities: {
    easy: [
      'Identify code smells',
      'Suggest basic patterns',
      'Review for best practices'
    ],
    medium: [
      'Design class hierarchies',
      'Apply architectural patterns',
      'Review for scalability'
    ],
    hard: [
      'Design distributed systems',
      'Define system boundaries',
      'Make technology choices',
      'Balance trade-offs'
    ]
  },
  scoringWeights: {
    architecture: 40,
    maintainability: 25,
    scalability: 20,
    documentation: 15
  }
}

// Example: Tester Role Profile
const TESTER_PROFILE: RoleProfile = {
  role: 'tester',
  primaryScenarios: ['test-generation', 'debugging'],
  secondaryScenarios: ['code-review', 'security'],
  expertise: [
    'Test design',
    'Edge case identification',
    'Bug reproduction',
    'Test automation'
  ],
  expectedCapabilities: {
    easy: [
      'Write basic unit tests',
      'Identify obvious bugs',
      'Test happy paths'
    ],
    medium: [
      'Write comprehensive test suites',
      'Test edge cases',
      'Debug complex issues',
      'Achieve 80%+ coverage'
    ],
    hard: [
      'Design test strategies',
      'Test distributed systems',
      'Debug race conditions',
      'Performance testing'
    ]
  },
  scoringWeights: {
    coverage: 35,
    edgeCases: 30,
    correctness: 25,
    maintainability: 10
  }
}

// Example: UX Designer Role Profile
const UX_DESIGNER_PROFILE: RoleProfile = {
  role: 'ux-designer',
  primaryScenarios: ['documentation'],
  secondaryScenarios: ['code-review'],
  expertise: [
    'User-facing documentation',
    'API documentation',
    'Accessibility',
    'User experience'
  ],
  expectedCapabilities: {
    easy: [
      'Write clear function docs',
      'Create basic examples',
      'Document parameters'
    ],
    medium: [
      'Write comprehensive API docs',
      'Create tutorials',
      'Document user flows'
    ],
    hard: [
      'Write architecture guides',
      'Create complete manuals',
      'Design documentation systems'
    ]
  },
  scoringWeights: {
    clarity: 40,
    completeness: 30,
    examples: 20,
    accessibility: 10
  }
}
```

---

### Practical Application

When creating a task:

1. **Define the task** (e.g., "Implement OAuth2 flow")

2. **Identify target roles**:
   - General agent
   - Security specialist
   - Backend specialist

3. **Set difficulty per role**:
   - General: Hard (unfamiliar with OAuth2 spec)
   - Security: Medium (knows OAuth2, must implement securely)
   - Backend: Medium (knows implementation, must handle edge cases)

4. **Define role-specific requirements**:
   - General: Must follow spec (60%), handle errors (40%)
   - Security: Follow spec (30%), prevent common attacks (40%), secure storage (30%)
   - Backend: Follow spec (20%), production-ready (30%), scalable (30%), monitored (20%)

5. **Create role-specific evaluation**:
   - Test against role-appropriate standards
   - General agent passing ≠ Security specialist passing
   - Security specialist must find ALL vulnerabilities

---

## Updated Difficulty Assessment Formula

```
Task Difficulty = Base Complexity × Role Expertise Factor × Quality Bar

Where:
- Base Complexity: Inherent task complexity (1-10)
- Role Expertise Factor:
  * 2.0 for tasks outside role expertise
  * 1.0 for tasks within role
  * 0.5 for tasks in role's specialty
- Quality Bar: Strictness of requirements (1-3)

Example:
"Implement OAuth2":
  - Base Complexity: 7
  - General Agent: 7 × 2.0 × 1.5 = 21 (Hard)
  - Security Specialist: 7 × 1.0 × 2.0 = 14 (Medium)
  - Auth Specialist: 7 × 0.5 × 2.5 = 8.75 (Easy-Medium)
```

---

## Difficulty Dimensions

### 1. **Cognitive Complexity**
How many concepts/patterns must be understood simultaneously?

| Difficulty | Concepts Required |
|------------|------------------|
| **Easy** | 1-2 basic concepts (loops, conditionals, string methods) |
| **Medium** | 3-4 concepts, may combine basic patterns |
| **Hard** | 5+ concepts, complex algorithmic thinking, multiple design patterns |

### 2. **Algorithmic Complexity**
What's the expected time/space complexity?

| Difficulty | Complexity Class |
|------------|-----------------|
| **Easy** | O(n) or better, straightforward iteration |
| **Medium** | O(n log n), nested loops, basic recursion |
| **Hard** | O(n²) or worse acceptable, complex recursion, dynamic programming, graph algorithms |

### 3. **Lines of Code (LoC)**
Approximate solution length (excluding comments/tests)?

| Difficulty | Expected LoC |
|------------|-------------|
| **Easy** | 5-15 lines |
| **Medium** | 15-40 lines |
| **Hard** | 40-100+ lines |

### 4. **Edge Cases**
How many edge cases must be handled?

| Difficulty | Edge Cases |
|------------|-----------|
| **Easy** | 2-3 obvious edge cases (empty input, null, zero) |
| **Medium** | 4-6 edge cases, some non-obvious |
| **Hard** | 7+ edge cases, complex boundary conditions |

### 5. **Implementation Time**
Expected time for competent developer?

| Difficulty | Time Estimate |
|------------|--------------|
| **Easy** | 5-10 minutes |
| **Medium** | 15-30 minutes |
| **Hard** | 30-60 minutes |

### 6. **Language Features**
What language features are required?

| Difficulty | Features |
|------------|----------|
| **Easy** | Basic syntax, standard library methods |
| **Medium** | Intermediate features (closures, generics, functional methods) |
| **Hard** | Advanced features (async/await, decorators, metaprogramming) |

---

## Difficulty Criteria by Scenario

### **1. Code Generation**

#### Easy
- **Description**: Implement simple utility functions with straightforward logic
- **Examples**: String manipulation, basic math, simple array operations
- **Concepts**: Loops, conditionals, built-in methods
- **Algorithmic Patterns**: Linear search, basic iteration, simple transformations
- **Edge Cases**: Empty input, null/undefined, single element
- **Example Tasks**:
  - Email validation (regex)
  - Capitalize string
  - Sum array
  - Is even number
  - Reverse string

#### Medium
- **Description**: Implement moderately complex algorithms or data transformations
- **Examples**: Sorting, searching, data structure manipulation, basic algorithms
- **Concepts**: Recursion, hash maps, multiple data structures, functional programming
- **Algorithmic Patterns**: Binary search, merge/quicksort, recursion, two-pointer technique
- **Edge Cases**: Nested structures, duplicates, large inputs, multiple conditions
- **Example Tasks**:
  - Debounce function
  - Deep clone object
  - Binary search
  - Find duplicates in array
  - Parse JSON safely with validation

#### Hard
- **Description**: Implement complex algorithms, design patterns, or system components
- **Examples**: Graph algorithms, dynamic programming, complex state management
- **Concepts**: Dynamic programming, graph traversal, design patterns, async patterns
- **Algorithmic Patterns**: DFS/BFS, memoization, backtracking, complex recursion
- **Edge Cases**: Concurrent access, race conditions, memory limits, optimization requirements
- **Example Tasks**:
  - LRU Cache implementation
  - Async retry with exponential backoff
  - Rate limiter
  - Dependency injection container
  - Event emitter with wildcards

---

### **2. Test Generation**

#### Easy
- **Description**: Write basic unit tests for simple functions
- **Examples**: Test pure functions with clear inputs/outputs
- **Test Coverage**: 80%+ branch coverage achievable with 5-8 tests
- **Assertions**: Simple equality checks, boolean assertions
- **Setup Required**: Minimal or none
- **Example Tasks**:
  - Test a validation function
  - Test a math utility
  - Test a string formatter

#### Medium
- **Description**: Write tests for functions with side effects or multiple code paths
- **Examples**: Functions with I/O, state changes, error handling
- **Test Coverage**: 90%+ coverage requires 10-15 tests
- **Assertions**: Mock functions, spy on calls, assert throws
- **Setup Required**: Mocking, fixtures, beforeEach/afterEach
- **Example Tasks**:
  - Test async function with error handling
  - Test class with internal state
  - Test function with external dependencies

#### Hard
- **Description**: Write comprehensive test suites for complex components
- **Examples**: Integration tests, async workflows, complex state machines
- **Test Coverage**: 95%+ coverage requires 20+ tests
- **Assertions**: Complex mocking, integration testing, timing-dependent tests
- **Setup Required**: Test databases, API mocking, complex fixtures
- **Example Tasks**:
  - Test React component with hooks
  - Test authentication flow
  - Test concurrent operations
  - Test event-driven system

---

### **3. Code Review**

#### Easy
- **Description**: Identify obvious bugs and basic style issues
- **Issues to Find**: 2-3 clear bugs (syntax errors, logic errors, basic security issues)
- **Concepts**: Basic code smells, simple anti-patterns
- **Expected Feedback**: Point out bugs, suggest simple fixes
- **Example Issues**:
  - SQL injection vulnerability (string concatenation)
  - Missing null checks
  - Unused variables
  - Off-by-one errors

#### Medium
- **Description**: Identify architectural issues, performance problems, subtle bugs
- **Issues to Find**: 4-6 issues spanning multiple categories
- **Concepts**: Design patterns, SOLID principles, performance optimization
- **Expected Feedback**: Suggest refactoring, explain trade-offs, recommend patterns
- **Example Issues**:
  - Memory leaks
  - N+1 query problems
  - Missing error boundaries
  - Inefficient algorithms
  - Tight coupling

#### Hard
- **Description**: Comprehensive review covering security, scalability, maintainability
- **Issues to Find**: 7-10+ issues across all dimensions
- **Concepts**: Distributed systems, concurrency, security best practices
- **Expected Feedback**: Architecture recommendations, security analysis, scalability concerns
- **Example Issues**:
  - Race conditions
  - Distributed transaction issues
  - Complex security vulnerabilities (CSRF, XSS variants)
  - Scalability bottlenecks
  - Design pattern misuse

---

### **4. Refactoring**

#### Easy
- **Description**: Modernize syntax, extract simple functions
- **Changes Required**: Convert to modern syntax, extract 1-2 functions, rename variables
- **Concepts**: Modern language features, basic extraction
- **Code Smell**: Long method, magic numbers, poor naming
- **Example Tasks**:
  - Convert var to const/let
  - Extract magic numbers to constants
  - Use array methods instead of loops
  - Rename poorly named variables

#### Medium
- **Description**: Restructure code, apply design patterns, improve architecture
- **Changes Required**: Extract classes, apply patterns, reorganize modules
- **Concepts**: Design patterns, SOLID principles, separation of concerns
- **Code Smell**: God class, feature envy, shotgun surgery
- **Example Tasks**:
  - Convert callbacks to promises/async-await
  - Apply strategy pattern
  - Extract service layer
  - Implement dependency injection

#### Hard
- **Description**: Major architectural refactoring, legacy system modernization
- **Changes Required**: Redesign architecture, migrate frameworks, introduce new patterns
- **Concepts**: Architectural patterns, migration strategies, backward compatibility
- **Code Smell**: Big ball of mud, spaghetti code, circular dependencies
- **Example Tasks**:
  - Migrate class components to hooks
  - Convert monolith to microservices
  - Introduce CQRS pattern
  - Refactor to event-sourcing

---

### **5. Debugging**

#### Easy
- **Description**: Fix simple bugs with clear symptoms
- **Bug Type**: Syntax error, simple logic error, off-by-one
- **Debugging Tools**: Console logs, basic debugging
- **Root Cause**: Single line or simple condition
- **Example Bugs**:
  - Off-by-one in loop (i <= length should be i < length)
  - Wrong comparison operator (= instead of ===)
  - Missing return statement
  - Typo in variable name

#### Medium
- **Description**: Fix bugs requiring debugging and understanding control flow
- **Bug Type**: State management bugs, async issues, scope problems
- **Debugging Tools**: Debugger, stack traces, async debugging
- **Root Cause**: Multiple interacting factors, timing issues
- **Example Bugs**:
  - Closure capturing wrong variable
  - Race condition in async code
  - State mutation causing unexpected behavior
  - Event listener not being cleaned up

#### Hard
- **Description**: Fix complex bugs in distributed systems or concurrent code
- **Bug Type**: Race conditions, memory leaks, distributed system bugs
- **Debugging Tools**: Profiler, memory analyzer, distributed tracing
- **Root Cause**: System-level interactions, concurrency, performance
- **Example Bugs**:
  - Deadlock in concurrent code
  - Memory leak from circular references
  - Database transaction isolation issue
  - Distributed system consistency bug

---

### **6. Security**

#### Easy
- **Description**: Identify common OWASP Top 10 vulnerabilities
- **Vulnerabilities**: 1-2 critical issues (SQL injection, XSS)
- **Attack Vectors**: Single, obvious attack vector
- **Impact**: Direct, easily exploitable
- **Example Issues**:
  - SQL injection (string concatenation)
  - Direct file upload without validation
  - Hardcoded credentials
  - Missing authentication check

#### Medium
- **Description**: Identify subtle security issues and chained vulnerabilities
- **Vulnerabilities**: 3-5 issues requiring exploitation knowledge
- **Attack Vectors**: Multiple vectors, some require specific conditions
- **Impact**: Requires specific attack chain
- **Example Issues**:
  - CSRF vulnerability
  - Insecure direct object reference
  - JWT token issues (no expiration, weak signing)
  - Path traversal vulnerability
  - Missing rate limiting

#### Hard
- **Description**: Comprehensive security audit, identify advanced attack scenarios
- **Vulnerabilities**: 6-10+ issues spanning entire security model
- **Attack Vectors**: Complex, multi-stage attacks
- **Impact**: Sophisticated exploitation required
- **Example Issues**:
  - Type confusion vulnerabilities
  - Timing attacks
  - Second-order injection
  - Privilege escalation chains
  - Cryptographic implementation flaws

---

### **7. Documentation**

#### Easy
- **Description**: Document simple functions with clear behavior
- **Requirements**: JSDoc/docstring for 1-2 simple functions
- **Completeness**: Document parameters, return value, basic description
- **Examples**: Simple code example sufficient
- **Example Tasks**:
  - Document utility function
  - Write README for simple module
  - Add inline comments explaining logic

#### Medium
- **Description**: Document complex APIs or modules
- **Requirements**: Complete API documentation with multiple functions/classes
- **Completeness**: Parameters, returns, throws, edge cases, examples
- **Examples**: Multiple examples showing different use cases
- **Example Tasks**:
  - Document REST API endpoints
  - Write architecture documentation
  - Document class with multiple methods
  - Create usage guide with examples

#### Hard
- **Description**: Create comprehensive technical documentation or architecture guides
- **Requirements**: Full system documentation, architecture diagrams, integration guides
- **Completeness**: Complete guide from setup to advanced usage
- **Examples**: Production-ready examples, tutorials, troubleshooting
- **Example Tasks**:
  - Write complete SDK documentation
  - Create architecture decision records (ADRs)
  - Document distributed system
  - Write migration guide from v1 to v2

---

## Validation Checklist

Before assigning difficulty, verify:

- [ ] **Concepts Required**: Count unique concepts needed
- [ ] **Time Estimate**: How long for skilled dev?
- [ ] **Edge Cases**: Count necessary edge cases
- [ ] **LoC**: Estimate solution length
- [ ] **Algorithmic Complexity**: What's the Big O?
- [ ] **Language Features**: Basic, intermediate, or advanced?

**Rule of Thumb**: If 3+ dimensions are at "Medium" level, task is Medium. If 3+ are "Hard", task is Hard.

---

## Cross-Language Consistency

When creating the same task across multiple languages:

1. **Core difficulty stays the same**: "Binary search" is Medium in all languages
2. **Language-specific adjustments**:
   - Easy in Python might be Medium in C (manual memory management)
   - Easy in TypeScript might be Medium in Rust (borrow checker)
3. **Document language-specific challenges** in task metadata

---

## Examples by Difficulty

### Easy Examples (All Scenarios)
| Scenario | Example |
|----------|---------|
| Code Generation | Email validation, string reverse, array sum |
| Test Generation | Test pure function with 5 test cases |
| Code Review | Find SQL injection, missing null check |
| Refactoring | Convert var to const/let, extract magic numbers |
| Debugging | Fix off-by-one error, typo in variable |
| Security | Identify SQL injection, hardcoded password |
| Documentation | Document simple utility function |

### Medium Examples (All Scenarios)
| Scenario | Example |
|----------|---------|
| Code Generation | Debounce function, deep clone, binary search |
| Test Generation | Test async function with mocking |
| Code Review | Identify memory leak, N+1 query |
| Refactoring | Apply strategy pattern, extract service layer |
| Debugging | Fix race condition, closure scope bug |
| Security | Find CSRF, insecure JWT implementation |
| Documentation | Document REST API with examples |

### Hard Examples (All Scenarios)
| Scenario | Example |
|----------|---------|
| Code Generation | LRU cache, async retry backoff, rate limiter |
| Test Generation | Integration tests for distributed system |
| Code Review | Identify distributed transaction bugs |
| Refactoring | Migrate monolith to microservices |
| Debugging | Fix deadlock, memory leak in production |
| Security | Multi-stage attack chain, timing attacks |
| Documentation | Complete system architecture guide |

---

## Task Creation Guidelines

1. **Start with Easy**: Build fundamentals before complexity
2. **Progressive Difficulty**: Each task should slightly challenge the previous level
3. **Clear Jump Between Levels**: Medium should feel noticeably harder than Easy
4. **Real-World Relevance**: Hard tasks should reflect production scenarios
5. **Testable**: All tasks must have objective pass/fail criteria

---

## Review Process

Before adding a task to the test bank:

1. **Self-Review**: Apply validation checklist
2. **Peer Review**: Have another engineer validate difficulty
3. **Test Run**: Implement the task yourself - did it match expected difficulty?
4. **Adjust**: If implementation was easier/harder, recategorize

---

**Status**: ✅ Finalized - Ready to guide task creation

**Next Step**: Use these criteria to create remaining 40 Easy tasks, then 50 Medium, then 50 Hard tasks for TypeScript Code Generation
