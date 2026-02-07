/**
 * Knowledge Base Store
 *
 * Centralized state management for the Knowledge Base dashboard.
 * Uses a simple React-compatible store pattern (can be swapped for Zustand).
 */

import type {
  IndexStatus,
  IndexHistoryEntry,
  IndexConfig,
  CollectionInfo,
  CollectionStatsInfo,
  VectorSearchResult,
  StorageUsage,
  RAGConfigInfo,
  RAGMetricsInfo,
  RAGTestResult,
  MCPServerInfo,
  MCPTool,
  MCPToolInvokeResult,
  MCPServerLog,
  ContextTestResult,
  UsageAnalytics,
  QualityAnalytics,
  CostAnalytics,
} from '@tamma/shared';

/** Full state shape for the Knowledge Base dashboard */
export interface KBStoreState {
  // Index Management
  indexStatus: IndexStatus | null;
  indexHistory: IndexHistoryEntry[];
  indexConfig: IndexConfig | null;

  // Vector Database
  collections: CollectionInfo[];
  selectedCollectionStats: CollectionStatsInfo | null;
  vectorSearchResults: VectorSearchResult[];
  storageUsage: StorageUsage | null;

  // RAG Pipeline
  ragConfig: RAGConfigInfo | null;
  ragMetrics: RAGMetricsInfo | null;
  ragTestResult: RAGTestResult | null;

  // MCP Servers
  mcpServers: MCPServerInfo[];
  mcpTools: MCPTool[];
  mcpInvokeResult: MCPToolInvokeResult | null;
  mcpLogs: MCPServerLog[];

  // Context Testing
  contextTestResult: ContextTestResult | null;
  contextTestHistory: ContextTestResult[];

  // Analytics
  usageAnalytics: UsageAnalytics | null;
  qualityAnalytics: QualityAnalytics | null;
  costAnalytics: CostAnalytics | null;

  // UI State
  activeSection: string;
  loading: boolean;
  error: string | null;
}

/** Default initial state */
export const initialKBState: KBStoreState = {
  indexStatus: null,
  indexHistory: [],
  indexConfig: null,

  collections: [],
  selectedCollectionStats: null,
  vectorSearchResults: [],
  storageUsage: null,

  ragConfig: null,
  ragMetrics: null,
  ragTestResult: null,

  mcpServers: [],
  mcpTools: [],
  mcpInvokeResult: null,
  mcpLogs: [],

  contextTestResult: null,
  contextTestHistory: [],

  usageAnalytics: null,
  qualityAnalytics: null,
  costAnalytics: null,

  activeSection: 'overview',
  loading: false,
  error: null,
};

/** Store actions for mutating state */
export interface KBStoreActions {
  setActiveSection: (section: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Index
  setIndexStatus: (status: IndexStatus) => void;
  setIndexHistory: (history: IndexHistoryEntry[]) => void;
  setIndexConfig: (config: IndexConfig) => void;

  // Vector DB
  setCollections: (collections: CollectionInfo[]) => void;
  setSelectedCollectionStats: (stats: CollectionStatsInfo | null) => void;
  setVectorSearchResults: (results: VectorSearchResult[]) => void;
  setStorageUsage: (usage: StorageUsage) => void;

  // RAG
  setRAGConfig: (config: RAGConfigInfo) => void;
  setRAGMetrics: (metrics: RAGMetricsInfo) => void;
  setRAGTestResult: (result: RAGTestResult) => void;

  // MCP
  setMCPServers: (servers: MCPServerInfo[]) => void;
  setMCPTools: (tools: MCPTool[]) => void;
  setMCPInvokeResult: (result: MCPToolInvokeResult | null) => void;
  setMCPLogs: (logs: MCPServerLog[]) => void;

  // Context
  setContextTestResult: (result: ContextTestResult) => void;
  setContextTestHistory: (history: ContextTestResult[]) => void;

  // Analytics
  setUsageAnalytics: (analytics: UsageAnalytics) => void;
  setQualityAnalytics: (analytics: QualityAnalytics) => void;
  setCostAnalytics: (analytics: CostAnalytics) => void;

  // Reset
  reset: () => void;
}

/**
 * Create a simple store implementation.
 * This can be used directly or replaced with Zustand's create().
 */
export function createKBStore(): { getState: () => KBStoreState; actions: KBStoreActions } {
  let state: KBStoreState = { ...initialKBState };

  const getState = () => ({ ...state });

  const actions: KBStoreActions = {
    setActiveSection: (section) => { state = { ...state, activeSection: section }; },
    setLoading: (loading) => { state = { ...state, loading }; },
    setError: (error) => { state = { ...state, error }; },

    setIndexStatus: (status) => { state = { ...state, indexStatus: status }; },
    setIndexHistory: (history) => { state = { ...state, indexHistory: history }; },
    setIndexConfig: (config) => { state = { ...state, indexConfig: config }; },

    setCollections: (collections) => { state = { ...state, collections }; },
    setSelectedCollectionStats: (stats) => { state = { ...state, selectedCollectionStats: stats }; },
    setVectorSearchResults: (results) => { state = { ...state, vectorSearchResults: results }; },
    setStorageUsage: (usage) => { state = { ...state, storageUsage: usage }; },

    setRAGConfig: (config) => { state = { ...state, ragConfig: config }; },
    setRAGMetrics: (metrics) => { state = { ...state, ragMetrics: metrics }; },
    setRAGTestResult: (result) => { state = { ...state, ragTestResult: result }; },

    setMCPServers: (servers) => { state = { ...state, mcpServers: servers }; },
    setMCPTools: (tools) => { state = { ...state, mcpTools: tools }; },
    setMCPInvokeResult: (result) => { state = { ...state, mcpInvokeResult: result }; },
    setMCPLogs: (logs) => { state = { ...state, mcpLogs: logs }; },

    setContextTestResult: (result) => { state = { ...state, contextTestResult: result }; },
    setContextTestHistory: (history) => { state = { ...state, contextTestHistory: history }; },

    setUsageAnalytics: (analytics) => { state = { ...state, usageAnalytics: analytics }; },
    setQualityAnalytics: (analytics) => { state = { ...state, qualityAnalytics: analytics }; },
    setCostAnalytics: (analytics) => { state = { ...state, costAnalytics: analytics }; },

    reset: () => { state = { ...initialKBState }; },
  };

  return { getState, actions };
}
