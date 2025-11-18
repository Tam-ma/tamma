/**
 * Seed script for LLM Models
 * Populates the database with popular AI models and their configurations
 */

import { db } from '../index'
import { llmModels, users, systemConfig, userModelConfigs } from '../schema'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import type { InsertLLMModel, InsertUser, InsertSystemConfig } from '../schema'

/**
 * Popular LLM Models with current pricing (as of Nov 2024)
 * Prices are in micro-dollars per 1M tokens
 */
const models: InsertLLMModel[] = [
  // Anthropic Claude Models
  {
    id: 'anthropic/claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    modelName: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    apiEndpoint: 'https://api.anthropic.com/v1/messages',
    apiVersion: '2023-06-01',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsFunctions: true,
    supportsVision: true,
    inputPricePer1M: 3_000_000, // $3.00 per 1M input tokens
    outputPricePer1M: 15_000_000, // $15.00 per 1M output tokens
    recommendedTemperature: 700, // 0.7
    tags: JSON.stringify(['high-quality', 'vision', 'long-context', 'reasoning']),
    description: 'Most intelligent model with extended thinking and vision capabilities',
    status: 'active',
  },
  {
    id: 'anthropic/claude-3-5-haiku-20241022',
    provider: 'anthropic',
    modelName: 'claude-3-5-haiku-20241022',
    displayName: 'Claude 3.5 Haiku',
    apiEndpoint: 'https://api.anthropic.com/v1/messages',
    apiVersion: '2023-06-01',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsFunctions: true,
    supportsVision: true,
    inputPricePer1M: 1_000_000, // $1.00
    outputPricePer1M: 5_000_000, // $5.00
    recommendedTemperature: 700,
    tags: JSON.stringify(['fast', 'cost-effective', 'vision']),
    description: 'Fastest and most cost-effective model with vision',
    status: 'active',
  },
  {
    id: 'anthropic/claude-3-opus-20240229',
    provider: 'anthropic',
    modelName: 'claude-3-opus-20240229',
    displayName: 'Claude 3 Opus',
    apiEndpoint: 'https://api.anthropic.com/v1/messages',
    apiVersion: '2023-06-01',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    supportsStreaming: true,
    supportsFunctions: true,
    supportsVision: true,
    inputPricePer1M: 15_000_000, // $15.00
    outputPricePer1M: 75_000_000, // $75.00
    recommendedTemperature: 700,
    tags: JSON.stringify(['highest-quality', 'vision', 'complex-reasoning']),
    description: 'Most powerful model for complex tasks',
    status: 'active',
  },

  // OpenAI GPT Models
  {
    id: 'openai/gpt-4o',
    provider: 'openai',
    modelName: 'gpt-4o',
    displayName: 'GPT-4o',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiVersion: 'v1',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsStreaming: true,
    supportsFunctions: true,
    supportsVision: true,
    inputPricePer1M: 2_500_000, // $2.50
    outputPricePer1M: 10_000_000, // $10.00
    recommendedTemperature: 700,
    tags: JSON.stringify(['high-quality', 'vision', 'multimodal', 'fast']),
    description: 'OpenAI\'s flagship model with vision and speed',
    status: 'active',
  },
  {
    id: 'openai/gpt-4o-mini',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiVersion: 'v1',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsStreaming: true,
    supportsFunctions: true,
    supportsVision: true,
    inputPricePer1M: 150_000, // $0.15
    outputPricePer1M: 600_000, // $0.60
    recommendedTemperature: 700,
    tags: JSON.stringify(['cost-effective', 'fast', 'vision']),
    description: 'Affordable and fast model for most tasks',
    status: 'active',
  },
  {
    id: 'openai/o1',
    provider: 'openai',
    modelName: 'o1',
    displayName: 'O1',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiVersion: 'v1',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    supportsStreaming: false,
    supportsFunctions: false,
    supportsVision: false,
    inputPricePer1M: 15_000_000, // $15.00
    outputPricePer1M: 60_000_000, // $60.00
    recommendedTemperature: 1000, // Fixed at 1.0
    tags: JSON.stringify(['reasoning', 'long-output', 'complex-problems']),
    description: 'Advanced reasoning model for complex problem-solving',
    status: 'active',
  },
  {
    id: 'openai/o1-mini',
    provider: 'openai',
    modelName: 'o1-mini',
    displayName: 'O1-mini',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiVersion: 'v1',
    contextWindow: 128000,
    maxOutputTokens: 65536,
    supportsStreaming: false,
    supportsFunctions: false,
    supportsVision: false,
    inputPricePer1M: 3_000_000, // $3.00
    outputPricePer1M: 12_000_000, // $12.00
    recommendedTemperature: 1000,
    tags: JSON.stringify(['reasoning', 'cost-effective']),
    description: 'Cost-effective reasoning model for STEM tasks',
    status: 'active',
  },

  // Google Gemini Models
  {
    id: 'google/gemini-2.0-flash-exp',
    provider: 'google',
    modelName: 'gemini-2.0-flash-exp',
    displayName: 'Gemini 2.0 Flash (Experimental)',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    apiVersion: 'v1beta',
    contextWindow: 1048576, // 1M tokens
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsFunctions: true,
    supportsVision: true,
    inputPricePer1M: 0, // Free during preview
    outputPricePer1M: 0,
    recommendedTemperature: 700,
    tags: JSON.stringify(['experimental', 'long-context', 'multimodal', 'free']),
    description: 'Experimental model with 1M context window',
    status: 'beta',
  },
  {
    id: 'google/gemini-1.5-pro',
    provider: 'google',
    modelName: 'gemini-1.5-pro',
    displayName: 'Gemini 1.5 Pro',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    apiVersion: 'v1beta',
    contextWindow: 2097152, // 2M tokens
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsFunctions: true,
    supportsVision: true,
    inputPricePer1M: 1_250_000, // $1.25
    outputPricePer1M: 5_000_000, // $5.00
    recommendedTemperature: 700,
    tags: JSON.stringify(['long-context', 'multimodal', 'high-quality']),
    description: 'High-intelligence model with 2M context window',
    status: 'active',
  },
  {
    id: 'google/gemini-1.5-flash',
    provider: 'google',
    modelName: 'gemini-1.5-flash',
    displayName: 'Gemini 1.5 Flash',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    apiVersion: 'v1beta',
    contextWindow: 1048576, // 1M tokens
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsFunctions: true,
    supportsVision: true,
    inputPricePer1M: 75_000, // $0.075
    outputPricePer1M: 300_000, // $0.30
    recommendedTemperature: 700,
    tags: JSON.stringify(['fast', 'cost-effective', 'long-context']),
    description: 'Fast and cost-effective with large context',
    status: 'active',
  },

  // Mistral Models
  {
    id: 'mistral/mistral-large-latest',
    provider: 'mistral',
    modelName: 'mistral-large-latest',
    displayName: 'Mistral Large',
    apiEndpoint: 'https://api.mistral.ai/v1/chat/completions',
    apiVersion: 'v1',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsStreaming: true,
    supportsFunctions: true,
    supportsVision: false,
    inputPricePer1M: 2_000_000, // $2.00
    outputPricePer1M: 6_000_000, // $6.00
    recommendedTemperature: 700,
    tags: JSON.stringify(['high-quality', 'multilingual']),
    description: 'Top-tier reasoning for high-complexity tasks',
    status: 'active',
  },

  // DeepSeek Models
  {
    id: 'deepseek/deepseek-chat',
    provider: 'deepseek',
    modelName: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiVersion: 'v1',
    contextWindow: 64000,
    maxOutputTokens: 4096,
    supportsStreaming: true,
    supportsFunctions: false,
    supportsVision: false,
    inputPricePer1M: 140_000, // $0.14
    outputPricePer1M: 280_000, // $0.28
    recommendedTemperature: 700,
    tags: JSON.stringify(['cost-effective', 'coding']),
    description: 'Affordable model optimized for coding tasks',
    status: 'active',
  },
]

