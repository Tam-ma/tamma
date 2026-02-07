/**
 * RAG Config Hook
 *
 * React hook for RAG pipeline configuration and testing.
 */

import { useState, useCallback } from 'react';
import type { RAGConfigInfo, RAGMetricsInfo, RAGTestResult } from '@tamma/shared';
import { ragApi } from '../../services/knowledge-base/api-client.js';

export interface UseRAGConfigReturn {
  config: RAGConfigInfo | null;
  metrics: RAGMetricsInfo | null;
  testResult: RAGTestResult | null;
  loading: boolean;
  error: string | null;
  loadConfig: () => Promise<void>;
  updateConfig: (config: Partial<RAGConfigInfo>) => Promise<void>;
  loadMetrics: () => Promise<void>;
  testQuery: (query: string, options?: { sources?: string[]; maxTokens?: number; topK?: number }) => Promise<void>;
}

export function useRAGConfig(): UseRAGConfigReturn {
  const [config, setConfig] = useState<RAGConfigInfo | null>(null);
  const [metrics, setMetrics] = useState<RAGMetricsInfo | null>(null);
  const [testResult, setTestResult] = useState<RAGTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ragApi.getConfig();
      setConfig(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(async (newConfig: Partial<RAGConfigInfo>) => {
    try {
      const updated = await ragApi.updateConfig(newConfig);
      setConfig(updated);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update config');
    }
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      const data = await ragApi.getMetrics();
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    }
  }, []);

  const testQuery = useCallback(async (
    query: string,
    options?: { sources?: string[]; maxTokens?: number; topK?: number },
  ) => {
    setLoading(true);
    try {
      const result = await ragApi.testQuery({ query, ...options });
      setTestResult(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test query failed');
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    config,
    metrics,
    testResult,
    loading,
    error,
    loadConfig,
    updateConfig,
    loadMetrics,
    testQuery,
  };
}
