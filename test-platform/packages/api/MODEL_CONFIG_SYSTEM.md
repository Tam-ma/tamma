# LLM Model Configuration System

Complete system for managing AI models, user configurations, and usage tracking.

## Overview

The LLM configuration system provides a centralized way to:
- Catalog available AI models with pricing and capabilities
- Manage user-specific API keys and preferences
- Track usage and costs per user per model
- Enforce budget limits and rate limits
- Support a system user for platform operations

## Database Schema

### Tables Created

#### 1. `llm_models` - Global Model Catalog
Stores all available AI models with their configurations:
- **Identity**: provider, model name, display name
- **API Details**: endpoint, version, authentication requirements
- **Capabilities**: context window, max output tokens, streaming, functions, vision support
- **Pricing**: input/output costs in micro-dollars per 1M tokens
- **Metadata**: tags, status (active/beta/deprecated), recommended settings

#### 2. `user_model_configs` - User-Specific Configurations
Stores user API keys and preferences:
- **Credentials**: Encrypted API key, last 4 digits for display
- **Preferences**: Custom temperature, max tokens, system prompt
- **Limits**: Monthly budget (USD), daily request limit
- **Status**: Enabled/disabled, last used timestamp

#### 3. `model_usage` - Usage Tracking
Records every API call with costs:
- **Request Info**: Type (benchmark/chat/completion), timestamps
- **Token Counts**: Input, output, total tokens
- **Costs**: Calculated in micro-dollars based on model pricing
- **Performance**: Latency in milliseconds
- **Status**: Success/failure with error messages

#### 4. `system_config` - Platform Settings
Global configuration for the platform:
- **System User**: Reference to system user account
- **Defaults**: Default benchmark and judge models
- **Rate Limits**: Global and per-user limits
- **Features**: Feature flags (JSON)

## Seeded Data

The `seed-llm-models.ts` script seeds 12 popular AI models:

### Anthropic (3 models)
- Claude 3.5 Sonnet: $3/$15 per 1M tokens
- Claude 3.5 Haiku: $1/$5 per 1M tokens
- Claude 3 Opus: $15/$75 per 1M tokens

### OpenAI (4 models)
- GPT-4o: $2.50/$10 per 1M tokens
- GPT-4o mini: $0.15/$0.60 per 1M tokens
- O1: $15/$60 per 1M tokens
- O1-mini: $3/$12 per 1M tokens

### Google (3 models)
- Gemini 2.0 Flash (Experimental): Free during preview
- Gemini 1.5 Pro: $1.25/$5 per 1M tokens
- Gemini 1.5 Flash: $0.075/$0.30 per 1M tokens

### Mistral (1 model)
- Mistral Large: $2/$6 per 1M tokens

### DeepSeek (1 model)
- DeepSeek Chat: $0.14/$0.28 per 1M tokens

### System User
- Email: `system@test-platform.local`
- Used for running benchmarks and platform operations
- Pre-configured with models based on environment variables

## API Endpoints

### Model Catalog

#### `GET /models`
List all available models with optional filters:
```bash
GET /models?provider=anthropic&status=active&supportsVision=true
```

#### `GET /models/:id`
Get details for a specific model:
```bash
GET /models/anthropic/claude-3-5-sonnet-20241022
```

### User Configurations

#### `GET /models/configs/me`
Get current user's model configurations:
```bash
GET /models/configs/me
Authorization: Bearer <token>
```

#### `POST /models/configs`
Create a new model configuration:
```bash
POST /models/configs
Authorization: Bearer <token>
Content-Type: application/json

{
  "modelId": "anthropic/claude-3-5-sonnet-20241022",
  "apiKey": "sk-ant-...",
  "nickname": "My Claude Sonnet",
  "customTemperature": 700,
  "monthlyBudgetUsd": 50000000,
  "dailyRequestLimit": 1000
}
```

#### `PATCH /models/configs/:id`
Update a configuration:
```bash
PATCH /models/configs/<config-id>
Authorization: Bearer <token>
Content-Type: application/json

{
  "nickname": "Updated Name",
  "monthlyBudgetUsd": 100000000,
  "enabled": true
}
```