async function seedLLMModels() {
  console.log('🌱 Seeding LLM models...')

  try {
    // 1. Insert all models
    for (const model of models) {
      await db.insert(llmModels).values(model).onConflictDoNothing()
    }
    console.log(`✅ Successfully seeded ${models.length} LLM models`)

    // 2. Create system user
    const systemUserId = 'system-user'
    const systemUser: InsertUser = {
      id: systemUserId,
      email: 'system@test-platform.local',
      passwordHash: nanoid(64), // Random hash, system user doesn't need to log in
      fullName: 'System User',
      emailVerified: true,
    }

    await db.insert(users).values(systemUser).onConflictDoNothing()
    console.log('✅ Created system user')

    // 3. Create system configuration
    const systemConfigData: InsertSystemConfig = {
      id: 'default',
      systemUserId,
      defaultBenchmarkModelId: 'anthropic/claude-3-5-sonnet-20241022',
      defaultJudgeModelId: 'anthropic/claude-3-opus-20240229',
      globalRateLimit: 10000,
      perUserRateLimit: 1000,
      features: JSON.stringify({
        benchmarking: true,
        publicLeaderboard: true,
        customModels: false, // To be enabled later
      }),
    }

    await db.insert(systemConfig).values(systemConfigData).onConflictDoNothing()
    console.log('✅ Created system configuration')

    // 4. Configure models for system user (for benchmarks)
    // Add API keys for system user from environment variables
    const systemConfigs = [
      {
        modelId: 'anthropic/claude-3-5-sonnet-20241022',
        envKey: 'ANTHROPIC_API_KEY',
        nickname: 'Default Benchmark Model',
      },
      {
        modelId: 'openai/gpt-4o',
        envKey: 'OPENAI_API_KEY',
        nickname: 'GPT-4o for Comparison',
      },
      {
        modelId: 'google/gemini-1.5-pro',
        envKey: 'GOOGLE_API_KEY',
        nickname: 'Gemini for Comparison',
      },
    ]

    let configuredCount = 0
    for (const config of systemConfigs) {
      const apiKey = process.env[config.envKey]
      if (apiKey) {
        await db
          .insert(userModelConfigs)
          .values({
            id: nanoid(),
            userId: systemUserId,
            modelId: config.modelId,
            apiKey, // In production, this should be encrypted
            apiKeyLastFour: apiKey.slice(-4),
            nickname: config.nickname,
            enabled: true,
          })
          .onConflictDoNothing()
        configuredCount++
      }
    }

    if (configuredCount > 0) {
      console.log(`✅ Configured ${configuredCount} models for system user`)
    } else {
      console.log('⚠️  No API keys found in environment variables')
      console.log('   Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY to configure models')
    }

    console.log('\n📊 Model Catalog Summary:')
    console.log(`   Anthropic: ${models.filter((m) => m.provider === 'anthropic').length} models`)
    console.log(`   OpenAI: ${models.filter((m) => m.provider === 'openai').length} models`)
    console.log(`   Google: ${models.filter((m) => m.provider === 'google').length} models`)
    console.log(`   Mistral: ${models.filter((m) => m.provider === 'mistral').length} models`)
    console.log(`   DeepSeek: ${models.filter((m) => m.provider === 'deepseek').length} models`)
  } catch (error) {
    console.error('❌ Error seeding LLM models:', error)
    throw error
  }
}

// Run if executed directly
if (require.main === module) {
  seedLLMModels()
    .then(() => {
      console.log('\n🎉 LLM models seed completed!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Failed to seed:', error)
      process.exit(1)
    })
}

export { seedLLMModels }
