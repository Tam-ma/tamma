/**
 * Model Configuration Routes
 * API endpoints for managing LLM models and user configurations
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as modelConfigService from '../services/model-config.service'
import type { Context } from '../types'

const models = new Hono<Context>()

/**
 * GET /models
 * List all available LLM models
 */
models.get(
  '/',
  zValidator(
    'query',
    z.object({
      provider: z.string().optional(),
      status: z.enum(['active', 'beta', 'deprecated']).optional(),
      supportsVision: z
        .string()
        .optional()
        .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
      supportsFunctions: z
        .string()
        .optional()
        .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
    })
  ),
  async (c) => {
    const filters = c.req.valid('query')
    const allModels = await modelConfigService.getAllModels(filters)

    return c.json({
      success: true,
      data: allModels.map((model) => ({
        ...model,
        // Parse JSON fields
        tags: model.tags ? JSON.parse(model.tags) : [],
      })),
    })
  }
)

/**
 * GET /models/:id
 * Get a specific model by ID
 */
models.get('/:id', async (c) => {
  const modelId = c.req.param('id')
  const model = await modelConfigService.getModelById(modelId)

  if (!model) {
    return c.json(
      {
        success: false,
        error: 'Model not found',
      },
      404
    )
  }

  return c.json({
    success: true,
    data: {
      ...model,
      tags: model.tags ? JSON.parse(model.tags) : [],
    },
  })
})

/**
 * GET /models/configs/me
 * Get current user's model configurations
 */
models.get('/configs/me', async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json(
      {
        success: false,
        error: 'Unauthorized',
      },
      401
    )
  }

  const configs = await modelConfigService.getUserModelConfigs(userId)

  return c.json({
    success: true,
    data: configs.map(({ config, model }) => ({
      id: config.id,
      modelId: model.id,
      modelName: model.displayName,
      provider: model.provider,
      nickname: config.nickname,
      enabled: config.enabled,
      apiKeyLastFour: config.apiKeyLastFour,
      customTemperature: config.customTemperature,
      customMaxTokens: config.customMaxTokens,
      customSystemPrompt: config.customSystemPrompt,
      monthlyBudgetUsd: config.monthlyBudgetUsd,
      dailyRequestLimit: config.dailyRequestLimit,
      lastUsedAt: config.lastUsedAt,
      createdAt: config.createdAt,
      // Model capabilities
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      supportsStreaming: model.supportsStreaming,
      supportsFunctions: model.supportsFunctions,
      supportsVision: model.supportsVision,
      // Pricing
      inputPricePer1M: model.inputPricePer1M,
      outputPricePer1M: model.outputPricePer1M,
    })),
  })
})

/**
 * POST /models/configs
 * Create a new model configuration for current user
 */
models.post(
  '/configs',
  zValidator(
    'json',
    z.object({
      modelId: z.string(),
      apiKey: z.string().min(10),
      nickname: z.string().optional(),
      customTemperature: z.number().min(0).max(1000).optional(),
      customMaxTokens: z.number().min(1).optional(),
      customSystemPrompt: z.string().optional(),
      monthlyBudgetUsd: z.number().min(0).optional(),
      dailyRequestLimit: z.number().min(1).optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        401
      )
    }

    const data = c.req.valid('json')

    try {
      const config = await modelConfigService.createUserModelConfig(userId, data)

      return c.json(
        {
          success: true,
          data: {
            id: config.id,
            modelId: config.modelId,
            nickname: config.nickname,
            apiKeyLastFour: config.apiKeyLastFour,
            enabled: config.enabled,
            createdAt: config.createdAt,
          },
          message: 'Model configuration created successfully',
        },
        201
      )
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create configuration',
        },
        400
      )
    }
  }
)

/**
 * PATCH /models/configs/:id
 * Update a model configuration
 */