#### `DELETE /models/configs/:id`
Delete a configuration:
```bash
DELETE /models/configs/<config-id>
Authorization: Bearer <token>
```

### Usage Tracking

#### `GET /models/usage/me`
Get usage statistics:
```bash
GET /models/usage/me?modelId=anthropic/claude-3-5-sonnet-20241022&startDate=2024-11-01
Authorization: Bearer <token>
```

Response:
```json
{
  "success": true,
  "data": {
    "totalRequests": 150,
    "successfulRequests": 148,
    "totalTokens": 500000,
    "totalCostUsd": 2500000,
    "totalCostFormatted": "$2.500000",
    "averageLatencyMs": 1234,
    "byModel": [
      {
        "modelId": "anthropic/claude-3-5-sonnet-20241022",
        "modelName": "Claude 3.5 Sonnet",
        "requests": 150,
        "tokens": 500000,
        "costUsd": 2500000,
        "costFormatted": "$2.500000"
      }
    ]
  }
}
```

#### `GET /models/configs/:id/budget`
Check budget limits:
```bash
GET /models/configs/<config-id>/budget
Authorization: Bearer <token>
```

Response:
```json
{
  "success": true,
  "data": {
    "withinBudget": true,
    "withinDailyLimit": true,
    "currentMonthCostUsd": 2500000,
    "currentMonthCostFormatted": "$2.500000",
    "todayRequestCount": 45,
    "monthlyBudgetUsd": 50000000,
    "monthlyBudgetFormatted": "$50.000000",
    "dailyRequestLimit": 1000
  }
}
```

### Cost Calculation

#### `POST /models/calculate-cost`
Calculate hypothetical cost:
```bash
POST /models/calculate-cost
Content-Type: application/json

{
  "modelId": "anthropic/claude-3-5-sonnet-20241022",
  "inputTokens": 1000,
  "outputTokens": 500
}
```

Response:
```json
{
  "success": true,
  "data": {
    "inputCostUsd": 3000,
    "outputCostUsd": 7500,
    "totalCostUsd": 10500,
    "inputCostFormatted": "$0.003000",
    "outputCostFormatted": "$0.007500",
    "totalCostFormatted": "$0.010500"
  }
}
```

## Service Layer

### `model-config.service.ts`

Key functions:

#### Model Catalog
- `getAllModels(filters?)` - Get all models with optional filters
- `getModelById(modelId)` - Get specific model details

#### User Configuration Management
- `getUserModelConfigs(userId)` - Get user's configurations
- `getUserModelConfig(userId, configId)` - Get specific config
- `createUserModelConfig(userId, data)` - Create new config
- `updateUserModelConfig(userId, configId, updates)` - Update config
- `deleteUserModelConfig(userId, configId)` - Delete config

#### Usage Tracking
- `recordModelUsage(data)` - Record an API call with costs
- `getUserUsageStats(userId, options?)` - Get usage statistics
- `checkUserBudgetLimits(userId, configId)` - Check budget limits

#### System Operations
- `getSystemConfig()` - Get platform configuration
- `getSystemModelConfigs()` - Get system user's models

#### Utilities
- `calculateCost(model, inputTokens, outputTokens)` - Calculate costs
- `formatCost(microDollars)` - Format micro-dollars to USD string

## Usage Example

### 1. Seed the Database

```bash
# Generate migration
npm run db:generate

# Apply migration
npm run db:migrate

# Seed models (requires ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY env vars)
npm run db:seed-models
```

### 2. User Configures Their Model

```typescript
// User adds their API key
const config = await createUserModelConfig('user-123', {
  modelId: 'anthropic/claude-3-5-sonnet-20241022',
  apiKey: process.env.ANTHROPIC_API_KEY,
  nickname: 'My Production Claude',
  customTemperature: 700,
  monthlyBudgetUsd: 50_000_000, // $50/month
  dailyRequestLimit: 1000,
})
```

### 3. Application Uses Model

