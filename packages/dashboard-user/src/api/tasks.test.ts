import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from './client';
import { getTask, listTasks, submitTaskDecision } from './tasks';

describe('api/tasks', () => {
  it('lists pending tasks via GET /api/tasks and supports includeCompleted', async () => {
    const client = new ApiClient({ baseUrl: '' });
    const spy = vi.spyOn(client, 'get').mockResolvedValue({ items: [], count: 0 });

    await listTasks(false, client);
    expect(spy).toHaveBeenNthCalledWith(1, '/api/tasks');

    await listTasks(true, client);
    expect(spy).toHaveBeenNthCalledWith(2, '/api/tasks?includeCompleted=true');
  });

  it('fetches single task detail via GET /api/tasks/{sessionId}', async () => {
    const client = new ApiClient({ baseUrl: '' });
    const spy = vi.spyOn(client, 'get').mockResolvedValueOnce({ sessionId: 's-1' });

    await getTask('s-1', client);
    expect(spy).toHaveBeenCalledWith('/api/tasks/s-1');
  });

  it('posts task decisions directly to Story 39-8 resume endpoint', async () => {
    const client = new ApiClient({ baseUrl: '' });
    const spy = vi.spyOn(client, 'post').mockResolvedValueOnce({
      resumed: true,
      kind: 'accept',
      channel: 'user',
    });

    const res = await submitTaskDecision('sess-9', { kind: 'accept', feedback: 'LGTM' }, client);

    expect(spy).toHaveBeenCalledWith('/api/documents/decisions/sess-9/resume', {
      kind: 'accept',
      feedback: 'LGTM',
    });
    expect(res.resumed).toBe(true);
  });
});