models.patch(
  '/configs/:id',
  zValidator(
    'json',
    z.object({
      nickname: z.string().optional(),
      customTemperature: z.number().min(0).max(1000).optional(),
      customMaxTokens: z.number().min(1).optional(),
      customSystemPrompt: z.string().optional(),
      monthlyBudgetUsd: z.number().min(0).optional(),
      dailyRequestLimit: z.number().min(1).optional(),
      enabled: z.boolean().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        401
      )
    }

    const configId = c.req.param('id')
    const updates = c.req.valid('json')

    try {
      const config = await modelConfigService.updateUserModelConfig(userId, configId, updates)

      if (!config) {
        return c.json(
          {
            success: false,
            error: 'Configuration not found',
          },
          404
        )
      }

      return c.json({
        success: true,
        data: {
          id: config.id,
          modelId: config.modelId,
          nickname: config.nickname,
          enabled: config.enabled,
          customTemperature: config.customTemperature,
          customMaxTokens: config.customMaxTokens,
          monthlyBudgetUsd: config.monthlyBudgetUsd,
          dailyRequestLimit: config.dailyRequestLimit,
        },
        message: 'Configuration updated successfully',
      })
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update configuration',
        },
        400
      )
    }
  }
)

/**
 * DELETE /models/configs/:id
 * Delete a model configuration
 */
models.delete('/configs/:id', async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json(
      {
        success: false,
        error: 'Unauthorized',
      },
      401
    )
  }

  const configId = c.req.param('id')

  try {
    await modelConfigService.deleteUserModelConfig(userId, configId)

    return c.json({
      success: true,
      message: 'Configuration deleted successfully',
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete configuration',
      },
      400
    )
  }
})

/**
 * GET /models/usage/me
 * Get current user's usage statistics
 */
models.get(
  '/usage/me',
  zValidator(
    'query',
    z.object({
      modelId: z.string().optional(),
      startDate: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
      endDate: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
      limit: z.string().optional().transform((val) => (val ? parseInt(val) : undefined)),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        401
      )
    }

    const options = c.req.valid('query')
    const stats = await modelConfigService.getUserUsageStats(userId, options)

    return c.json({
      success: true,
      data: {
        ...stats,
        // Format costs for display
        totalCostFormatted: modelConfigService.formatCost(stats.totalCostUsd),
        byModel: stats.byModel.map((m) => ({
          ...m,
          costFormatted: modelConfigService.formatCost(m.costUsd),
        })),
      },
    })
  }
)

/**
 * GET /models/configs/:id/budget
 * Check budget limits for a configuration
 */
models.get('/configs/:id/budget', async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json(
      {
        success: false,
        error: 'Unauthorized',
      },
      401
    )
  }

  const configId = c.req.param('id')

  try {
    const budgetCheck = await modelConfigService.checkUserBudgetLimits(userId, configId)

    return c.json({
      success: true,
      data: {
        ...budgetCheck,
        currentMonthCostFormatted: modelConfigService.formatCost(budgetCheck.currentMonthCostUsd),
        monthlyBudgetFormatted: budgetCheck.monthlyBudgetUsd
          ? modelConfigService.formatCost(budgetCheck.monthlyBudgetUsd)
          : null,
      },
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check budget',
      },
      400
    )
  }
})

/**
 * POST /models/calculate-cost
 * Calculate cost for a hypothetical request
 */
models.post(
  '/calculate-cost',
  zValidator(
    'json',
    z.object({
      modelId: z.string(),
      inputTokens: z.number().min(0),
      outputTokens: z.number().min(0),
    })
  ),
  async (c) => {
    const { modelId, inputTokens, outputTokens } = c.req.valid('json')

    const model = await modelConfigService.getModelById(modelId)
    if (!model) {
      return c.json(
        {
          success: false,
          error: 'Model not found',
        },
        404
      )
    }

    const cost = modelConfigService.calculateCost(model, inputTokens, outputTokens)

    return c.json({
      success: true,
      data: {
        ...cost,
        inputCostFormatted: modelConfigService.formatCost(cost.inputCostUsd),
        outputCostFormatted: modelConfigService.formatCost(cost.outputCostUsd),
        totalCostFormatted: modelConfigService.formatCost(cost.totalCostUsd),
      },
    })
  }
)

export default models
