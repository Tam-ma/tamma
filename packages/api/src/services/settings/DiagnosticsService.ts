/**
 * Diagnostics Service
 *
 * Stores and queries recent diagnostics events for the settings UI.
 * Events are pushed in via recordEvent() (called by bridge wiring).
 */

import type { DiagnosticsEvent, DiagnosticsEventType } from '@tamma/shared';

const MAX_STORED_EVENTS = 500;

export class DiagnosticsService {
  private events: DiagnosticsEvent[] = [];

  /**
   * Record a diagnostics event. Keeps the most recent MAX_STORED_EVENTS.
   */
  recordEvent(event: DiagnosticsEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_STORED_EVENTS) {
      this.events = this.events.slice(-MAX_STORED_EVENTS);
    }
  }

  /**
   * Query diagnostics events with optional filters.
   */
  async getEvents(options?: {
    limit?: number;
    type?: DiagnosticsEventType;
    since?: number;
  }): Promise<DiagnosticsEvent[]> {
    let result = [...this.events];

    if (options?.type) {
      result = result.filter((e) => e.type === options.type);
    }

    if (options?.since) {
      result = result.filter((e) => e.timestamp >= options.since!);
    }

    // Most recent first
    result.sort((a, b) => b.timestamp - a.timestamp);

    const limit = options?.limit ?? 50;
    return result.slice(0, limit);
  }
}
