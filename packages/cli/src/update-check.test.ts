import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkForUpdates, compareSemver, stateFilePath } from './update-check.js';
import * as fs from 'node:fs';

vi.mock('node:fs');

// ── compareSemver ────────────────────────────────────────────────────

describe('compareSemver (update-check)', () => {
  it('returns 0 for equal', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('returns 1 when first is greater', () => {
    expect(compareSemver('2.0.0', '1.0.0')).toBe(1);
  });

  it('returns -1 when first is smaller', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
  });

  it('strips v prefix', () => {
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
  });
});

// ── stateFilePath ────────────────────────────────────────────────────

describe('stateFilePath', () => {
  it('returns a path under ~/.local/state/tamma/', () => {
    const p = stateFilePath();
    expect(p).toContain('.local');
    expect(p).toContain('state');
    expect(p).toContain('tamma');
    expect(p).toContain('update-check.json');
  });
});

// ── checkForUpdates ──────────────────────────────────────────────────

describe('checkForUpdates', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns null when cached version matches current (within cooldown)', async () => {
    const state = JSON.stringify({
      lastCheck: Date.now(), // within 24h window
      latestVersion: '1.0.0',
    });
    vi.mocked(fs.readFileSync).mockReturnValue(state);

    const result = await checkForUpdates('1.0.0');
    expect(result).toBeNull();
  });

  it('returns update message when cached version is newer (within cooldown)', async () => {
    const state = JSON.stringify({
      lastCheck: Date.now(),
      latestVersion: '2.0.0',
    });
    vi.mocked(fs.readFileSync).mockReturnValue(state);

    const result = await checkForUpdates('1.0.0');
    expect(result).toContain('Update available');
    expect(result).toContain('1.0.0');
    expect(result).toContain('2.0.0');
    expect(result).toContain('tamma upgrade');
  });

  it('fetches from GitHub when cache is stale', async () => {
    const staleState = JSON.stringify({
      lastCheck: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      latestVersion: '1.0.0',
    });
    vi.mocked(fs.readFileSync).mockReturnValue(staleState);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => '' as any);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v3.0.0' }),
    }) as unknown as typeof fetch;

    const result = await checkForUpdates('1.0.0');
    expect(result).toContain('Update available');
    expect(result).toContain('3.0.0');
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('fetches from GitHub when no cache exists', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => '' as any);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v2.0.0' }),
    }) as unknown as typeof fetch;

    const result = await checkForUpdates('1.0.0');
    expect(result).toContain('Update available');
    expect(result).toContain('2.0.0');
  });

  it('returns null when fetch returns same version', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => '' as any);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v1.0.0' }),
    }) as unknown as typeof fetch;

    const result = await checkForUpdates('1.0.0');
    expect(result).toBeNull();
  });

  it('never throws on network error', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await checkForUpdates('1.0.0');
    expect(result).toBeNull();
  });

  it('never throws on fetch non-OK response', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as unknown as typeof fetch;

    const result = await checkForUpdates('1.0.0');
    expect(result).toBeNull();
  });

  it('never throws on corrupt cache', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('not valid json!!!');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v1.0.0' }),
    }) as unknown as typeof fetch;
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => '' as any);

    const result = await checkForUpdates('1.0.0');
    // Should not throw — may return null or a message depending on fetch
    expect(result).toBeNull();
  });

  it('never throws when writeFileSync fails', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    vi.mocked(fs.mkdirSync).mockImplementation(() => {
      throw new Error('EACCES');
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('EACCES');
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v2.0.0' }),
    }) as unknown as typeof fetch;

    // Should not throw, and should still return update message
    const result = await checkForUpdates('1.0.0');
    expect(result).toContain('Update available');
  });
});
