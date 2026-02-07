import type { ContextSourceType, SourceQuery, ContextChunk } from '../types.js';
import { BaseContextSource } from './base-source.js';

/**
 * Minimal subset of IMCPClient needed by the MCPSource adapter.
 * Using a local interface avoids a hard build dependency on @tamma/mcp-client.
 */
export interface IMCPClientLike {
  listServers(): Array<{ name: string; status: string }>;
  listResources(serverName?: string): Array<{ uri: string; name: string; description?: string }>;
  readResource(serverName: string, uri: string): Promise<{ uri: string; text?: string }>;
}

export class MCPSource extends BaseContextSource {
  readonly name: ContextSourceType = 'mcp';
  private mcpClient: IMCPClientLike;

  constructor(mcpClient: IMCPClientLike) {
    super();
    this.mcpClient = mcpClient;
  }

  protected async doRetrieve(query: SourceQuery): Promise<ContextChunk[]> {
    const chunks: ContextChunk[] = [];
    const servers = this.mcpClient.listServers();

    for (const server of servers) {
      if (server.status !== 'connected') continue;

      try {
        const resources = this.mcpClient.listResources(server.name);
        for (const resource of resources.slice(0, query.maxChunks)) {
          try {
            const content = await this.mcpClient.readResource(server.name, resource.uri);
            if (content.text) {
              chunks.push({
                id: `mcp-${server.name}-${resource.uri}`,
                content: content.text,
                source: 'mcp',
                relevance: 0.5,
                metadata: {
                  url: resource.uri,
                  title: resource.name,
                },
              });
            }
          } catch {
            // Skip failed resources
          }
        }
      } catch {
        // Skip failed servers
      }
    }

    return chunks.slice(0, query.maxChunks);
  }
}

export function createMCPSource(mcpClient: IMCPClientLike): MCPSource {
  return new MCPSource(mcpClient);
}
