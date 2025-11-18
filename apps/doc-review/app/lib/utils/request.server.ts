export async function parseRequestPayload(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => ({}));
    return normalizeRecord(body);
  }

  const formData = await request.formData();
  const record: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      record[key] = value;
    } else {
      record[key] = value.name;
    }
  }

  return record;
}

function normalizeRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  return payload as Record<string, unknown>;
}
