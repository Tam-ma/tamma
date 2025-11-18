import apiClient, { getErrorMessage } from './api'

export interface CreateAPIKeyData {
  name: string
  description?: string
  scopes: string[]
  rateLimit?: number
  expiresAt?: string
  ipWhitelist?: string[]
}

export interface UpdateAPIKeyData {
  name?: string
  description?: string
  rateLimit?: number
  ipWhitelist?: string[]
}

export interface APIKey {
  id: string
  name: string
  description?: string
  keyPrefix: string
  scopes: string[]
  rateLimit: number
  expiresAt?: string
  createdAt: string
  lastUsedAt?: string
  usage: {
    totalRequests: number
    requestsThisPeriod: number
    errorRate: number
  }
  status: 'active' | 'inactive' | 'expired' | 'revoked'
  ipWhitelist?: string[]
}

export interface APIKeyWithSecret extends APIKey {
  key: string // Full key, only shown once after generation
}

export interface UsageMetrics {
  period: string
  requestCount: number
  errorCount: number
  successRate: number
  avgResponseTime: number
}

/**
 * API Keys service for key management
 */
class APIKeysService {
  /**
   * Generate a new API key
   */
  async generateKey(data: CreateAPIKeyData): Promise<APIKeyWithSecret> {
    try {
      const response = await apiClient.post('/api-keys', data)
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * List all API keys for the current user
   */
  async listKeys(params?: {
    page?: number
    limit?: number
    status?: string
    search?: string
  }): Promise<{ keys: APIKey[]; total: number; page: number; pages: number }> {
    try {
      const response = await apiClient.get('/api-keys', { params })
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Get details of a specific API key
   */
  async getKey(keyId: string): Promise<APIKey> {
    try {
      const response = await apiClient.get(`/api-keys/${keyId}`)
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Update an API key
   */
  async updateKey(keyId: string, data: UpdateAPIKeyData): Promise<APIKey> {
    try {
      const response = await apiClient.put(`/api-keys/${keyId}`, data)
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Revoke an API key
   */
  async revokeKey(keyId: string): Promise<{ message: string }> {
    try {
      const response = await apiClient.delete(`/api-keys/${keyId}`)
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Get usage statistics for an API key
   */
  async getKeyUsage(
    keyId: string,
    params?: {
      startDate?: string
      endDate?: string
      groupBy?: 'hour' | 'day' | 'week' | 'month'
    }
  ): Promise<UsageMetrics[]> {
    try {
      const response = await apiClient.get(`/api-keys/${keyId}/usage`, { params })
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }
}

export const apiKeysService = new APIKeysService()
