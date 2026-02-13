import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  compareSemver,
  detectPlatform,
  upgradeCommand,
  fetchLatestVersion,
  type UpgradeOptions,
} from './upgrade.js';

// ── compareSemver ────────────────────────────────────────────────────

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns 0 when "v" prefix is present', () => {
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
  });

  it('returns 1 when a > b (major)', () => {
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
  });

  it('returns 1 when a > b (minor)', () => {
    expect(compareSemver('1.3.0', '1.2.9')).toBe(1);
  });

  it('returns 1 when a > b (patch)', () => {
    expect(compareSemver('1.2.4', '1.2.3')).toBe(1);
  });

  it('returns -1 when a < b', () => {
    expect(compareSemver('0.1.0', '0.2.0')).toBe(-1);
  });

  it('handles missing patch segment', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
  });
});

// ── detectPlatform ───────────────────────────────────────────────────

describe('detectPlatform', () => {
  it('returns a string matching the pattern os-arch', () => {
    const platform = detectPlatform();
    expect(platform).toMatch(/^(darwin|linux)-(arm64|x64)$/);
  });
});

// ── upgradeCommand ───────────────────────────────────────────────────

describe('upgradeCommand', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('skips upgrade when already on latest version', async () => {
    // Mock fetch to return the same version as current
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v0.1.0' }),
    }) as unknown as typeof fetch;

    // Mock getCurrentVersion via module — instead, pass through the logic:
    // The command calls getCurrentVersion internally. We need to ensure
    // it detects the matching version. We'll rely on package.json returning 0.1.0.
    await upgradeCommand({ version: undefined, force: false });

    // It should print "Already on version" message
    const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).toContain('Already on version');
  });

  it('proceeds with --force even when on latest', async () => {
    const fakeBinary = Buffer.alloc(64, 0xaa);
    const fakeHash = require('node:crypto')
      .createHash('sha256')
      .update(fakeBinary)
      .digest('hex');

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      const urlStr = typeof url === 'string' ? url : (url as URL).toString();
      if (urlStr.includes('/releases/latest')) {
        return {
          ok: true,
          json: async () => ({ tag_name: 'v0.1.0' }),
        };
      }
      if (urlStr.endsWith('.sha256')) {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from(`${fakeHash}  tamma-0.1.0-test\n`).buffer,
        };
      }
      // Binary download
      return {
        ok: true,
        arrayBuffer: async () => fakeBinary.buffer,
      };
    }) as unknown as typeof fetch;

    // This will fail at the file write stage (process.execPath is read-only),
    // but the important thing is it gets past the "already on latest" check.
    try {
      await upgradeCommand({ version: '0.1.0', force: true });
    } catch {
      // Expected — can't replace the real binary in tests
    }

    const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    // Should NOT contain "Already on version"
    expect(allOutput).not.toContain('Already on version');
    // Should start the download
    expect(allOutput).toContain('Downloading');
  });

  it('reports newer version when current is older', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      const urlStr = typeof url === 'string' ? url : (url as URL).toString();
      if (urlStr.includes('/releases/latest')) {
        return {
          ok: true,
          json: async () => ({ tag_name: 'v99.0.0' }),
        };
      }
      // Binary download will fail but that's fine — we test the version check path
      return { ok: false, status: 404, statusText: 'Not Found' };
    }) as unknown as typeof fetch;

    // Should attempt to download (and fail), proving it didn't skip
    await expect(
      upgradeCommand({ version: undefined, force: false }),
    ).rejects.toThrow('Download failed');
  });

  it('prevents downgrade without --force', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v0.0.1' }),
    }) as unknown as typeof fetch;

    await upgradeCommand({ version: '0.0.1', force: false });

    const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).toMatch(/newer than|Already on/);
  });
});

// ── fetchLatestVersion ───────────────────────────────────────────────

describe('fetchLatestVersion', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('extracts version from GitHub release response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v1.2.3' }),
    }) as unknown as typeof fetch;

    const version = await fetchLatestVersion();
    expect(version).toBe('1.2.3');
  });

  it('throws on non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    }) as unknown as typeof fetch;

    await expect(fetchLatestVersion()).rejects.toThrow('GitHub API returned 403');
  });
});
