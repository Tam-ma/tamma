import { randomUUID } from 'node:crypto';
import type { EngineEvent, EngineEventType, IEventStore } from './types/index.js';

export class InMemoryEventStore implements IEventStore {
  private events: EngineEvent[] = [];

  record(event: Omit<EngineEvent, 'id' | 'timestamp'>): EngineEvent {
    const full: EngineEvent = {
      ...event,
      id: randomUUID(),
      timestamp: Date.now(),
    };
    this.events.push(full);
    return full;
  }

  getEvents(issueNumber?: number): EngineEvent[] {
    if (issueNumber === undefined) {
      return [...this.events];
    }
    return this.events.filter((e) => e.issueNumber === issueNumber);
  }

  getLastEvent(type: EngineEventType): EngineEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i]!.type === type) {
        return this.events[i];
      }
    }
    return undefined;
  }

  clear(): void {
    this.events = [];
  }
}
