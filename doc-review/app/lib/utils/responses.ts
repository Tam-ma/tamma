export function jsonResponse(data: unknown, init?: number | ResponseInit): Response {
  const body = JSON.stringify(data);

  if (typeof init === 'number') {
    return new Response(body, {
      status: init,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return new Response(body, {
    ...init,
    headers,
  });
}
