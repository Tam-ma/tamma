/**
 * Benchmark Runner
 * Orchestrates benchmark execution across multiple tasks and models
 */

import type {
  BenchmarkRunConfig,
  BenchmarkRunResult,
  TaskExecutionResult,
  BenchmarkSummary,
  ModelSummary,
  DifficultySummary,
  RoleSummary,
  OverallSummary,
} from './types'
import type { TestBankTask, Difficulty, AgentRole } from '../../types/test-bank.types'
import { TaskExecutor } from './task-executor'
import { db } from '../../db'
import { testBank } from '../../db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { writeFileSync } from 'fs'

export class BenchmarkRunner {
  private executor: TaskExecutor

  constructor() {
    this.executor = new TaskExecutor()
  }

  /**
   * Run a complete benchmark
   */
  async run(config: BenchmarkRunConfig): Promise<BenchmarkRunResult> {
    console.log(`🚀 Starting benchmark run: ${config.name}`)
    const startTime = new Date()
    const runId = nanoid()

    // 1. Load tasks from database
    const tasks = await this.loadTasks(config)
    console.log(`📝 Loaded ${tasks.length} tasks`)

    if (tasks.length === 0) {
      throw new Error('No tasks found matching the criteria')
    }

    // 2. Execute tasks
    const results: TaskExecutionResult[] = []
    const totalTasks = tasks.length * config.models.length

    let completed = 0
    let failed = 0

    for (const model of config.models) {
      console.log(`\n🤖 Testing model: ${model.provider}/${model.model}`)

      for (const task of tasks) {
        try {
          if (config.verbose) {
            console.log(`  ⚙️  Executing: ${task.title}`)
          }

          const result = await this.executor.execute({
            task,
            modelConfig: model,
            timeout: config.timeout,
          })

          results.push(result)
          completed++

          if (config.verbose) {
            console.log(
              `  ${result.error ? '❌' : '✅'} ${task.title} - Score: ${result.scores.overall}/100 (${result.testResults.passRate.toFixed(1)}% pass rate)`
            )
          } else {
            process.stdout.write(`\r  Progress: ${completed}/${totalTasks}`)
          }

          if (result.error) {
            failed++
          }
        } catch (error) {
          console.error(`  ❌ Failed to execute task ${task.title}:`, error)
          failed++
        }
      }
    }

    const endTime = new Date()
    const duration = endTime.getTime() - startTime.getTime()

    console.log(`\n\n✅ Benchmark complete!`)
    console.log(`📊 Total: ${completed}/${totalTasks} tasks`)
    console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`)
    console.log(`❌ Failed: ${failed}`)

    // 3. Generate summary
    const summary = this.generateSummary(results)

    const benchmarkResult: BenchmarkRunResult = {
      runId,
      config,
      startTime,
      endTime,
      duration,
      tasks: results,
      summary,
      totalTasks,
      completedTasks: completed,
      failedTasks: failed,
    }

    // 4. Save results if configured
    if (config.saveResults) {
      this.saveResults(benchmarkResult, config.outputPath)
    }

    // 5. Print summary
    this.printSummary(summary)

    return benchmarkResult
  }

  /**
   * Load tasks from database based on config
   */
  private async loadTasks(config: BenchmarkRunConfig): Promise<TestBankTask[]> {
    const conditions: any[] = []

    if (config.language) {
      conditions.push(eq(testBank.language, config.language))
    }

    if (config.scenario) {
      conditions.push(eq(testBank.scenario, config.scenario))
    }

    if (config.difficulty) {
      const difficulties = Array.isArray(config.difficulty)
        ? config.difficulty
        : [config.difficulty]
      conditions.push(inArray(testBank.difficulty, difficulties))
    }

    if (config.taskIds && config.taskIds.length > 0) {
      conditions.push(inArray(testBank.id, config.taskIds))
    }

    const query =
      conditions.length > 0
        ? db.select().from(testBank).where(and(...conditions))
        : db.select().from(testBank)

    let tasks = await query

    // Apply limit
    if (config.limit) {
      tasks = tasks.slice(0, config.limit)
    }

    // Parse JSON fields
    return tasks.map((task) => ({
      ...task,
      testSuite: JSON.parse(task.testSuite),
      expectedMetrics: task.expectedMetrics ? JSON.parse(task.expectedMetrics) : undefined,
      roleEvaluations: task.roleEvaluations ? JSON.parse(task.roleEvaluations) : undefined,
      tags: task.tags ? JSON.parse(task.tags) : undefined,
    }))
  }

  /**
   * Generate summary statistics
   */
  private generateSummary(results: TaskExecutionResult[]): BenchmarkSummary {
    const byModel = this.summarizeByModel(results)
    const byDifficulty = this.summarizeByDifficulty(results)
    const byRole = this.summarizeByRole(results)
    const overall = this.summarizeOverall(results)

    return {
      byModel,
      byDifficulty,
      byRole,
      overall,
    }
  }

  private summarizeByModel(results: TaskExecutionResult[]): Record<string, ModelSummary> {
    const summary: Record<string, ModelSummary> = {}

    for (const result of results) {
      const modelKey = `${result.modelConfig.provider}/${result.modelConfig.model}`

      if (!summary[modelKey]) {
        summary[modelKey] = {
          model: modelKey,
          tasksCompleted: 0,
          averageScore: 0,
          averageTime: 0,
          passRate: 0,
          scoresByDifficulty: {} as Record<Difficulty, number>,
        }
      }

      summary[modelKey].tasksCompleted++
      summary[modelKey].averageScore += result.scores.overall
      summary[modelKey].averageTime += result.executionTime
      summary[modelKey].passRate += result.testResults.passRate

      if (!summary[modelKey].scoresByDifficulty[result.difficulty]) {
        summary[modelKey].scoresByDifficulty[result.difficulty] = 0
      }
      summary[modelKey].scoresByDifficulty[result.difficulty] += result.scores.overall
    }

    // Calculate averages
    for (const modelKey in summary) {
      const count = summary[modelKey].tasksCompleted
      summary[modelKey].averageScore /= count
      summary[modelKey].averageTime /= count
      summary[modelKey].passRate /= count

      for (const diff in summary[modelKey].scoresByDifficulty) {
        const diffCount = results.filter(
          (r) =>
            `${r.modelConfig.provider}/${r.modelConfig.model}` === modelKey &&
            r.difficulty === diff
        ).length
        summary[modelKey].scoresByDifficulty[diff as Difficulty] /= diffCount
      }
    }

    return summary
  }

  private summarizeByDifficulty(
    results: TaskExecutionResult[]
  ): Record<Difficulty, DifficultySummary> {
    const summary: Record<string, DifficultySummary> = {}

    for (const result of results) {
      const diff = result.difficulty

      if (!summary[diff]) {
        summary[diff] = {
          difficulty: diff as Difficulty,
          tasksCompleted: 0,
          averageScore: 0,
          averagePassRate: 0,
        }
      }

      summary[diff].tasksCompleted++
      summary[diff].averageScore += result.scores.overall
      summary[diff].averagePassRate += result.testResults.passRate
    }

    // Calculate averages
    for (const diff in summary) {
      const count = summary[diff].tasksCompleted
      summary[diff].averageScore /= count
      summary[diff].averagePassRate /= count
    }

    return summary as Record<Difficulty, DifficultySummary>
  }

  private summarizeByRole(results: TaskExecutionResult[]): Record<AgentRole, RoleSummary> {
    const summary: Record<string, RoleSummary> = {}

    for (const result of results) {
      const role = result.role

      if (!summary[role]) {
        summary[role] = {
          role: role as AgentRole,
          tasksCompleted: 0,
          averageScore: 0,
          topScores: [],
          bottomScores: [],
        }
      }

      summary[role].tasksCompleted++
      summary[role].averageScore += result.scores.overall
    }

    // Calculate averages and find top/bottom scores
    for (const role in summary) {
      const count = summary[role].tasksCompleted
      summary[role].averageScore /= count

      const roleResults = results.filter((r) => r.role === role)
      roleResults.sort((a, b) => b.scores.overall - a.scores.overall)

      summary[role].topScores = roleResults.slice(0, 5)
      summary[role].bottomScores = roleResults.slice(-5).reverse()
    }

    return summary as Record<AgentRole, RoleSummary>
  }

  private summarizeOverall(results: TaskExecutionResult[]): OverallSummary {
    const totalTime = results.reduce((sum, r) => sum + r.executionTime, 0)
    const averageScore =
      results.reduce((sum, r) => sum + r.scores.overall, 0) / results.length
    const averagePassRate =
      results.reduce((sum, r) => sum + r.testResults.passRate, 0) / results.length

    // Rank models
    const modelScores: Record<string, { total: number; count: number }> = {}
    for (const result of results) {
      const modelKey = `${result.modelConfig.provider}/${result.modelConfig.model}`
      if (!modelScores[modelKey]) {
        modelScores[modelKey] = { total: 0, count: 0 }
      }
      modelScores[modelKey].total += result.scores.overall
      modelScores[modelKey].count++
    }

    const modelsRanked = Object.entries(modelScores)
      .map(([model, data]) => ({
        model,
        score: data.total / data.count,
      }))
      .sort((a, b) => b.score - a.score)

    return {
      totalTasks: results.length,
      totalTime,
      averageScore,
      averagePassRate,
      modelsRanked,
    }
  }

  /**
   * Save results to file
   */
  private saveResults(result: BenchmarkRunResult, outputPath?: string): void {
    const path = outputPath || `benchmark-${result.runId}.json`
    writeFileSync(path, JSON.stringify(result, null, 2))
    console.log(`\n💾 Results saved to: ${path}`)
  }

  /**
   * Print summary to console
   */
  private printSummary(summary: BenchmarkSummary): void {
    console.log('\n' + '='.repeat(60))
    console.log('📊 BENCHMARK SUMMARY')
    console.log('='.repeat(60))

    console.log('\n🏆 Model Rankings:')
    for (const [i, model] of summary.overall.modelsRanked.entries()) {
      console.log(`  ${i + 1}. ${model.model}: ${model.score.toFixed(2)}/100`)
    }

    console.log('\n📈 By Difficulty:')
    for (const [diff, data] of Object.entries(summary.byDifficulty)) {
      console.log(
        `  ${diff}: ${data.averageScore.toFixed(2)}/100 (${data.tasksCompleted} tasks, ${data.averagePassRate.toFixed(1)}% pass rate)`
      )
    }

    console.log('\n👥 By Role:')
    for (const [role, data] of Object.entries(summary.byRole)) {
      console.log(
        `  ${role}: ${data.averageScore.toFixed(2)}/100 (${data.tasksCompleted} tasks)`
      )
    }

    console.log('\n📊 Overall:')
    console.log(`  Average Score: ${summary.overall.averageScore.toFixed(2)}/100`)
    console.log(`  Average Pass Rate: ${summary.overall.averagePassRate.toFixed(1)}%`)
    console.log(`  Total Time: ${(summary.overall.totalTime / 1000).toFixed(2)}s`)

    console.log('\n' + '='.repeat(60))
  }
}
