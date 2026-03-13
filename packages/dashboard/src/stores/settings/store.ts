/**
 * Settings Zustand Store
 *
 * Central state for all settings UI data: agents config, security config,
 * provider health, diagnostics, and prompt templates.
 */

import { create } from 'zustand';
import type { IAgentsConfig, SecurityConfig, DiagnosticsEvent } from '@tamma/shared';
import type { HealthStatusEntry, PromptTemplateEntry } from '../../services/settings/settings-api-client.js';
import {
  agentsApi,
  securityApi,
  healthApi,
  diagnosticsApi,
  promptsApi,
} from '../../services/settings/settings-api-client.js';

export interface SettingsState {
  // Agents
  agentsConfig: IAgentsConfig | null;
  agentsLoading: boolean;
  agentsError: string | null;
  loadAgentsConfig: () => Promise<void>;
  saveAgentsConfig: (config: IAgentsConfig) => Promise<void>;

  // Security
  securityConfig: SecurityConfig | null;
  securityLoading: boolean;
  securityError: string | null;
  loadSecurityConfig: () => Promise<void>;
  saveSecurityConfig: (config: SecurityConfig) => Promise<void>;

  // Health
  healthStatus: Record<string, HealthStatusEntry>;
  healthLoading: boolean;
  healthError: string | null;
  loadHealthStatus: () => Promise<void>;

  // Diagnostics
  diagnosticsEvents: DiagnosticsEvent[];
  diagnosticsLoading: boolean;
  diagnosticsError: string | null;
  loadDiagnostics: (options?: { limit?: number; type?: string; since?: number }) => Promise<void>;

  // Prompts
  promptTemplates: Record<string, PromptTemplateEntry>;
  promptsLoading: boolean;
  promptsError: string | null;
  loadPromptTemplates: () => Promise<void>;
  savePromptTemplate: (role: string, template: PromptTemplateEntry) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  // Agents
  agentsConfig: null,
  agentsLoading: false,
  agentsError: null,
  loadAgentsConfig: async () => {
    set({ agentsLoading: true, agentsError: null });
    try {
      const config = await agentsApi.getConfig();
      set({ agentsConfig: config, agentsLoading: false });
    } catch (err) {
      set({ agentsError: err instanceof Error ? err.message : 'Failed to load agents config', agentsLoading: false });
    }
  },
  saveAgentsConfig: async (config: IAgentsConfig) => {
    set({ agentsLoading: true, agentsError: null });
    try {
      const updated = await agentsApi.updateConfig(config);
      set({ agentsConfig: updated, agentsLoading: false });
    } catch (err) {
      set({ agentsError: err instanceof Error ? err.message : 'Failed to save agents config', agentsLoading: false });
      throw err;
    }
  },

  // Security
  securityConfig: null,
  securityLoading: false,
  securityError: null,
  loadSecurityConfig: async () => {
    set({ securityLoading: true, securityError: null });
    try {
      const config = await securityApi.getConfig();
      set({ securityConfig: config, securityLoading: false });
    } catch (err) {
      set({ securityError: err instanceof Error ? err.message : 'Failed to load security config', securityLoading: false });
    }
  },
  saveSecurityConfig: async (config: SecurityConfig) => {
    set({ securityLoading: true, securityError: null });
    try {
      const updated = await securityApi.updateConfig(config);
      set({ securityConfig: updated, securityLoading: false });
    } catch (err) {
      set({ securityError: err instanceof Error ? err.message : 'Failed to save security config', securityLoading: false });
      throw err;
    }
  },

  // Health
  healthStatus: {},
  healthLoading: false,
  healthError: null,
  loadHealthStatus: async () => {
    set({ healthLoading: true, healthError: null });
    try {
      const status = await healthApi.getStatus();
      set({ healthStatus: status, healthLoading: false });
    } catch (err) {
      set({ healthError: err instanceof Error ? err.message : 'Failed to load health status', healthLoading: false });
    }
  },

  // Diagnostics
  diagnosticsEvents: [],
  diagnosticsLoading: false,
  diagnosticsError: null,
  loadDiagnostics: async (options) => {
    set({ diagnosticsLoading: true, diagnosticsError: null });
    try {
      const events = await diagnosticsApi.getEvents(options as Parameters<typeof diagnosticsApi.getEvents>[0]);
      set({ diagnosticsEvents: events, diagnosticsLoading: false });
    } catch (err) {
      set({ diagnosticsError: err instanceof Error ? err.message : 'Failed to load diagnostics', diagnosticsLoading: false });
    }
  },

  // Prompts
  promptTemplates: {},
  promptsLoading: false,
  promptsError: null,
  loadPromptTemplates: async () => {
    set({ promptsLoading: true, promptsError: null });
    try {
      const templates = await promptsApi.getTemplates();
      set({ promptTemplates: templates, promptsLoading: false });
    } catch (err) {
      set({ promptsError: err instanceof Error ? err.message : 'Failed to load prompt templates', promptsLoading: false });
    }
  },
  savePromptTemplate: async (role: string, template: PromptTemplateEntry) => {
    set({ promptsLoading: true, promptsError: null });
    try {
      await promptsApi.updateTemplate(role, template);
      // Reload all templates to get consistent state
      const templates = await promptsApi.getTemplates();
      set({ promptTemplates: templates, promptsLoading: false });
    } catch (err) {
      set({ promptsError: err instanceof Error ? err.message : 'Failed to save prompt template', promptsLoading: false });
      throw err;
    }
  },
}));
