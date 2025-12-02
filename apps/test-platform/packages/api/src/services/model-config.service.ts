/**
 * Model Configuration Service
 * Manages LLM models and user-specific configurations
 */

import { eq, and, desc, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { llmModels, userModelConfigs, modelUsage, systemConfig } from '../db/schema'
import type {
  SelectLLMModel,
  SelectUserModelConfig,
  InsertModelUsage,
  SelectSystemConfig,
} from '../db/schema'

export class ModelConfigService {
  private db: DrizzleD1Database<typeof import('../db/schema')>

  constructor(db: DrizzleD1Database<typeof import('../db/schema')>) {
    this.db = db
  }

  /**
   * Get all available LLM models
   */
  async getAllModels(filters?: {
    provider?: string
    status?: 'active' | 'beta' | 'deprecated'
    supportsVision?: boolean
    supportsFunctions?: boolean
  }): Promise<SelectLLMModel[]> {
    let query = this.db.select().from(llmModels)

    // Apply filters if provided
    if (filters?.provider) {
      query = query.where(eq(llmModels.provider, filters.provider)) as any
    }
    if (filters?.status) {
      query = query.where(eq(llmModels.status, filters.status)) as any
    }

    const models = await query

    // Apply boolean filters manually (SQLite limitation)
    let filtered = models
    if (filters?.supportsVision !== undefined) {
      filtered = filtered.filter((m) => m.supportsVision === filters.supportsVision)
    }
    if (filters?.supportsFunctions !== undefined) {
      filtered = filtered.filter((m) => m.supportsFunctions === filters.supportsFunctions)
    }

    return filtered
  }

  /**
   * Get a specific model by ID
   */
  async getModelById(modelId: string): Promise<SelectLLMModel | undefined> {
    const [model] = await this.db.select().from(llmModels).where(eq(llmModels.id, modelId)).limit(1)
    return model
  }

  /**
   * Get models configured for a specific user
   */
  async getUserModelConfigs(userId: string): Promise<
    Array<{
      config: SelectUserModelConfig
      model: SelectLLMModel
    }>
  > {
    const configs = await this.db
      .select({
        config: userModelConfigs,
        model: llmModels,
      })
      .from(userModelConfigs)
      .innerJoin(llmModels, eq(userModelConfigs.modelId, llmModels.id))
      .where(eq(userModelConfigs.userId, userId))

    return configs
  }

  /**
   * Get a specific user model configuration
   */
  async getUserModelConfig(
    userId: string,
    configId: string
  ): Promise<SelectUserModelConfig | undefined> {
    const [config] = await this.db
      .select()
      .from(userModelConfigs)
      .where(and(eq(userModelConfigs.userId, userId), eq(userModelConfigs.id, configId)))
      .limit(1)

    return config
  }

  /**
   * Create a new model configuration for a user
   */
  async createUserModelConfig(
    userId: string,
    data: {
      modelId: string
      apiKey: string
      nickname?: string
      customTemperature?: number
      customMaxTokens?: number
      customSystemPrompt?: string
      monthlyBudgetUsd?: number
      dailyRequestLimit?: number
    }
  ): Promise<SelectUserModelConfig> {
    // Verify model exists
    const model = await this.getModelById(data.modelId)
    if (!model) {
      throw new Error(`Model not found: ${data.modelId}`)
    }

    // TODO: Encrypt API key in production
    const apiKeyLastFour = data.apiKey.slice(-4)

    const id = nanoid()
    await this.db.insert(userModelConfigs).values({
      id,
      userId,
      modelId: data.modelId,
      apiKey: data.apiKey, // TODO: encrypt
      apiKeyLastFour,
      nickname: data.nickname,
      customTemperature: data.customTemperature,
      customMaxTokens: data.customMaxTokens,
      customSystemPrompt: data.customSystemPrompt,
      monthlyBudgetUsd: data.monthlyBudgetUsd,
      dailyRequestLimit: data.dailyRequestLimit,
      enabled: true,
    })

    const [config] = await this.db.select().from(userModelConfigs).where(eq(userModelConfigs.id, id)).limit(1)
    return config!
  }

  /**
   * Update a user model configuration
   */
  async updateUserModelConfig(
    userId: string,
    configId: string,
    updates: {
      nickname?: string
      customTemperature?: number
      customMaxTokens?: number
      customSystemPrompt?: string
      monthlyBudgetUsd?: number
      dailyRequestLimit?: number
      enabled?: boolean
    }
  ): Promise<SelectUserModelConfig | undefined> {
    // Verify ownership
    const existing = await this.getUserModelConfig(userId, configId)
    if (!existing) {
      throw new Error('Configuration not found or access denied')
    }

    await this.db
      .update(userModelConfigs)
      .set({
        ...updates,
        lastUsedAt: new Date(),
      })
      .where(eq(userModelConfigs.id, configId))

    const [updated] = await this.db.select().from(userModelConfigs).where(eq(userModelConfigs.id, configId)).limit(1)
    return updated
  }

  /**
   * Delete a user model configuration
   */
  async deleteUserModelConfig(userId: string, configId: string): Promise<boolean> {
    // Verify ownership
    const existing = await this.getUserModelConfig(userId, configId)
    if (!existing) {
      throw new Error('Configuration not found or access denied')
    }

    await this.db.delete(userModelConfigs).where(eq(userModelConfigs.id, configId))
    return true
  }

  /**
   * Record model usage
   */
  async recordModelUsage(data: {
    userId: string
    userModelConfigId?: string
    modelId: string
    requestType: 'benchmark' | 'chat' | 'completion'
    inputTokens: number
    outputTokens: number
    latencyMs?: number
    success: boolean
    errorMessage?: string
    metadata?: Record<string, any>
  }): Promise<InsertModelUsage> {
    // Get model pricing
    const model = await this.getModelById(data.modelId)
    if (!model) {
      throw new Error(`Model not found: ${data.modelId}`)
    }

    // Calculate costs in micro-dollars
    const inputCostUsd = Math.round((data.inputTokens / 1_000_000) * model.inputPricePer1M)
    const outputCostUsd = Math.round((data.outputTokens / 1_000_000) * model.outputPricePer1M)
    const totalCostUsd = inputCostUsd + outputCostUsd

    const usageRecord: InsertModelUsage = {
      id: nanoid(),
      userId: data.userId,
      userModelConfigId: data.userModelConfigId,
      modelId: data.modelId,
      requestType: data.requestType,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.inputTokens + data.outputTokens,
      inputCostUsd,
      outputCostUsd,
      totalCostUsd,
      latencyMs: data.latencyMs,
      success: data.success,
      errorMessage: data.errorMessage,
      metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
    }

    await this.db.insert(modelUsage).values(usageRecord)
    return usageRecord
  }

  /**
   * Get usage statistics for a user
   */
  async getUserUsageStats(
    userId: string,
    options?: {
      modelId?: string
      startDate?: Date
      endDate?: Date
      limit?: number
    }
  ): Promise<{
    totalRequests: number
    successfulRequests: number
    totalTokens: number
    totalCostUsd: number
    averageLatencyMs: number
    byModel: Array<{
      modelId: string
      modelName: string
      requests: number
      tokens: number
      costUsd: number
    }>
  }> {
    let query = this.db.select().from(modelUsage).where(eq(modelUsage.userId, userId))

    if (options?.modelId) {
      query = query.where(eq(modelUsage.modelId, options.modelId)) as any
    }

    if (options?.startDate) {
      query = query.where(sql`${modelUsage.timestamp} >= ${options.startDate}`) as any
    }

    if (options?.endDate) {
      query = query.where(sql`${modelUsage.timestamp} <= ${options.endDate}`) as any
    }

    if (options?.limit) {
      query = query.limit(options.limit) as any
    }

    const usage = await query

    const totalRequests = usage.length
    const successfulRequests = usage.filter((u) => u.success).length
    const totalTokens = usage.reduce((sum, u) => sum + u.totalTokens, 0)
    const totalCostUsd = usage.reduce((sum, u) => sum + u.totalCostUsd, 0)
    const averageLatencyMs =
      usage.filter((u) => u.latencyMs).reduce((sum, u) => sum + (u.latencyMs || 0), 0) /
      usage.filter((u) => u.latencyMs).length

    // Group by model
    const byModelMap = new Map<
      string,
      {
        modelId: string
        modelName: string
        requests: number
        tokens: number
        costUsd: number
      }
    >()

    for (const record of usage) {
      const existing = byModelMap.get(record.modelId)
      if (existing) {
        existing.requests++
        existing.tokens += record.totalTokens
        existing.costUsd += record.totalCostUsd
      } else {
        const model = await this.getModelById(record.modelId)
        byModelMap.set(record.modelId, {
          modelId: record.modelId,
          modelName: model?.displayName || record.modelId,
          requests: 1,
          tokens: record.totalTokens,
          costUsd: record.totalCostUsd,
        })
      }
    }

    return {
      totalRequests,
      successfulRequests,
      totalTokens,
      totalCostUsd,
      averageLatencyMs: isNaN(averageLatencyMs) ? 0 : averageLatencyMs,
      byModel: Array.from(byModelMap.values()),
    }
  }

  /**
   * Get system configuration
   */
  async getSystemConfig(): Promise<SelectSystemConfig | undefined> {
    const [config] = await this.db.select().from(systemConfig).where(eq(systemConfig.id, 'default')).limit(1)
    return config
  }

  /**
   * Get system user's model configurations
   */
  async getSystemModelConfigs(): Promise<
    Array<{
      config: SelectUserModelConfig
      model: SelectLLMModel
    }>
  > {
    const config = await this.getSystemConfig()
    if (!config?.systemUserId) {
      throw new Error('System user not configured')
    }

    return this.getUserModelConfigs(config.systemUserId)
  }

  /**
   * Check if user has exceeded budget limits
   */
  async checkUserBudgetLimits(userId: string, configId: string): Promise<{
    withinBudget: boolean
    withinDailyLimit: boolean
    currentMonthCostUsd: number
    todayRequestCount: number
    monthlyBudgetUsd?: number
    dailyRequestLimit?: number
  }> {
    const config = await this.getUserModelConfig(userId, configId)
    if (!config) {
      throw new Error('Configuration not found')
    }

    // Calculate current month usage
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const monthUsage = await this.db
      .select()
      .from(modelUsage)
      .where(and(eq(modelUsage.userModelConfigId, configId), sql`${modelUsage.timestamp} >= ${startOfMonth}`))

    const currentMonthCostUsd = monthUsage.reduce((sum, u) => sum + u.totalCostUsd, 0)

    // Calculate today's usage
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    const todayUsage = await this.db
      .select()
      .from(modelUsage)
      .where(and(eq(modelUsage.userModelConfigId, configId), sql`${modelUsage.timestamp} >= ${startOfDay}`))

    const todayRequestCount = todayUsage.length

    const withinBudget = config.monthlyBudgetUsd ? currentMonthCostUsd <= config.monthlyBudgetUsd : true
    const withinDailyLimit = config.dailyRequestLimit ? todayRequestCount < config.dailyRequestLimit : true

    return {
      withinBudget,
      withinDailyLimit,
      currentMonthCostUsd,
      todayRequestCount,
      monthlyBudgetUsd: config.monthlyBudgetUsd || undefined,
      dailyRequestLimit: config.dailyRequestLimit || undefined,
    }
  }
}

/**
 * Calculate cost for a request
 */
export function calculateCost(
  model: SelectLLMModel,
  inputTokens: number,
  outputTokens: number
): {
  inputCostUsd: number
  outputCostUsd: number
  totalCostUsd: number
} {
  const inputCostUsd = Math.round((inputTokens / 1_000_000) * model.inputPricePer1M)
  const outputCostUsd = Math.round((outputTokens / 1_000_000) * model.outputPricePer1M)
  const totalCostUsd = inputCostUsd + outputCostUsd

  return { inputCostUsd, outputCostUsd, totalCostUsd }
}

/**
 * Format micro-dollars to USD string
 */
export function formatCost(microDollars: number): string {
  const dollars = microDollars / 1_000_000
  return `$${dollars.toFixed(6)}`
}