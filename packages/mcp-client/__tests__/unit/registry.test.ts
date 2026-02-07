/**
 * Registry unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry, ResourceRegistry, PromptRegistry } from '../../src/registry.js';
import { sampleTools, sampleResources } from '../mocks/fixtures.js';
import type { MCPTool, MCPResource, MCPPrompt } from '../../src/types.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a tool', () => {
      const tool = sampleTools[0]!;
      registry.register(tool);

      expect(registry.has(tool.serverName, tool.name)).toBe(true);
    });

    it('should register multiple tools', () => {
      registry.registerAll(sampleTools);

      expect(registry.count()).toBe(sampleTools.length);
    });

    it('should overwrite existing tool', () => {
      const tool1: MCPTool = {
        name: 'test',
        description: 'Original',
        inputSchema: { type: 'object' },
        serverName: 'server1',
      };

      const tool2: MCPTool = {
        name: 'test',
        description: 'Updated',
        inputSchema: { type: 'object' },
        serverName: 'server1',
      };

      registry.register(tool1);
      registry.register(tool2);

      const retrieved = registry.get('server1', 'test');
      expect(retrieved?.description).toBe('Updated');
    });
  });

  describe('unregister', () => {
    it('should unregister a tool', () => {
      const tool = sampleTools[0]!;
      registry.register(tool);

      const result = registry.unregister(tool.serverName, tool.name);

      expect(result).toBe(true);
      expect(registry.has(tool.serverName, tool.name)).toBe(false);
    });

    it('should return false for non-existent tool', () => {
      const result = registry.unregister('server', 'nonexistent');
      expect(result).toBe(false);
    });

    it('should unregister all tools from a server', () => {
      const tools: MCPTool[] = [
        { name: 'tool1', description: '', inputSchema: {}, serverName: 'server1' },
        { name: 'tool2', description: '', inputSchema: {}, serverName: 'server1' },
        { name: 'tool3', description: '', inputSchema: {}, serverName: 'server2' },
      ];

      registry.registerAll(tools);

      const count = registry.unregisterServer('server1');

      expect(count).toBe(2);
      expect(registry.count()).toBe(1);
      expect(registry.has('server2', 'tool3')).toBe(true);
    });
  });

  describe('get', () => {
    it('should retrieve a registered tool', () => {
      const tool = sampleTools[0]!;
      registry.register(tool);

      const retrieved = registry.get(tool.serverName, tool.name);

      expect(retrieved).toEqual(tool);
    });

    it('should return undefined for non-existent tool', () => {
      const retrieved = registry.get('server', 'nonexistent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getSchema', () => {
    it('should retrieve tool schema', () => {
      const tool = sampleTools[0]!;
      registry.register(tool);

      const schema = registry.getSchema(tool.serverName, tool.name);

      expect(schema).toEqual(tool.inputSchema);
    });

    it('should return undefined for non-existent tool', () => {
      const schema = registry.getSchema('server', 'nonexistent');
      expect(schema).toBeUndefined();
    });
  });

  describe('list', () => {
    beforeEach(() => {
      registry.registerAll(sampleTools);
    });

    it('should list all tools', () => {
      const tools = registry.list();
      expect(tools).toHaveLength(sampleTools.length);
    });

    it('should filter by server name', () => {
      const tools = registry.list({ serverName: 'test-server' });
      expect(tools.every((t) => t.serverName === 'test-server')).toBe(true);
    });

    it('should filter by name pattern', () => {
      const tools = registry.list({ namePattern: /^echo$/ });
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe('echo');
    });

    it('should filter by description pattern', () => {
      const tools = registry.list({ descriptionPattern: /arithmetic/i });
      expect(tools.every((t) => t.description.toLowerCase().includes('arithmetic'))).toBe(true);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      registry.registerAll(sampleTools);
    });

    it('should search by name', () => {
      const results = registry.search('echo');
      expect(results.some((t) => t.name === 'echo')).toBe(true);
    });

    it('should search by description', () => {
      const results = registry.search('content');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should be case-insensitive', () => {
      const results = registry.search('ECHO');
      expect(results.some((t) => t.name === 'echo')).toBe(true);
    });
  });

  describe('getServers', () => {
    it('should return unique server names', () => {
      const tools: MCPTool[] = [
        { name: 'tool1', description: '', inputSchema: {}, serverName: 'server1' },
        { name: 'tool2', description: '', inputSchema: {}, serverName: 'server1' },
        { name: 'tool3', description: '', inputSchema: {}, serverName: 'server2' },
      ];

      registry.registerAll(tools);

      const servers = registry.getServers();

      expect(servers).toHaveLength(2);
      expect(servers).toContain('server1');
      expect(servers).toContain('server2');
    });
  });

  describe('count', () => {
    it('should return total count', () => {
      registry.registerAll(sampleTools);
      expect(registry.count()).toBe(sampleTools.length);
    });

    it('should return count by server', () => {
      registry.registerAll(sampleTools);
      const count = registry.countByServer('test-server');
      expect(count).toBe(sampleTools.filter((t) => t.serverName === 'test-server').length);
    });
  });

  describe('clear', () => {
    it('should remove all tools', () => {
      registry.registerAll(sampleTools);
      registry.clear();
      expect(registry.count()).toBe(0);
    });
  });
});

describe('ResourceRegistry', () => {
  let registry: ResourceRegistry;

  beforeEach(() => {
    registry = new ResourceRegistry();
  });

  describe('register', () => {
    it('should register a resource', () => {
      const resource = sampleResources[0]!;
      registry.register(resource);

      expect(registry.has(resource.serverName, resource.uri)).toBe(true);
    });
  });

  describe('list', () => {
    beforeEach(() => {
      registry.registerAll(sampleResources);
    });

    it('should filter by server name', () => {
      const resources = registry.list({ serverName: 'test-server' });
      expect(resources.every((r) => r.serverName === 'test-server')).toBe(true);
    });

    it('should filter by URI pattern', () => {
      const resources = registry.list({ uriPattern: /\.md$/ });
      expect(resources.every((r) => r.uri.endsWith('.md'))).toBe(true);
    });

    it('should filter by MIME type', () => {
      const resources = registry.list({ mimeType: 'application/json' });
      expect(resources.every((r) => r.mimeType === 'application/json')).toBe(true);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      registry.registerAll(sampleResources);
    });

    it('should search by URI', () => {
      const results = registry.search('README');
      expect(results.some((r) => r.uri.includes('README'))).toBe(true);
    });

    it('should search by name', () => {
      const results = registry.search('package');
      expect(results.some((r) => r.name.includes('package'))).toBe(true);
    });
  });
});

describe('PromptRegistry', () => {
  let registry: PromptRegistry;

  beforeEach(() => {
    registry = new PromptRegistry();
  });

  describe('register', () => {
    it('should register a prompt', () => {
      const prompt: MCPPrompt = {
        name: 'greeting',
        description: 'Generate a greeting',
        arguments: [{ name: 'name', required: true }],
        serverName: 'test-server',
      };

      registry.register(prompt);

      expect(registry.has('test-server', 'greeting')).toBe(true);
    });
  });

  describe('list', () => {
    beforeEach(() => {
      const prompts: MCPPrompt[] = [
        { name: 'prompt1', serverName: 'server1' },
        { name: 'prompt2', serverName: 'server1' },
        { name: 'prompt3', serverName: 'server2' },
      ];
      registry.registerAll(prompts);
    });

    it('should filter by server name', () => {
      const prompts = registry.list({ serverName: 'server1' });
      expect(prompts).toHaveLength(2);
    });

    it('should filter by name pattern', () => {
      const prompts = registry.list({ namePattern: /prompt1/ });
      expect(prompts).toHaveLength(1);
    });
  });

  describe('unregisterServer', () => {
    it('should remove all prompts from a server', () => {
      const prompts: MCPPrompt[] = [
        { name: 'prompt1', serverName: 'server1' },
        { name: 'prompt2', serverName: 'server1' },
        { name: 'prompt3', serverName: 'server2' },
      ];
      registry.registerAll(prompts);

      const count = registry.unregisterServer('server1');

      expect(count).toBe(2);
      expect(registry.count()).toBe(1);
    });
  });
});
