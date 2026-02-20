/**
 * KB Analytics Hook
 *
 * React hook for knowledge base analytics and reporting.
 */

import { useState, useCallback } from 'react';
import type { UsageAnalytics, QualityAnalytics, CostAnalytics } from '@tamma/shared';
import { analyticsApi } from '../../services/knowledge-base/api-client.js';

export interface UseKBAnalyticsReturn {
  usage: UsageAnalytics | null;
  quality: QualityAnalytics | null;
  costs: CostAnalytics | null;
  loading: boolean;
  error: string | null;
  loadUsage: (start?: string, end?: string) => Promise<void>;
  loadQuality: (start?: string, end?: string) => Promise<void>;
  loadCosts: (start?: string, end?: string) => Promise<void>;
  loadAll: (start?: string, end?: string) => Promise<void>;
}

export function useKBAnalytics(): UseKBAnalyticsReturn {
  const [usage, setUsage] = useState<UsageAnalytics | null>(null);
  const [quality, setQuality] = useState<QualityAnalytics | null>(null);
  const [costs, setCosts] = useState<CostAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsage = useCallback(async (start?: string, end?: string) => {
    try {
      const data = await analyticsApi.getUsageAnalytics(start, end);
      setUsage(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage');
    }
  }, []);

  const loadQuality = useCallback(async (start?: string, end?: string) => {
    try {
      const data = await analyticsApi.getQualityAnalytics(start, end);
      setQuality(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quality');
    }
  }, []);

  const loadCosts = useCallback(async (start?: string, end?: string) => {
    try {
      const data = await analyticsApi.getCostAnalytics(start, end);
      setCosts(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load costs');
    }
  }, []);

  const loadAll = useCallback(async (start?: string, end?: string) => {
    setLoading(true);
    try {
      await Promise.all([
        loadUsage(start, end),
        loadQuality(start, end),
        loadCosts(start, end),
      ]);
    } finally {
      setLoading(false);
    }
  }, [loadUsage, loadQuality, loadCosts]);

  return {
    usage,
    quality,
    costs,
    loading,
    error,
    loadUsage,
    loadQuality,
    loadCosts,
    loadAll,
  };
}
