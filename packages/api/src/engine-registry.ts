/**
 * Multi-Engine Registry
 *
 * Manages multiple TammaEngine instances, allowing the API server to run
 * several engines concurrently (e.g. one per repository or project).
 */

import type { TammaEngine, EngineStats } from '@tamma/orchestrator';
import type { EngineState } from '@tamma/shared';

export interface EngineInfo {
  id: string;
  state: EngineState;
  stats: EngineStats;
}

export class EngineRegistry {
  private engines = new Map<string, TammaEngine>();

  /**
   * Register an engine instance under the given identifier.
   * Throws if an engine with that id is already registered.
   */
  register(id: string, engine: TammaEngine): void {
    if (this.engines.has(id)) {
      throw new Error(`Engine with id "${id}" is already registered`);
    }
    this.engines.set(id, engine);
  }

  /**
   * Retrieve a registered engine by id.
   */
  get(id: string): TammaEngine | undefined {
    return this.engines.get(id);
  }

  /**
   * Return a summary of every registered engine.
   */
  list(): EngineInfo[] {
    const result: EngineInfo[] = [];
    for (const [id, engine] of this.engines) {
      result.push({
        id,
        state: engine.getState(),
        stats: engine.getStats(),
      });
    }
    return result;
  }

  /**
   * Dispose a single engine and remove it from the registry.
   */
  async dispose(id: string): Promise<void> {
    const engine = this.engines.get(id);
    if (engine === undefined) {
      return;
    }
    await engine.dispose();
    this.engines.delete(id);
  }

  /**
   * Dispose every registered engine and clear the registry.
   */
  async disposeAll(): Promise<void> {
    const ids = [...this.engines.keys()];
    await Promise.all(ids.map((id) => this.dispose(id)));
  }

  /**
   * Number of registered engines.
   */
  get size(): number {
    return this.engines.size;
  }
}
