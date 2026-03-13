/**
 * DiagnosticsService Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { DiagnosticsService } from './DiagnosticsService.js';
import type { ProviderDiagnosticsEvent } from '@tamma/shared';

function makeEvent(overrides: Partial<ProviderDiagnosticsEvent> = {}): ProviderDiagnosticsEvent {
  return {
    type: 'provider:complete',
    timestamp: Date.now(),
    providerName: 'test-provider',
    ...overrides,
  };
}

describe('DiagnosticsService', () => {
  it('returns empty events initially', async () => {
    const service = new DiagnosticsService();
    const events = await service.getEvents();
    expect(events).toEqual([]);
  });

  it('records and retrieves events', async () => {
    const service = new DiagnosticsService();
    service.recordEvent(makeEvent({ timestamp: 1000 }));
    service.recordEvent(makeEvent({ timestamp: 2000 }));

    const events = await service.getEvents();
    expect(events).toHaveLength(2);
    // Most recent first
    expect(events[0]!.timestamp).toBe(2000);
    expect(events[1]!.timestamp).toBe(1000);
  });

  it('respects limit parameter', async () => {
    const service = new DiagnosticsService();
    for (let i = 0; i < 10; i++) {
      service.recordEvent(makeEvent({ timestamp: i }));
    }

    const events = await service.getEvents({ limit: 3 });
    expect(events).toHaveLength(3);
  });

  it('filters by type', async () => {
    const service = new DiagnosticsService();
    service.recordEvent(makeEvent({ type: 'provider:complete' }));
    service.recordEvent(makeEvent({ type: 'provider:error' }));
    service.recordEvent(makeEvent({ type: 'provider:complete' }));

    const events = await service.getEvents({ type: 'provider:error' });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('provider:error');
  });

  it('filters by since timestamp', async () => {
    const service = new DiagnosticsService();
    service.recordEvent(makeEvent({ timestamp: 1000 }));
    service.recordEvent(makeEvent({ timestamp: 2000 }));
    service.recordEvent(makeEvent({ timestamp: 3000 }));

    const events = await service.getEvents({ since: 2000 });
    expect(events).toHaveLength(2);
  });

  it('caps stored events at 500', async () => {
    const service = new DiagnosticsService();
    for (let i = 0; i < 550; i++) {
      service.recordEvent(makeEvent({ timestamp: i }));
    }

    const events = await service.getEvents({ limit: 600 });
    expect(events).toHaveLength(500);
  });

  it('returns events in reverse chronological order after cap', async () => {
    const service = new DiagnosticsService();
    for (let i = 0; i < 510; i++) {
      service.recordEvent(makeEvent({ timestamp: i }));
    }

    const events = await service.getEvents({ limit: 5 });
    // Most recent events should be kept (highest timestamps)
    expect(events[0]!.timestamp).toBe(509);
    expect(events[1]!.timestamp).toBe(508);
  });
});
