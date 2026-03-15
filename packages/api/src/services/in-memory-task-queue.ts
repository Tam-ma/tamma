/**
 * In-Memory Task Queue
 *
 * FIFO task queue implementation backed by a Map.
 * Supports multi-tenant filtering via installationId.
 *
 * Tasks are dequeued in creation order within each installation partition.
 * When no installationId filter is provided, dequeue follows global FIFO order.
 *
 * This implementation is suitable for development and testing.
 * Production deployments should use a PostgreSQL-backed implementation.
 */

import { randomUUID } from 'node:crypto';
import type {
  ITask,
  ITaskQueue,
  EnqueueTaskInput,
  DequeueOptions,
  ListTasksOptions,
} from './task-queue.js';

export interface InMemoryTaskQueueOptions {
  /**
   * When true, reject tasks without installationId at enqueue time (SaaS mode).
   * Defaults to false for backward compatibility with self-hosted mode.
   */
  requireInstallationId?: boolean;
}

export class InMemoryTaskQueue implements ITaskQueue {
  private tasks = new Map<string, ITask>();
  private readonly requireInstallationId: boolean;

  constructor(options?: InMemoryTaskQueueOptions) {
    this.requireInstallationId = options?.requireInstallationId ?? false;
  }

  async enqueue(input: EnqueueTaskInput): Promise<ITask> {
    // SaaS mode: reject tasks without installationId
    if (this.requireInstallationId && !input.installationId) {
      throw new Error('installationId is required in SaaS mode');
    }

    const now = new Date().toISOString();
    const task: ITask = {
      id: randomUUID(),
      type: input.type,
      installationId: input.installationId ?? null,
      payload: { ...input.payload },
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.id, task);
    return { ...task, payload: structuredClone(task.payload) };
  }

  async dequeue(options?: DequeueOptions): Promise<ITask | null> {
    // Iterate in insertion order (Map guarantees this) to maintain FIFO
    for (const [, task] of this.tasks) {
      if (task.status !== 'pending') continue;

      // Filter by installationId if requested
      if (options?.installationId !== undefined) {
        // Strict tenant isolation: only dequeue tasks matching the requested installationId
        if (task.installationId !== options.installationId) continue;
      }

      // Atomically move to 'processing'
      task.status = 'processing';
      task.updatedAt = new Date().toISOString();
      return { ...task, payload: structuredClone(task.payload) };
    }

    return null;
  }

  async complete(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    task.status = 'completed';
    task.updatedAt = new Date().toISOString();
  }

  async fail(taskId: string, error: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    task.status = 'failed';
    task.error = error;
    task.updatedAt = new Date().toISOString();
  }

  async list(options?: ListTasksOptions): Promise<ITask[]> {
    const result: ITask[] = [];

    for (const [, task] of this.tasks) {
      // Filter by installationId
      if (options?.installationId !== undefined && task.installationId !== options.installationId) {
        continue;
      }
      // Filter by status
      if (options?.status !== undefined && task.status !== options.status) {
        continue;
      }
      result.push({ ...task, payload: structuredClone(task.payload) });
    }

    return result;
  }

  /** Clear all tasks. Useful for testing. */
  clear(): void {
    this.tasks.clear();
  }

  /** Get the count of tasks in the queue. */
  get size(): number {
    return this.tasks.size;
  }
}
