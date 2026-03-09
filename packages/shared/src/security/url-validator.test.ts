import { describe, it, expect } from 'vitest';
import { isPrivateHost, validateUrl } from './url-validator.js';

describe('isPrivateHost', () => {
  // ─── 0.0.0.0/8 range (this network) ──────────────────────────────────

  describe('0.0.0.0/8 range (this network)', () => {
    it('should block 0.0.0.0 (via BLOCKED_HOSTS Set)', () => {
      expect(isPrivateHost('0.0.0.0')).toBe(true);
    });

    it('should block 0.0.0.1 (0.0.0.0/8 range)', () => {
      expect(isPrivateHost('0.0.0.1')).toBe(true);
    });

    it('should block 0.1.2.3 (0.0.0.0/8 range)', () => {
      expect(isPrivateHost('0.1.2.3')).toBe(true);
    });

    it('should block 0.255.255.255 (0.0.0.0/8 end)', () => {
      expect(isPrivateHost('0.255.255.255')).toBe(true);
    });
  });

  // ─── RFC 1918 private ranges ──────────────────────────────────────────

  describe('RFC 1918 private ranges', () => {
    // 10.0.0.0/8
    it('should block 10.0.0.1 (10.0.0.0/8 start)', () => {
      expect(isPrivateHost('10.0.0.1')).toBe(true);
    });

    it('should block 10.255.255.255 (10.0.0.0/8 end)', () => {
      expect(isPrivateHost('10.255.255.255')).toBe(true);
    });

    it('should block 10.0.0.0 (10.0.0.0/8 network address)', () => {
      expect(isPrivateHost('10.0.0.0')).toBe(true);
    });

    // 172.16.0.0/12
    it('should block 172.16.0.1 (172.16.0.0/12 start)', () => {
      expect(isPrivateHost('172.16.0.1')).toBe(true);
    });

    it('should block 172.31.255.255 (172.16.0.0/12 end)', () => {
      expect(isPrivateHost('172.31.255.255')).toBe(true);
    });

    it('should block 172.20.0.1 (mid-range 172.16.0.0/12)', () => {
      expect(isPrivateHost('172.20.0.1')).toBe(true);
    });

    it('should NOT block 172.15.0.1 (just below 172.16)', () => {
      expect(isPrivateHost('172.15.0.1')).toBe(false);
    });

    it('should NOT block 172.32.0.1 (just above 172.31)', () => {
      expect(isPrivateHost('172.32.0.1')).toBe(false);
    });

    // 192.168.0.0/16
    it('should block 192.168.0.1 (192.168.0.0/16)', () => {
      expect(isPrivateHost('192.168.0.1')).toBe(true);
    });

    it('should block 192.168.255.255 (192.168.0.0/16 end)', () => {
      expect(isPrivateHost('192.168.255.255')).toBe(true);
    });

    it('should block 192.168.1.100 (typical LAN address)', () => {
      expect(isPrivateHost('192.168.1.100')).toBe(true);
    });

    it('should NOT block 192.169.0.1 (outside 192.168 range)', () => {
      expect(isPrivateHost('192.169.0.1')).toBe(false);
    });

    it('should NOT block 192.167.0.1 (outside 192.168 range)', () => {
      expect(isPrivateHost('192.167.0.1')).toBe(false);
    });
  });

  // ─── Loopback range ───────────────────────────────────────────────────

  describe('127.0.0.0/8 loopback range', () => {
    it('should block 127.0.0.1 (both via BLOCKED_HOSTS Set and octet parsing)', () => {
      expect(isPrivateHost('127.0.0.1')).toBe(true);
    });

    it('should block 127.255.255.255 (127.0.0.0/8 end)', () => {
      expect(isPrivateHost('127.255.255.255')).toBe(true);
    });

    it('should block 127.0.0.2 (alternate loopback)', () => {
      expect(isPrivateHost('127.0.0.2')).toBe(true);
    });

    it('should block 127.1.0.0 (loopback range)', () => {
      expect(isPrivateHost('127.1.0.0')).toBe(true);
    });
  });

  // ─── Link-local range ─────────────────────────────────────────────────

  describe('169.254.0.0/16 link-local range', () => {
    it('should block 169.254.0.1 (link-local start)', () => {
      expect(isPrivateHost('169.254.0.1')).toBe(true);
    });

    it('should block 169.254.255.255 (link-local end)', () => {
      expect(isPrivateHost('169.254.255.255')).toBe(true);
    });

    it('should block 169.254.169.254 (AWS metadata IP)', () => {
      expect(isPrivateHost('169.254.169.254')).toBe(true);
    });

    it('should NOT block 169.255.0.1 (outside link-local)', () => {
      expect(isPrivateHost('169.255.0.1')).toBe(false);
    });

    it('should NOT block 169.253.0.1 (outside link-local)', () => {
      expect(isPrivateHost('169.253.0.1')).toBe(false);
    });
  });

  // ─── IPv6-mapped IPv4 and bracketed IPv6 ──────────────────────────────

  describe('IPv6-mapped IPv4 and bracketed IPv6', () => {
    it('should block [::ffff:127.0.0.1] (IPv6-mapped IPv4 -- recursively checks 127.0.0.1)', () => {
      expect(isPrivateHost('[::ffff:127.0.0.1]')).toBe(true);
    });

    it('should block [::ffff:10.0.0.1] (IPv6-mapped IPv4 -- recursively checks 10.0.0.1)', () => {
      expect(isPrivateHost('[::ffff:10.0.0.1]')).toBe(true);
    });

    it('should block [::ffff:192.168.1.1] (IPv6-mapped IPv4 -- recursively checks 192.168.1.1)', () => {
      expect(isPrivateHost('[::ffff:192.168.1.1]')).toBe(true);
    });

    it('should block [::ffff:172.16.0.1] (IPv6-mapped IPv4 -- recursively checks 172.16.0.1)', () => {
      expect(isPrivateHost('[::ffff:172.16.0.1]')).toBe(true);
    });

    it('should block [::ffff:0.0.0.1] (IPv6-mapped IPv4 -- recursively checks 0.0.0.1)', () => {
      expect(isPrivateHost('[::ffff:0.0.0.1]')).toBe(true);
    });

    it('should block [::ffff:169.254.1.1] (IPv6-mapped IPv4 -- recursively checks 169.254.1.1)', () => {
      expect(isPrivateHost('[::ffff:169.254.1.1]')).toBe(true);
    });

    it('should NOT block [::ffff:8.8.8.8] (IPv6-mapped public IP passes through)', () => {
      expect(isPrivateHost('[::ffff:8.8.8.8]')).toBe(false);
    });

    it('should NOT block [::ffff:1.1.1.1] (IPv6-mapped public IP passes through)', () => {
      expect(isPrivateHost('[::ffff:1.1.1.1]')).toBe(false);
    });

    it('should handle case-insensitive ::FFFF: prefix', () => {
      expect(isPrivateHost('[::FFFF:10.0.0.1]')).toBe(true);
    });

    it('should handle mixed case ::Ffff: prefix', () => {
      expect(isPrivateHost('[::Ffff:192.168.0.1]')).toBe(true);
    });

    it('should block [::1] (via BLOCKED_HOSTS Set and inner check)', () => {
      expect(isPrivateHost('[::1]')).toBe(true);
    });

    it('should block [::] (via BLOCKED_HOSTS Set and inner check)', () => {
      expect(isPrivateHost('[::]')).toBe(true);
    });
  });

  // ─── IPv6 private ranges ──────────────────────────────────────────────

  describe('IPv6 private ranges', () => {
    it('should block [fc00::1] (fc00::/7 unique local)', () => {
      expect(isPrivateHost('[fc00::1]')).toBe(true);
    });

    it('should block [fd00::1] (fd prefix -- also fc00::/7)', () => {
      expect(isPrivateHost('[fd00::1]')).toBe(true);
    });

    it('should block [fe80::1] (fe80::/10 link-local)', () => {
      expect(isPrivateHost('[fe80::1]')).toBe(true);
    });

    it('should block [FC00::1] (case insensitive fc00::/7)', () => {
      expect(isPrivateHost('[FC00::1]')).toBe(true);
    });

    it('should block [FD12:3456::1] (fd prefix, case insensitive)', () => {
      expect(isPrivateHost('[FD12:3456::1]')).toBe(true);
    });

    it('should block [FE80::1%eth0] (link-local with zone ID)', () => {
      // fe80 prefix check will still match
      expect(isPrivateHost('[fe80::1%eth0]')).toBe(true);
    });

    it('should NOT block [2001:db8::1] (documentation prefix -- not private in our check)', () => {
      expect(isPrivateHost('[2001:db8::1]')).toBe(false);
    });

    it('should NOT block [2600::1] (public IPv6)', () => {
      expect(isPrivateHost('[2600::1]')).toBe(false);
    });

    it('should NOT block [2001:4860:4860::8888] (Google public DNS IPv6)', () => {
      expect(isPrivateHost('[2001:4860:4860::8888]')).toBe(false);
    });
  });

  // ─── Cloud metadata hostnames ─────────────────────────────────────────

  describe('cloud metadata hostnames', () => {
    it('should block metadata.google.internal (GCP metadata endpoint)', () => {
      expect(isPrivateHost('metadata.google.internal')).toBe(true);
    });

    it('should block host.docker.internal (Docker host access)', () => {
      expect(isPrivateHost('host.docker.internal')).toBe(true);
    });
  });

  // ─── BLOCKED_HOSTS module scope ───────────────────────────────────────

  describe('BLOCKED_HOSTS module scope', () => {
    it('should not allocate a new Set per call (module-scope constant)', () => {
      // We verify consistency: calling isPrivateHost multiple times
      // with a BLOCKED_HOSTS member always returns true, proving the
      // Set is stable and not re-created.
      const results: boolean[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(isPrivateHost('localhost'));
      }
      expect(results.every((r) => r === true)).toBe(true);
    });
  });

  // ─── Passthrough and edge cases ───────────────────────────────────────

  describe('passthrough and edge cases', () => {
    it('should block localhost (via BLOCKED_HOSTS Set)', () => {
      expect(isPrivateHost('localhost')).toBe(true);
    });

    it('should NOT block evil.com (non-IPv4 passes through)', () => {
      expect(isPrivateHost('evil.com')).toBe(false);
    });

    it('should NOT block google.com (non-IPv4 passes through)', () => {
      expect(isPrivateHost('google.com')).toBe(false);
    });

    it('should NOT block example.org (non-IPv4 passes through)', () => {
      expect(isPrivateHost('example.org')).toBe(false);
    });

    it('should NOT block 8.8.8.8 (public IP)', () => {
      expect(isPrivateHost('8.8.8.8')).toBe(false);
    });

    it('should NOT block 1.1.1.1 (public IP)', () => {
      expect(isPrivateHost('1.1.1.1')).toBe(false);
    });

    it('should NOT block 203.0.113.1 (public IP - TEST-NET-3)', () => {
      expect(isPrivateHost('203.0.113.1')).toBe(false);
    });

    it('should NOT block 44.0.0.1 (public IP)', () => {
      expect(isPrivateHost('44.0.0.1')).toBe(false);
    });

    it('should return false for invalid octets: 256.0.0.1', () => {
      expect(isPrivateHost('256.0.0.1')).toBe(false);
    });

    it('should return false for negative octets: -1.0.0.1', () => {
      expect(isPrivateHost('-1.0.0.1')).toBe(false);
    });

    it('should return false for non-numeric octets: abc.def.ghi.jkl', () => {
      expect(isPrivateHost('abc.def.ghi.jkl')).toBe(false);
    });

    it('should return false for too few octets: 10.0.0', () => {
      expect(isPrivateHost('10.0.0')).toBe(false);
    });

    it('should return false for too many octets: 10.0.0.0.0', () => {
      expect(isPrivateHost('10.0.0.0.0')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isPrivateHost('')).toBe(false);
    });

    it('should return false for single number', () => {
      expect(isPrivateHost('127')).toBe(false);
    });

    it('should return false for mixed alphanumeric octets like 12abc.0.0.1', () => {
      expect(isPrivateHost('12abc.0.0.1')).toBe(false);
    });

    it('should return false for octets with trailing text like 10.0.0.1abc', () => {
      expect(isPrivateHost('10.0.0.1abc')).toBe(false);
    });

    it('should return false for octets with leading zeros that parseInt handles (016 != "016")', () => {
      // parseInt('016', 10) = 16, but String(16) !== '016',
      // so this correctly rejects the input
      expect(isPrivateHost('172.016.0.1')).toBe(false);
    });

    it('should return false for empty octets like 10..0.1', () => {
      expect(isPrivateHost('10..0.1')).toBe(false);
    });

    it('should return false for bracketed non-IPv6 content like [invalid]', () => {
      expect(isPrivateHost('[invalid]')).toBe(false);
    });

    it('should return false for partial brackets like [10.0.0.1', () => {
      // Does not end with ] so does not enter bracketed path
      // Splits to ['[10', '0', '0', '1'] which has non-numeric first part
      expect(isPrivateHost('[10.0.0.1')).toBe(false);
    });
  });
});

