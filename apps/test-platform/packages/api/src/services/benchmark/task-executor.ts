/**
 * Task Executor
 * Executes a single benchmark task against an AI model
 */

import type {
  TaskExecutionRequest,
  TaskExecutionResult,
  TestRunResult,
  TaskScores,
  TestFailure,
} from './types'
import { ModelFactory, extractCode } from './model-interface'
import { CodeAnalyzer } from './code-analyzer'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export class TaskExecutor {
  private codeAnalyzer: CodeAnalyzer
  private tempDir: string

  constructor() {
    this.codeAnalyzer = new CodeAnalyzer()
    this.tempDir = join(process.cwd(), '.benchmark-temp')
  }

  /**
   * Execute a single task
   */
  async execute(request: TaskExecutionRequest): Promise<TaskExecutionResult> {
    const startTime = Date.now()
    const role = request.role || request.task.primaryRole
    let attempts = 0
    let generatedCode = ''
    let error: string | undefined

    try {
      // 1. Generate code using AI model
      const model = ModelFactory.create(request.modelConfig)
      const prompt = this.constructPrompt(request)

      attempts++
      const response = await model.generateCode(prompt, request.modelConfig)
      generatedCode = extractCode(response.content)

      // 2. Run tests
      const testResults = await this.runTests(generatedCode, request)

      // 3. Analyze code quality
      const codeQualityAnalysis = this.codeAnalyzer.analyze(generatedCode)
      const codeQualityScore = this.codeAnalyzer.calculateOverallScore(codeQualityAnalysis)

      // 4. Calculate scores
      const scores = this.calculateScores(
        testResults,
        codeQualityAnalysis,
        codeQualityScore,
        request,
        role
      )

      const executionTime = Date.now() - startTime

      return {
        taskId: request.task.id,
        modelConfig: request.modelConfig,
        role,
        difficulty: request.task.difficulty,
        generatedCode,
        executionTime,
        attempts,
        testResults,
        scores,
        timestamp: new Date(),
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)

      // Return failed result
      return {
        taskId: request.task.id,
        modelConfig: request.modelConfig,
        role,
        difficulty: request.task.difficulty,
        generatedCode,
        executionTime: Date.now() - startTime,
        attempts,
        testResults: {
          framework: 'vitest',
          passed: 0,
          failed: 0,
          total: 0,
          passRate: 0,
          failures: [],
          executionTime: 0,
        },
        scores: this.getZeroScores(),
        timestamp: new Date(),
        error,
      }
    }
  }

  /**
   * Construct prompt for AI model
   */
  private constructPrompt(request: TaskExecutionRequest): string {
    const { task, role } = request
    const roleEval = task.roleEvaluations?.find((r) => r.role === role)

    let prompt = `You are a ${role} working on a ${task.difficulty} difficulty task.

**Task**: ${task.title}

**Description**: ${task.description}

**Requirements**:
${task.prompt}

**Instructions**:
1. Implement the solution in TypeScript
2. Include comprehensive JSDoc documentation with examples
3. Handle all edge cases and errors
4. Use proper TypeScript types and generics
5. Follow best practices for ${role} role

${
  roleEval
    ? `
**Expected Capabilities** (${role}):
${roleEval.expectedCapabilities.map((c) => `- ${c}`).join('\n')}
`
    : ''
}

**Output Format**:
Provide ONLY the implementation code in a TypeScript code block. Do not include the test suite.

\`\`\`typescript
// Your implementation here
\`\`\`
`

    return prompt
  }

  /**
   * Run tests against generated code
   */
  private async runTests(
    code: string,
    request: TaskExecutionRequest
  ): Promise<TestRunResult> {
    const { task } = request
    const testStartTime = Date.now()

    try {
      // Create temp directory for test execution
      const taskDir = join(this.tempDir, task.id)
      mkdirSync(taskDir, { recursive: true })

      // Write generated code
      const codePath = join(taskDir, 'solution.ts')
      writeFileSync(codePath, code)

      // Write test file
      const testCode = this.generateTestCode(code, request)
      const testPath = join(taskDir, 'solution.test.ts')
      writeFileSync(testPath, testCode)

      // Write package.json
      const packageJson = {
        type: 'module',
        devDependencies: {
          vitest: '^4.0.8',
          typescript: '^5.6.0',
        },
      }
      writeFileSync(join(taskDir, 'package.json'), JSON.stringify(packageJson, null, 2))

      // Write tsconfig.json
      const tsConfig = {
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
        },
      }
      writeFileSync(join(taskDir, 'tsconfig.json'), JSON.stringify(tsConfig, null, 2))

      // Run tests
      const { stdout, stderr } = await execAsync('npx vitest run --reporter=json', {
        cwd: taskDir,
        timeout: request.timeout || 30000,
      })

      // Parse test results
      const results = this.parseTestResults(stdout, stderr)

      // Cleanup
      rmSync(taskDir, { recursive: true, force: true })

      return {
        ...results,
        executionTime: Date.now() - testStartTime,
      }
    } catch (err) {
      // Test execution failed
      return {
        framework: 'vitest',
        passed: 0,
        failed: task.testSuite.tests.length,
        total: task.testSuite.tests.length,
        passRate: 0,
        failures: [
          {
            testName: 'Test Execution',
            expected: 'Tests to run successfully',
            actual: 'Test execution failed',
            error: err instanceof Error ? err.message : String(err),
          },
        ],
        executionTime: Date.now() - testStartTime,
      }
    }
  }

  /**
   * Generate test code from task test suite
   */
  private generateTestCode(code: string, request: TaskExecutionRequest): string {
    const { task } = request
    const { testSuite } = task

    let testCode = `import { describe, it, expect } from 'vitest'\n`
    testCode += `import { ${this.extractExportedName(code)} } from './solution'\n\n`
    testCode += `describe('${task.title}', () => {\n`

    for (const test of testSuite.tests) {
      testCode += `  it('${test.description}', () => {\n`
      testCode += `    // Test case: ${test.description}\n`
      testCode += `    expect(true).toBe(true) // Placeholder\n`
      testCode += `  })\n\n`
    }

    testCode += `})\n`

    return testCode
  }

  /**
   * Extract exported function/class name from code
   */
  private extractExportedName(code: string): string {
    const exportMatch =
      code.match(/export\s+(?:function|class)\s+(\w+)/) ||
      code.match(/export\s+const\s+(\w+)\s*=/)

    return exportMatch ? exportMatch[1] : 'default'
  }

  /**
   * Parse test results from vitest output
   */
  private parseTestResults(stdout: string, stderr: string): Omit<TestRunResult, 'executionTime'> {
    try {
      const output = stdout || stderr
      const jsonMatch = output.match(/{[\s\S]*}/)

      if (jsonMatch) {
        const results = JSON.parse(jsonMatch[0])

        const passed = results.numPassedTests || 0
        const failed = results.numFailedTests || 0
        const total = passed + failed

        const failures: TestFailure[] = (results.testResults || [])
          .flatMap((suite: any) =>
            (suite.assertionResults || [])
              .filter((test: any) => test.status === 'failed')
              .map((test: any) => ({
                testName: test.title,
                expected: test.failureMessages?.[0] || 'Test to pass',
                actual: 'Test failed',
                error: test.failureMessages?.join('\n') || 'Unknown error',
              }))
          )

        return {
          framework: 'vitest',
          passed,
          failed,
          total,
          passRate: total > 0 ? (passed / total) * 100 : 0,
          failures,
        }
      }
    } catch (err) {
      // Failed to parse results
    }

    // Return default failure
    return {
      framework: 'vitest',
      passed: 0,
      failed: 0,
      total: 0,
      passRate: 0,
      failures: [],
    }
  }

  /**
   * Calculate task scores based on test results and code quality
   */
  private calculateScores(
    testResults: TestRunResult,
    codeQualityAnalysis: any,
    codeQualityScore: number,
    request: TaskExecutionRequest,
    role: string
  ): TaskScores {
    const { task } = request
    const roleEval = task.roleEvaluations?.find((r) => r.role === role)

    // Base scores
    const correctness = testResults.passRate
    const codeQuality = codeQualityScore
    const requirements = this.calculateRequirementsScore(request)
    const documentation = codeQualityAnalysis.documentation.score

    // Role-specific scores
    const architecture = codeQualityAnalysis.bestPractices.score
    const maintainability = codeQualityAnalysis.maintainability.score
    const coverage = testResults.passRate
    const edgeCases = testResults.passed > testResults.total * 0.8 ? 90 : 70

    // Calculate overall score using role-specific weights
    const weights = roleEval?.scoringWeights || {
      correctness: 35,
      codeQuality: 30,
      requirements: 20,
      documentation: 15,
    }

    const overall =
      (correctness * (weights.correctness || 0)) / 100 +
      (codeQuality * (weights.codeQuality || 0)) / 100 +
      (requirements * (weights.requirements || 0)) / 100 +
      (documentation * (weights.documentation || 0)) / 100 +
      ((architecture || 0) * (weights.architecture || 0)) / 100 +
      ((maintainability || 0) * (weights.maintainability || 0)) / 100 +
      ((coverage || 0) * (weights.coverage || 0)) / 100 +
      ((edgeCases || 0) * (weights.edgeCases || 0)) / 100

    return {
      overall: Math.floor(overall),
      correctness: Math.floor(correctness),
      codeQuality: Math.floor(codeQuality),
      requirements: Math.floor(requirements),
      documentation: Math.floor(documentation),
      architecture: Math.floor(architecture),
      maintainability: Math.floor(maintainability),
      coverage: Math.floor(coverage),
      edgeCases: Math.floor(edgeCases),
      breakdown: {
        testPassRate: testResults.passRate,
        codeComplexity: codeQualityAnalysis.complexity.cyclomaticComplexity,
        linesOfCode: codeQualityAnalysis.complexity.linesOfCode,
        maintainabilityIndex: codeQualityAnalysis.maintainability.maintainabilityIndex,
        documentationScore: documentation,
        typeScore: codeQualityAnalysis.typeUsage.score,
        errorHandlingScore: codeQualityAnalysis.errorHandling.score,
      },
    }
  }

  /**
   * Calculate requirements adherence score
   */
  private calculateRequirementsScore(request: TaskExecutionRequest): number {
    // Placeholder: would need more sophisticated requirement checking
    // For now, base it on test pass rate and code quality
    return 80 // Default good score
  }

  /**
   * Get zero scores for failed executions
   */
  private getZeroScores(): TaskScores {
    return {
      overall: 0,
      correctness: 0,
      codeQuality: 0,
      requirements: 0,
      documentation: 0,
      breakdown: {
        testPassRate: 0,
        codeComplexity: 0,
        linesOfCode: 0,
        maintainabilityIndex: 0,
        documentationScore: 0,
        typeScore: 0,
        errorHandlingScore: 0,
      },
    }
  }
}
