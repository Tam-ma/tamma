// @vitest-environment jsdom
import { trackerApi, TrackerApiError } from '../tracker-api-client.js';

describe('tracker-api-client (Story 44-6 Test 15 / AC8 / D3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses credentials: include and defaults API_BASE to /api', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null, visibilityMode: 'tenant' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await trackerApi.listWorkItems({ projectId: 'proj-1', cursor: 'cur-2' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/work-items?projectId=proj-1&cursor=cur-2');
    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('sends quoted If-Match header and preserves HTTP status on 409 conflict', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Version conflict',
          code: 'TRACKER.CONCURRENCY_CONFLICT',
          retryable: true,
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(trackerApi.setStatus('item-1', 'in_progress', 3)).rejects.toMatchObject({
      name: 'TrackerApiError',
      status: 409,
      code: 'TRACKER.CONCURRENCY_CONFLICT',
      retryable: true,
    } satisfies Partial<TrackerApiError>);

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.spyOn>).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)['If-Match']).toBe('"3"');
  });
});