```typescript
// Get user's config
const configs = await getUserModelConfigs('user-123')
const config = configs[0].config
const model = configs[0].model

// Check budget before request
const budgetCheck = await checkUserBudgetLimits('user-123', config.id)
if (!budgetCheck.withinBudget || !budgetCheck.withinDailyLimit) {
  throw new Error('Budget limit exceeded')
}

// Make API call (example - actual implementation would use ModelInterface)
const startTime = Date.now()
const response = await fetch(model.apiEndpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey, // TODO: decrypt in production
  },
  body: JSON.stringify({
    model: model.modelName,
    messages: [{ role: 'user', content: 'Hello!' }],
  }),
})
const latencyMs = Date.now() - startTime

// Parse response and get token counts
const result = await response.json()
const inputTokens = result.usage.input_tokens
const outputTokens = result.usage.output_tokens

// Record usage
await recordModelUsage({
  userId: 'user-123',
  userModelConfigId: config.id,
  modelId: model.id,
  requestType: 'chat',
  inputTokens,
  outputTokens,
  latencyMs,
  success: response.ok,
  errorMessage: response.ok ? undefined : result.error?.message,
})
```

### 4. User Views Their Usage

```typescript
// Get monthly stats
const stats = await getUserUsageStats('user-123', {
  startDate: new Date('2024-11-01'),
  endDate: new Date('2024-11-30'),
})

console.log(`Total Requests: ${stats.totalRequests}`)
console.log(`Total Cost: ${formatCost(stats.totalCostUsd)}`)
console.log(`Average Latency: ${stats.averageLatencyMs}ms`)

// By model breakdown
stats.byModel.forEach((m) => {
  console.log(`${m.modelName}: ${m.requests} requests, ${formatCost(m.costUsd)}`)
})
```

## Cost Tracking Details

### Micro-Dollar Precision
All monetary values are stored as integers in micro-dollars (USD × 1,000,000):
- $1.00 = 1,000,000 micro-dollars
- $0.000001 = 1 micro-dollar
- Avoids floating-point precision issues
- Easy exact calculations

### Cost Calculation Formula
```typescript
// For 1,000 input tokens and 500 output tokens
// Using Claude 3.5 Sonnet ($3/$15 per 1M tokens)

inputCost = (inputTokens / 1_000_000) × inputPricePer1M
         = (1000 / 1_000_000) × 3_000_000
         = 3000 micro-dollars ($0.003)

outputCost = (outputTokens / 1_000_000) × outputPricePer1M
          = (500 / 1_000_000) × 15_000_000
          = 7500 micro-dollars ($0.0075)

totalCost = 10500 micro-dollars ($0.0105)
```

## Security Considerations

### API Key Storage
⚠️ **Current Implementation**: API keys are stored in plain text with TODO comments for encryption.

**Production Requirements**:
1. Encrypt API keys before storing
2. Use environment-specific encryption keys
3. Implement key rotation mechanism
4. Use secrets management service (e.g., Cloudflare Workers Secrets)

### Authentication
- All `/models/configs` endpoints require authentication
- User ID extracted from JWT token
- Users can only access their own configurations

### Budget Enforcement
- Check budget limits before making API calls
- Track costs in real-time
- Prevent requests when limits exceeded

## Integration with Benchmark System

The benchmark runner can use this system to:

```typescript
// Get system user's configured models
const systemConfigs = await getSystemModelConfigs()

// Run benchmarks with each model
for (const { config, model } of systemConfigs) {
  const modelConfig = {
    provider: model.provider,
    model: model.modelName,
    apiKey: config.apiKey, // TODO: decrypt
    temperature: (config.customTemperature || model.recommendedTemperature) / 1000,
    maxTokens: config.customMaxTokens || model.maxOutputTokens,
  }

  // Execute benchmark
  const result = await runner.executeTask({
    task,
    modelConfig,
  })

  // Record usage
  await recordModelUsage({
    userId: config.userId,
    userModelConfigId: config.id,
    modelId: model.id,
    requestType: 'benchmark',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.executionTime,
    success: true,
  })
}
```

## Future Enhancements

- [ ] API key encryption/decryption
- [ ] Rate limiting middleware
- [ ] Cost alerts and notifications
- [ ] Model performance analytics
- [ ] Automatic model selection based on task requirements
- [ ] Batch usage reporting
- [ ] Usage forecasting
- [ ] Integration with payment systems
- [ ] Multi-provider fallback strategies
- [ ] Caching layer for model metadata
