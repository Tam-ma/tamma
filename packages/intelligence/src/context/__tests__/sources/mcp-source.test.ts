import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MCPSource, createMCPSource } from '../../sources/mcp-source.js';
import type { IMCPClientLike } from '../../sources/mcp-source.js';
import type { SourceQuery } from '../../types.js';

describe('MCPSource', () => {
  let source: MCPSource;
  let mockClient: IMCPClientLike;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      listServers: vi.fn().mockReturnValue([
        { name: 'server-1', status: 'connected' },
      ]),
      listResources: vi.fn().mockReturnValue([
        { uri: 'file:///src/index.ts', name: 'index.ts' },
      ]),
      readResource: vi.fn().mockResolvedValue({
        uri: 'file:///src/index.ts',
        text: 'export function main() {}',
      }),
    };
    source = createMCPSource(mockClient);
  });

  it('should have name mcp', () => {
    expect(source.name).toBe('mcp');
  });

  it('should retrieve resources from connected servers', async () => {
    const query: SourceQuery = { text: 'test', maxChunks: 10, maxTokens: 2000 };
    const result = await source.retrieve(query);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].source).toBe('mcp');
    expect(result.chunks[0].content).toContain('export function');
    expect(result.chunks[0].metadata.url).toBe('file:///src/index.ts');
  });

  it('should skip disconnected servers', async () => {
    (mockClient.listServers as any).mockReturnValue([
      { name: 's1', status: 'disconnected' },
    ]);
    const query: SourceQuery = { text: 'test', maxChunks: 10, maxTokens: 2000 };
    const result = await source.retrieve(query);
    expect(result.chunks).toHaveLength(0);
  });

  it('should handle resource read errors', async () => {
    (mockClient.readResource as any).mockRejectedValue(new Error('failed'));
    const query: SourceQuery = { text: 'test', maxChunks: 10, maxTokens: 2000 };
    const result = await source.retrieve(query);
    expect(result.chunks).toHaveLength(0);
  });

  it('should respect maxChunks limit', async () => {
    (mockClient.listResources as any).mockReturnValue([
      { uri: 'a', name: 'a' },
      { uri: 'b', name: 'b' },
      { uri: 'c', name: 'c' },
    ]);
    (mockClient.readResource as any).mockResolvedValue({ uri: 't', text: 'text' });

    const query: SourceQuery = { text: 'test', maxChunks: 2, maxTokens: 2000 };
    const result = await source.retrieve(query);
    expect(result.chunks.length).toBeLessThanOrEqual(2);
  });
});
