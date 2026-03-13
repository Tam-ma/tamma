/**
 * Health Service
 *
 * Wraps ProviderHealthTracker to expose health status via API.
 */

import type { IProviderHealthTracker, HealthStatusEntry } from '@tamma/providers';

export class HealthService {
  private tracker: IProviderHealthTracker | null;

  constructor(tracker?: IProviderHealthTracker) {
    this.tracker = tracker ?? null;
  }

  async getStatus(): Promise<Record<string, HealthStatusEntry>> {
    if (!this.tracker) {
      return {};
    }
    return this.tracker.getStatus();
  }

  setTracker(tracker: IProviderHealthTracker): void {
    this.tracker = tracker;
  }
}
