/**
 * AI Model Interface - Abstract interface for different AI providers
 */

import type { ModelConfig } from './types'

export interface ModelResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  model: string
  finishReason?: string
}

export interface ModelInterface {
  generateCode(prompt: string, config: ModelConfig): Promise<ModelResponse>
}

/**
 * Anthropic Claude Model Implementation
 */
export class AnthropicModel implements ModelInterface {
  async generateCode(prompt: string, config: ModelConfig): Promise<ModelResponse> {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required')
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens || 4096,
        temperature: config.temperature || 0.7,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        system: config.systemPrompt,
      }),
    })

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.statusText}`)
    }

    const data = await response.json()

    return {
      content: data.content[0].text,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      model: data.model,
      finishReason: data.stop_reason,
    }
  }
}

/**
 * OpenAI Model Implementation
 */
export class OpenAIModel implements ModelInterface {
  async generateCode(prompt: string, config: ModelConfig): Promise<ModelResponse> {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required')
    }

    const response = await fetch(
      config.baseURL || 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            ...(config.systemPrompt
              ? [{ role: 'system', content: config.systemPrompt }]
              : []),
            { role: 'user', content: prompt },
          ],
          temperature: config.temperature || 0.7,
          max_tokens: config.maxTokens || 4096,
        }),
      }
    )

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`)
    }

    const data = await response.json()

    return {
      content: data.choices[0].message.content,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      model: data.model,
      finishReason: data.choices[0].finish_reason,
    }
  }
}

/**
 * Google Gemini Model Implementation
 */
export class GoogleModel implements ModelInterface {
  async generateCode(prompt: string, config: ModelConfig): Promise<ModelResponse> {
    if (!config.apiKey) {
      throw new Error('Google API key is required')
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                ...(config.systemPrompt ? [{ text: config.systemPrompt }] : []),
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature: config.temperature || 0.7,
            maxOutputTokens: config.maxTokens || 4096,
          },
        }),
      }
    )

    if (!response.ok) {
      throw new Error(`Google API error: ${response.statusText}`)
    }

    const data = await response.json()
    const content = data.candidates[0].content.parts[0].text

    return {
      content,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
      model: config.model,
      finishReason: data.candidates[0].finishReason,
    }
  }
}

/**
 * Model Factory - Creates appropriate model interface based on provider
 */
export class ModelFactory {
  static create(config: ModelConfig): ModelInterface {
    switch (config.provider) {
      case 'anthropic':
        return new AnthropicModel()
      case 'openai':
        return new OpenAIModel()
      case 'google':
        return new GoogleModel()
      default:
        throw new Error(`Unsupported provider: ${config.provider}`)
    }
  }
}

/**
 * Extract code from model response
 * Handles markdown code blocks and raw code
 */
export function extractCode(response: string): string {
  // Try to extract code from markdown code blocks
  const codeBlockRegex = /```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/g
  const matches = Array.from(response.matchAll(codeBlockRegex))

  if (matches.length > 0) {
    // Return the last code block (usually the complete solution)
    return matches[matches.length - 1][1].trim()
  }

  // If no code blocks found, return the entire response
  // (assuming the model returned raw code)
  return response.trim()
}
