import { describe, expect, it } from 'vitest';
import { parseRequestPayload } from './request.server';

describe('parseRequestPayload', () => {
  it('parses JSON bodies', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foo: 'bar', count: 2 }),
    });

    const payload = await parseRequestPayload(request);
    expect(payload).toEqual({ foo: 'bar', count: 2 });
  });

  it('parses form bodies', async () => {
    const body = new URLSearchParams({ foo: 'bar', count: '3' });
    const request = new Request('http://localhost/form', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    const payload = await parseRequestPayload(request);
    expect(payload).toEqual({ foo: 'bar', count: '3' });
  });
});
