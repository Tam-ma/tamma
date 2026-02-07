/**
 * @tamma/mcp-client
 * Tool and Resource registry
 */

import type { MCPTool, MCPResource, MCPPrompt, JSONSchema } from './types.js';

/**
 * Tool filter options
 */
export interface ToolFilterOptions {
  /** Filter by server name */
  serverName?: string;
  /** Filter by name pattern (regex) */
  namePattern?: RegExp;
  /** Filter by description pattern (regex) */
  descriptionPattern?: RegExp;
}

/**
 * Resource filter options
 */
export interface ResourceFilterOptions {
  /** Filter by server name */
  serverName?: string;
  /** Filter by URI pattern (regex) */
  uriPattern?: RegExp;
  /** Filter by MIME type */
  mimeType?: string;
}

/**
 * Prompt filter options
 */
export interface PromptFilterOptions {
  /** Filter by server name */
  serverName?: string;
  /** Filter by name pattern (regex) */
  namePattern?: RegExp;
}

/**
 * Tool registry for managing discovered tools from MCP servers
 */
export class ToolRegistry {
  private readonly tools = new Map<string, MCPTool>();

  /**
   * Get the key for a tool
   */
  private getKey(serverName: string, toolName: string): string {
    return `${serverName}:${toolName}`;
  }

  /**
   * Register a tool
   */
  register(tool: MCPTool): void {
    const key = this.getKey(tool.serverName, tool.name);
    this.tools.set(key, tool);
  }

  /**
   * Register multiple tools
   */
  registerAll(tools: MCPTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Unregister a tool
   */
  unregister(serverName: string, toolName: string): boolean {
    const key = this.getKey(serverName, toolName);
    return this.tools.delete(key);
  }

  /**
   * Unregister all tools from a server
   */
  unregisterServer(serverName: string): number {
    let count = 0;
    for (const [key, tool] of this.tools) {
      if (tool.serverName === serverName) {
        this.tools.delete(key);
        count += 1;
      }
    }
    return count;
  }

  /**
   * Get a tool by server and name
   */
  get(serverName: string, toolName: string): MCPTool | undefined {
    const key = this.getKey(serverName, toolName);
    return this.tools.get(key);
  }

  /**
   * Get a tool's input schema
   */
  getSchema(serverName: string, toolName: string): JSONSchema | undefined {
    return this.get(serverName, toolName)?.inputSchema;
  }

  /**
   * Check if a tool exists
   */
  has(serverName: string, toolName: string): boolean {
    const key = this.getKey(serverName, toolName);
    return this.tools.has(key);
  }

  /**
   * List all tools, optionally filtered
   */
  list(filter?: ToolFilterOptions): MCPTool[] {
    const tools = Array.from(this.tools.values());

    if (!filter) {
      return tools;
    }

    return tools.filter((tool) => {
      if (filter.serverName && tool.serverName !== filter.serverName) {
        return false;
      }

      if (filter.namePattern && !filter.namePattern.test(tool.name)) {
        return false;
      }

      if (filter.descriptionPattern && !filter.descriptionPattern.test(tool.description)) {
        return false;
      }

      return true;
    });
  }

  /**
   * List tools by server
   */
  listByServer(serverName: string): MCPTool[] {
    return this.list({ serverName });
  }

  /**
   * Search tools by name or description
   */
  search(query: string): MCPTool[] {
    const queryLower = query.toLowerCase();

    return Array.from(this.tools.values()).filter(
      (tool) =>
        tool.name.toLowerCase().includes(queryLower) ||
        tool.description.toLowerCase().includes(queryLower)
    );
  }

  /**
   * Get all server names that have tools
   */
  getServers(): string[] {
    const servers = new Set<string>();
    for (const tool of this.tools.values()) {
      servers.add(tool.serverName);
    }
    return Array.from(servers);
  }

  /**
   * Get total tool count
   */
  count(): number {
    return this.tools.size;
  }

  /**
   * Get tool count by server
   */
  countByServer(serverName: string): number {
    return this.listByServer(serverName).length;
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }
}

/**
 * Resource registry for managing discovered resources from MCP servers
 */
export class ResourceRegistry {
  private readonly resources = new Map<string, MCPResource>();

  /**
   * Get the key for a resource
   */
  private getKey(serverName: string, uri: string): string {
    return `${serverName}:${uri}`;
  }

  /**
   * Register a resource
   */
  register(resource: MCPResource): void {
    const key = this.getKey(resource.serverName, resource.uri);
    this.resources.set(key, resource);
  }

  /**
   * Register multiple resources
   */
  registerAll(resources: MCPResource[]): void {
    for (const resource of resources) {
      this.register(resource);
    }
  }

  /**
   * Unregister a resource
   */
  unregister(serverName: string, uri: string): boolean {
    const key = this.getKey(serverName, uri);
    return this.resources.delete(key);
  }