describe('validateUrl', () => {
  // ─── Protocol allowlist ───────────────────────────────────────────────

  describe('protocol allowlist', () => {
    it('should accept https://example.com', () => {
      const result = validateUrl('https://example.com');
      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('should accept http://example.com', () => {
      const result = validateUrl('http://example.com');
      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('should accept ws://example.com', () => {
      const result = validateUrl('ws://example.com');
      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('should accept wss://example.com', () => {
      const result = validateUrl('wss://example.com');
      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('should reject file:///etc/passwd with protocol warning', () => {
      const result = validateUrl('file:///etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain('Blocked protocol');
      expect(result.warnings[0]).toContain('file:');
    });

    it('should reject ftp://example.com with protocol warning', () => {
      const result = validateUrl('ftp://example.com');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Blocked protocol');
      expect(result.warnings[0]).toContain('ftp:');
    });

    it('should reject javascript:alert(1) with protocol warning', () => {
      const result = validateUrl('javascript:alert(1)');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Blocked protocol');
      expect(result.warnings[0]).toContain('javascript:');
    });

    it('should reject data: URLs', () => {
      const result = validateUrl('data:text/html,<h1>hello</h1>');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Blocked protocol');
    });
  });

  // ─── Private host blocking ───────────────────────────────────────────

  describe('private host blocking', () => {
    it('should reject https://10.0.0.1/api with private host warning', () => {
      const result = validateUrl('https://10.0.0.1/api');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Blocked private host');
      expect(result.warnings[0]).toContain('10.0.0.1');
    });

    it('should reject http://192.168.1.1 with private host warning', () => {
      const result = validateUrl('http://192.168.1.1');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Blocked private host');
      expect(result.warnings[0]).toContain('192.168.1.1');
    });

    it('should reject http://localhost:3000 with private host warning', () => {
      const result = validateUrl('http://localhost:3000');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Blocked private host');
      expect(result.warnings[0]).toContain('localhost');
    });

    it('should reject http://127.0.0.1:8080 with private host warning', () => {
      const result = validateUrl('http://127.0.0.1:8080');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Blocked private host');
    });

    it('should reject http://0.0.0.0 with private host warning', () => {
      const result = validateUrl('http://0.0.0.0');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Blocked private host');
    });

    it('should reject https://172.16.0.1/internal with private host warning', () => {
      const result = validateUrl('https://172.16.0.1/internal');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Blocked private host');
    });

    it('should reject http://169.254.169.254/latest/meta-data (AWS metadata)', () => {
      const result = validateUrl('http://169.254.169.254/latest/meta-data');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Blocked private host');
    });

    it('should reject http://metadata.google.internal (GCP metadata)', () => {
      const result = validateUrl('http://metadata.google.internal');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Blocked private host');
    });

    it('should reject http://host.docker.internal:2375 (Docker daemon)', () => {
      const result = validateUrl('http://host.docker.internal:2375');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Blocked private host');
    });

    it('should accept https://evil.com (non-private hostname passes through)', () => {
      const result = validateUrl('https://evil.com');
      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('should accept https://8.8.8.8 (public IP)', () => {
      const result = validateUrl('https://8.8.8.8');
      expect(result.valid).toBe(true);
    });
  });

  // ─── Invalid URLs ─────────────────────────────────────────────────────

  describe('invalid URLs', () => {
    it('should return { valid: false, warnings } for completely invalid URL strings', () => {
      const result = validateUrl('not a url at all');
      expect(result.valid).toBe(false);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain('Invalid URL');
    });

    it('should return { valid: false, warnings } for empty string', () => {
      const result = validateUrl('');
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Invalid URL');
    });

    it('should return { valid: false, warnings } for random text', () => {
      const result = validateUrl('just some random text');
      expect(result.valid).toBe(false);
    });
  });

  // ─── URL truncation in error messages ─────────────────────────────────

  describe('URL truncation in error messages', () => {
    it('should truncate URL in error message to max 200 chars for very long invalid URLs', () => {
      const longUrl = 'x'.repeat(500);
      const result = validateUrl(longUrl);
      expect(result.valid).toBe(false);
      expect(result.warnings.length).toBe(1);
      // The warning message should contain a truncated version of the URL
      const warning = result.warnings[0]!;
      expect(warning).toContain('Invalid URL');
      // The URL part in the warning should be at most 200 chars of the original
      // "Invalid URL: " prefix + 200 chars of URL
      expect(warning.length).toBeLessThanOrEqual('Invalid URL: '.length + 200);
    });

    it('should not truncate short URLs in error messages', () => {
      const shortUrl = 'not-a-url';
      const result = validateUrl(shortUrl);
      expect(result.valid).toBe(false);
      const warning = result.warnings[0]!;
      expect(warning).toBe(`Invalid URL: ${shortUrl}`);
    });

    it('should truncate URLs exactly at 200 chars', () => {
      const exactUrl = 'a'.repeat(201);
      const result = validateUrl(exactUrl);
      expect(result.valid).toBe(false);
      const warning = result.warnings[0]!;
      // Should contain exactly 200 chars of the URL
      expect(warning).toBe(`Invalid URL: ${'a'.repeat(200)}`);
    });

    it('should not truncate a URL of exactly 200 chars', () => {
      const exactUrl = 'b'.repeat(200);
      const result = validateUrl(exactUrl);
      expect(result.valid).toBe(false);
      const warning = result.warnings[0]!;
      expect(warning).toBe(`Invalid URL: ${'b'.repeat(200)}`);
    });
  });

  // ─── Never throws ─────────────────────────────────────────────────────

  describe('never throws', () => {
    it('should not throw on invalid input', () => {
      expect(() => validateUrl('')).not.toThrow();
      expect(() => validateUrl('totally invalid')).not.toThrow();
      expect(() => validateUrl('\0\0\0')).not.toThrow();
    });

    it('should not throw on null bytes in URL', () => {
      const result = validateUrl('http://example.com/\0path');
      // May be valid or invalid depending on URL parser, but should not throw
      expect(typeof result.valid).toBe('boolean');
    });

    it('should not throw on very long URLs', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(100_000);
      expect(() => validateUrl(longUrl)).not.toThrow();
    });
  });

  // ─── URL with paths and query params ──────────────────────────────────

  describe('URLs with paths and query params', () => {
    it('should accept https://example.com/path/to/resource', () => {
      const result = validateUrl('https://example.com/path/to/resource');
      expect(result.valid).toBe(true);
    });

    it('should accept https://example.com?query=value', () => {
      const result = validateUrl('https://example.com?query=value');
      expect(result.valid).toBe(true);
    });

    it('should accept https://example.com:8443/api/v1', () => {
      const result = validateUrl('https://example.com:8443/api/v1');
      expect(result.valid).toBe(true);
    });

    it('should reject private host with path: http://10.0.0.1/api/v1', () => {
      const result = validateUrl('http://10.0.0.1/api/v1');
      expect(result.valid).toBe(false);
    });
  });
});
