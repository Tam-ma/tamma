import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from './client';
import { getConversation, listConversations } from './chat';

describe('api/chat', () => {
  it('calls GET /api/chat/conversations with optional limit', async () => {
    const client = new ApiClient({ baseUrl: '' });
    const spy = vi.spyOn(client, 'get').mockResolvedValueOnce({ items: [], count: 0 });

    const res = await listConversations(25, client);

    expect(spy).toHaveBeenCalledWith('/api/chat/conversations?limit=25');
    expect(res.items).toEqual([]);
  });

  it('calls GET /api/chat/conversations/{id} with cursor and limit', async () => {
    const client = new ApiClient({ baseUrl: '' });
    const spy = vi.spyOn(client, 'get').mockResolvedValueOnce({
      conversationId: 'conv-1',
      messages: [],
      nextCursor: null,
      hasMore: false,
    });

    const page = await getConversation('conv-1', { cursor: 42, limit: 50 }, client);

    expect(spy).toHaveBeenCalledWith('/api/chat/conversations/conv-1?cursor=42&limit=50');
    expect(page.conversationId).toBe('conv-1');
  });
});