  /**
   * Unregister all resources from a server
   */
  unregisterServer(serverName: string): number {
    let count = 0;
    for (const [key, resource] of this.resources) {
      if (resource.serverName === serverName) {
        this.resources.delete(key);
        count += 1;
      }
    }
    return count;
  }

  /**
   * Get a resource by server and URI
   */
  get(serverName: string, uri: string): MCPResource | undefined {
    const key = this.getKey(serverName, uri);
    return this.resources.get(key);
  }

  /**
   * Check if a resource exists
   */
  has(serverName: string, uri: string): boolean {
    const key = this.getKey(serverName, uri);
    return this.resources.has(key);
  }

  /**
   * List all resources, optionally filtered
   */
  list(filter?: ResourceFilterOptions): MCPResource[] {
    const resources = Array.from(this.resources.values());

    if (!filter) {
      return resources;
    }

    return resources.filter((resource) => {
      if (filter.serverName && resource.serverName !== filter.serverName) {
        return false;
      }

      if (filter.uriPattern && !filter.uriPattern.test(resource.uri)) {
        return false;
      }

      if (filter.mimeType && resource.mimeType !== filter.mimeType) {
        return false;
      }

      return true;
    });
  }

  /**
   * List resources by server
   */
  listByServer(serverName: string): MCPResource[] {
    return this.list({ serverName });
  }

  /**
   * Search resources by URI or description
   */
  search(query: string): MCPResource[] {
    const queryLower = query.toLowerCase();

    return Array.from(this.resources.values()).filter(
      (resource) =>
        resource.uri.toLowerCase().includes(queryLower) ||
        resource.name.toLowerCase().includes(queryLower) ||
        (resource.description?.toLowerCase().includes(queryLower) ?? false)
    );
  }

  /**
   * Get all server names that have resources
   */
  getServers(): string[] {
    const servers = new Set<string>();
    for (const resource of this.resources.values()) {
      servers.add(resource.serverName);
    }
    return Array.from(servers);
  }

  /**
   * Get total resource count
   */
  count(): number {
    return this.resources.size;
  }

  /**
   * Get resource count by server
   */
  countByServer(serverName: string): number {
    return this.listByServer(serverName).length;
  }

  /**
   * Clear all resources
   */
  clear(): void {
    this.resources.clear();
  }
}

/**
 * Prompt registry for managing discovered prompts from MCP servers
 */
export class PromptRegistry {
  private readonly prompts = new Map<string, MCPPrompt>();

  /**
   * Get the key for a prompt
   */
  private getKey(serverName: string, promptName: string): string {
    return `${serverName}:${promptName}`;
  }

  /**
   * Register a prompt
   */
  register(prompt: MCPPrompt): void {
    const key = this.getKey(prompt.serverName, prompt.name);
    this.prompts.set(key, prompt);
  }

  /**
   * Register multiple prompts
   */
  registerAll(prompts: MCPPrompt[]): void {
    for (const prompt of prompts) {
      this.register(prompt);
    }
  }

  /**
   * Unregister a prompt
   */
  unregister(serverName: string, promptName: string): boolean {
    const key = this.getKey(serverName, promptName);
    return this.prompts.delete(key);
  }

  /**
   * Unregister all prompts from a server
   */
  unregisterServer(serverName: string): number {
    let count = 0;
    for (const [key, prompt] of this.prompts) {
      if (prompt.serverName === serverName) {
        this.prompts.delete(key);
        count += 1;
      }
    }
    return count;
  }

  /**
   * Get a prompt by server and name
   */
  get(serverName: string, promptName: string): MCPPrompt | undefined {
    const key = this.getKey(serverName, promptName);
    return this.prompts.get(key);
  }

  /**
   * Check if a prompt exists
   */
  has(serverName: string, promptName: string): boolean {
    const key = this.getKey(serverName, promptName);
    return this.prompts.has(key);
  }

  /**
   * List all prompts, optionally filtered
   */
  list(filter?: PromptFilterOptions): MCPPrompt[] {
    const prompts = Array.from(this.prompts.values());

    if (!filter) {
      return prompts;
    }

    return prompts.filter((prompt) => {
      if (filter.serverName && prompt.serverName !== filter.serverName) {
        return false;
      }

      if (filter.namePattern && !filter.namePattern.test(prompt.name)) {
        return false;
      }

      return true;
    });
  }

  /**
   * List prompts by server
   */
  listByServer(serverName: string): MCPPrompt[] {
    return this.list({ serverName });
  }

  /**
   * Get total prompt count
   */
  count(): number {
    return this.prompts.size;
  }

  /**
   * Clear all prompts
   */
  clear(): void {
    this.prompts.clear();
  }
}
