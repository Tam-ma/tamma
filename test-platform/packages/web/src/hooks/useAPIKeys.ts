import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiKeyService } from '@/services/api-key.service';
import type {
  APIKeyFilters,
  CreateAPIKeyRequest,
  UpdateAPIKeyRequest,
} from '@/types/api-key.types';

const API_KEYS_QUERY_KEY = ['api-keys'];

export const useAPIKeys = (filters?: APIKeyFilters) => {
  const queryClient = useQueryClient();

  // List API keys
  const keysQuery = useQuery({
    queryKey: [...API_KEYS_QUERY_KEY, filters],
    queryFn: () => apiKeyService.listKeys(filters),
    staleTime: 30000, // 30 seconds
  });

  // Create API key mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateAPIKeyRequest) => apiKeyService.createKey(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
  });

  // Update API key mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAPIKeyRequest }) =>
      apiKeyService.updateKey(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
  });

  // Revoke API key mutation
  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiKeyService.revokeKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
  });

  return {
    keys: keysQuery.data?.apiKeys || [],
    total: keysQuery.data?.total || 0,
    isLoading: keysQuery.isLoading,
    isError: keysQuery.isError,
    error: keysQuery.error,
    createKey: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    updateKey: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    revokeKey: revokeMutation.mutateAsync,
    isRevoking: revokeMutation.isPending,
    refetch: keysQuery.refetch,
  };
};

export const useAPIKeyDetails = (id: string) => {
  return useQuery({
    queryKey: [...API_KEYS_QUERY_KEY, id],
    queryFn: () => apiKeyService.getKeyDetails(id),
    enabled: !!id,
  });
};

export const useAPIKeyUsage = (id: string, timeRange?: '7d' | '30d' | '90d') => {
  return useQuery({
    queryKey: [...API_KEYS_QUERY_KEY, id, 'usage', timeRange],
    queryFn: () => apiKeyService.getUsageStats(id, timeRange),
    enabled: !!id,
    staleTime: 60000, // 1 minute
  });
};
