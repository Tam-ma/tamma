/**
 * ConfigService Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { ConfigService } from './ConfigService.js';
import type { IAgentsConfig, SecurityConfig } from '@tamma/shared';

describe('ConfigService', () => {
  describe('agents config', () => {
    it('returns default config when no initial config provided', async () => {
      const service = new ConfigService();
      const config = await service.getAgentsConfig();
      expect(config.defaults.providerChain).toHaveLength(1);
      expect(config.defaults.providerChain[0]!.provider).toBe('claude-code');
    });

    it('returns initial config when provided', async () => {
      const initial: IAgentsConfig = {
        defaults: {
          providerChain: [{ provider: 'openrouter' }],
          maxBudgetUsd: 5,
        },
      };
      const service = new ConfigService(initial);
      const config = await service.getAgentsConfig();
      expect(config.defaults.providerChain[0]!.provider).toBe('openrouter');
      expect(config.defaults.maxBudgetUsd).toBe(5);
    });

    it('returns a defensive copy', async () => {
      const service = new ConfigService();
      const config1 = await service.getAgentsConfig();
      const config2 = await service.getAgentsConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });

    it('validates on update', async () => {
      const service = new ConfigService();
      await expect(
        service.updateAgentsConfig({ defaults: { providerChain: [] } }),
      ).rejects.toThrow('defaults.providerChain must not be empty');
    });

    it('persists valid updates', async () => {
      const service = new ConfigService();
      const updated = await service.updateAgentsConfig({
        defaults: {
          providerChain: [{ provider: 'openai', model: 'gpt-4o' }],
        },
      });
      expect(updated.defaults.providerChain[0]!.provider).toBe('openai');

      const fetched = await service.getAgentsConfig();
      expect(fetched.defaults.providerChain[0]!.provider).toBe('openai');
    });
  });

  describe('security config', () => {
    it('returns default security config', async () => {
      const service = new ConfigService();
      const config = await service.getSecurityConfig();
      expect(config.sanitizeContent).toBe(true);
      expect(config.validateUrls).toBe(true);
      expect(config.blockedCommandPatterns).toBeInstanceOf(Array);
    });

    it('validates blocked patterns on update', async () => {
      const service = new ConfigService();
      await expect(
        service.updateSecurityConfig({
          blockedCommandPatterns: ['[invalid(regex'],
        }),
      ).rejects.toThrow('not a valid regex');
    });

    it('persists valid security updates', async () => {
      const service = new ConfigService();
      const updated = await service.updateSecurityConfig({
        sanitizeContent: false,
        gateActions: true,
      });
      expect(updated.sanitizeContent).toBe(false);
      expect(updated.gateActions).toBe(true);
    });
  });

  describe('prompt templates', () => {
    it('returns defaults entry', async () => {
      const service = new ConfigService();
      const templates = await service.getPromptTemplates();
      expect(templates['defaults']).toBeDefined();
    });

    it('updates prompt template for defaults', async () => {
      const service = new ConfigService();
      await service.updatePromptTemplate('defaults', {
        systemPrompt: 'Custom default prompt',
      });
      const templates = await service.getPromptTemplates();
      expect(templates['defaults']!.systemPrompt).toBe('Custom default prompt');
    });

    it('updates prompt template for a role', async () => {
      const service = new ConfigService();
      await service.updatePromptTemplate('architect', {
        systemPrompt: 'Architect-specific prompt',
        providerPrompts: { 'claude-code': 'Claude arch prompt' },
      });
      const templates = await service.getPromptTemplates();
      expect(templates['architect']!.systemPrompt).toBe('Architect-specific prompt');
      expect(templates['architect']!.providerPrompts!['claude-code']).toBe('Claude arch prompt');
    });

    it('rejects forbidden key __proto__', async () => {
      const service = new ConfigService();
      await expect(
        service.updatePromptTemplate('__proto__', { systemPrompt: 'exploit' }),
      ).rejects.toThrow('Forbidden role name');
    });

    it('rejects forbidden key constructor', async () => {
      const service = new ConfigService();
      await expect(
        service.updatePromptTemplate('constructor', { systemPrompt: 'exploit' }),
      ).rejects.toThrow('Forbidden role name');
    });

    it('clears systemPrompt when empty string is sent', async () => {
      const service = new ConfigService();
      await service.updatePromptTemplate('tester', { systemPrompt: 'Test prompt' });
      let templates = await service.getPromptTemplates();
      expect(templates['tester']!.systemPrompt).toBe('Test prompt');

      await service.updatePromptTemplate('tester', { systemPrompt: '' });
      templates = await service.getPromptTemplates();
      expect(templates['tester']!.systemPrompt).toBeUndefined();
    });

    it('does not mutate internal state on returned config', async () => {
      const service = new ConfigService();
      const config1 = await service.getAgentsConfig();
      config1.defaults.providerChain.push({ provider: 'openai' });

      const config2 = await service.getAgentsConfig();
      expect(config2.defaults.providerChain).toHaveLength(1);
    });
  });
});
