import { apiClient } from '@/lib/api-client';
import type {
  APIKey,
  APIKeyFilters,
  APIKeyGeneratedResponse,
  APIKeysListResponse,
  APIKeyUsageDetails,
  CreateAPIKeyRequest,
  UpdateAPIKeyRequest,
} from '@/types/api-key.types';

export const apiKeyService = {
  /**
   * List all API keys with optional filters
   */
  async listKeys(filters?: APIKeyFilters): Promise<APIKeysListResponse> {
    return apiClient.get<APIKeysListResponse>('/auth/api-keys', filters);
  },

  /**
   * Create a new API key
   */
  async createKey(data: CreateAPIKeyRequest): Promise<APIKeyGeneratedResponse> {
    return apiClient.post<APIKeyGeneratedResponse>('/auth/api-keys', data);
  },

  /**
   * Get details of a specific API key
   */
  async getKeyDetails(id: string): Promise<APIKey> {
    return apiClient.get<APIKey>(`/auth/api-keys/${id}`);
  },

  /**
   * Update an existing API key
   */
  async updateKey(id: string, data: UpdateAPIKeyRequest): Promise<APIKey> {
    return apiClient.patch<APIKey>(`/auth/api-keys/${id}`, data);
  },

  /**
   * Revoke (delete) an API key
   */
  async revokeKey(id: string): Promise<{ success: boolean }> {
    return apiClient.delete<{ success: boolean }>(`/auth/api-keys/${id}`);
  },

  /**
   * Get usage statistics for a specific API key
   */
  async getUsageStats(id: string, timeRange?: '7d' | '30d' | '90d'): Promise<APIKeyUsageDetails> {
    return apiClient.get<APIKeyUsageDetails>(`/auth/api-keys/${id}/usage`, {
      timeRange: timeRange || '30d',
    });
  },

  /**
   * Test if an API key is valid
   */
  async validateKey(keyPrefix: string): Promise<{ valid: boolean; status?: string }> {
    return apiClient.post<{ valid: boolean; status?: string }>('/auth/api-keys/validate', {
      keyPrefix,
    });
  },
};
