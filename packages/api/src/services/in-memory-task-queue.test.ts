/**
 * In-Memory Task Queue Tests
 *
 * Tests for the InMemoryTaskQueue covering:
 * - enqueue/dequeue basic functionality
 * - installationId filtering and tenant isolation
 * - null installationId backward compatibility (self-hosted mode)
 * - concurrent installations with strict isolation
 * - complete/fail lifecycle
 * - SaaS mode enforcement
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTaskQueue } from './in-memory-task-queue.js';
import type { ITask } from './task-queue.js';

describe('InMemoryTaskQueue', () => {
  let queue: InMemoryTaskQueue;

  beforeEach(() => {
    queue = new InMemoryTaskQueue();
  });

  // -------------------------------------------------------------------------
  // enqueue
  // -------------------------------------------------------------------------

  describe('enqueue', () => {
    it('creates a task with generated id, pending status, and timestamps', async () => {
      const task = await queue.enqueue({
        type: 'github.issues.opened',
        installationId: 1001,
        payload: { issue: 42 },
      });

      expect(task.id).toBeDefined();
      expect(task.id.length).toBeGreaterThan(0);
      expect(task.type).toBe('github.issues.opened');
      expect(task.installationId).toBe(1001);
      expect(task.payload).toEqual({ issue: 42 });
      expect(task.status).toBe('pending');
      expect(task.createdAt).toBeDefined();
      expect(task.updatedAt).toBeDefined();
    });

    it('allows null installationId for self-hosted mode', async () => {
      const task = await queue.enqueue({
        type: 'github.push.unknown',
        payload: { ref: 'refs/heads/main' },
      });

      expect(task.installationId).toBeNull();
      expect(task.status).toBe('pending');
    });

    it('generates unique ids for each task', async () => {
      const task1 = await queue.enqueue({ type: 'a', payload: {} });
      const task2 = await queue.enqueue({ type: 'b', payload: {} });
      expect(task1.id).not.toBe(task2.id);
    });

    it('returns a copy (mutations do not affect queue)', async () => {
      const task = await queue.enqueue({ type: 'test', payload: { key: 'value' } });
      task.status = 'completed';

      const listed = await queue.list();
      expect(listed[0]!.status).toBe('pending');
    });
  });

  // -------------------------------------------------------------------------
  // dequeue
  // -------------------------------------------------------------------------

  describe('dequeue', () => {
    it('returns the oldest pending task (FIFO)', async () => {
      await queue.enqueue({ type: 'first', payload: {} });
      await queue.enqueue({ type: 'second', payload: {} });

      const task = await queue.dequeue();

      expect(task).not.toBeNull();
      expect(task!.type).toBe('first');
      expect(task!.status).toBe('processing');
    });

    it('returns null when the queue is empty', async () => {
      const task = await queue.dequeue();
      expect(task).toBeNull();
    });

    it('returns null when all tasks are already processing', async () => {
      await queue.enqueue({ type: 'test', payload: {} });
      await queue.dequeue(); // moves to processing

      const task = await queue.dequeue();
      expect(task).toBeNull();
    });

    it('skips completed and failed tasks', async () => {
      const task1 = await queue.enqueue({ type: 'completed-task', payload: {} });
      const task2 = await queue.enqueue({ type: 'failed-task', payload: {} });
      await queue.enqueue({ type: 'pending-task', payload: {} });

      await queue.dequeue(); // task1 -> processing
      await queue.complete(task1.id);
      await queue.dequeue(); // task2 -> processing
      await queue.fail(task2.id, 'some error');

      const result = await queue.dequeue();
      expect(result).not.toBeNull();
      expect(result!.type).toBe('pending-task');
    });

    it('returns a copy (mutations do not affect queue)', async () => {
      await queue.enqueue({ type: 'test', payload: { key: 'value' } });
      const dequeued = await queue.dequeue();
      dequeued!.payload['key'] = 'mutated';

      const listed = await queue.list();
      expect(listed[0]!.payload['key']).toBe('value');
    });
  });

  // -------------------------------------------------------------------------
  // installationId filtering
  // -------------------------------------------------------------------------

  describe('installationId filtering', () => {
    it('dequeues only tasks matching the requested installationId', async () => {
      await queue.enqueue({ type: 'a', installationId: 1001, payload: {} });
      await queue.enqueue({ type: 'b', installationId: 2002, payload: {} });
      await queue.enqueue({ type: 'c', installationId: 1001, payload: {} });

      const task = await queue.dequeue({ installationId: 2002 });

      expect(task).not.toBeNull();
      expect(task!.type).toBe('b');
      expect(task!.installationId).toBe(2002);
    });

    it('returns null when no tasks match the installationId', async () => {
      await queue.enqueue({ type: 'a', installationId: 1001, payload: {} });

      const task = await queue.dequeue({ installationId: 9999 });
      expect(task).toBeNull();
    });

    it('tasks for installation A never dequeued by installation B', async () => {
      await queue.enqueue({ type: 'task-A', installationId: 100, payload: {} });
      await queue.enqueue({ type: 'task-B', installationId: 200, payload: {} });

      // Installation B should never get A's tasks
      const task = await queue.dequeue({ installationId: 200 });
      expect(task).not.toBeNull();
      expect(task!.type).toBe('task-B');
      expect(task!.installationId).toBe(200);

      // No more tasks for B
      const task2 = await queue.dequeue({ installationId: 200 });
      expect(task2).toBeNull();

      // A's task is still there
      const taskA = await queue.dequeue({ installationId: 100 });
      expect(taskA).not.toBeNull();
      expect(taskA!.type).toBe('task-A');
    });

    it('dequeue without filter returns any pending task', async () => {
      await queue.enqueue({ type: 'a', installationId: 1001, payload: {} });
      await queue.enqueue({ type: 'b', installationId: 2002, payload: {} });

      const task = await queue.dequeue();
      expect(task).not.toBeNull();
      expect(task!.type).toBe('a'); // FIFO
    });
  });

  // -------------------------------------------------------------------------
  // null installationId: self-hosted backward compatibility
  // -------------------------------------------------------------------------

  describe('self-hosted mode (null installationId)', () => {
    it('tasks without installationId can be dequeued without filter', async () => {
      await queue.enqueue({ type: 'self-hosted-task', payload: { foo: 'bar' } });

      const task = await queue.dequeue();
      expect(task).not.toBeNull();
      expect(task!.type).toBe('self-hosted-task');
      expect(task!.installationId).toBeNull();
    });

    it('tasks without installationId are not matched by installationId filter', async () => {
      await queue.enqueue({ type: 'no-install', payload: {} });

      const task = await queue.dequeue({ installationId: 1001 });
      expect(task).toBeNull();
    });

    it('mixed: self-hosted and SaaS tasks coexist', async () => {
      await queue.enqueue({ type: 'self-hosted', payload: {} });
      await queue.enqueue({ type: 'saas-task', installationId: 3003, payload: {} });

      // Dequeue for specific installation
      const saas = await queue.dequeue({ installationId: 3003 });
      expect(saas).not.toBeNull();
      expect(saas!.type).toBe('saas-task');

      // Dequeue without filter gets the self-hosted task
      const selfHosted = await queue.dequeue();
      expect(selfHosted).not.toBeNull();
      expect(selfHosted!.type).toBe('self-hosted');
    });
  });

  // -------------------------------------------------------------------------
  // concurrent installations: 3+ installations, strict isolation
  // -------------------------------------------------------------------------

  describe('concurrent installations isolation', () => {
    it('3 installations with interleaved tasks maintain strict isolation', async () => {
      // Enqueue tasks for 3 different installations, interleaved
      await queue.enqueue({ type: 'inst1-task1', installationId: 111, payload: {} });
      await queue.enqueue({ type: 'inst2-task1', installationId: 222, payload: {} });
      await queue.enqueue({ type: 'inst3-task1', installationId: 333, payload: {} });
      await queue.enqueue({ type: 'inst1-task2', installationId: 111, payload: {} });
      await queue.enqueue({ type: 'inst2-task2', installationId: 222, payload: {} });
      await queue.enqueue({ type: 'inst3-task2', installationId: 333, payload: {} });

      // Dequeue all tasks for installation 222
      const task1 = await queue.dequeue({ installationId: 222 });
      const task2 = await queue.dequeue({ installationId: 222 });
      const task3 = await queue.dequeue({ installationId: 222 });

      expect(task1!.type).toBe('inst2-task1');
      expect(task2!.type).toBe('inst2-task2');
      expect(task3).toBeNull();

      // Installation 111 still has its tasks
      const inst1task1 = await queue.dequeue({ installationId: 111 });
      const inst1task2 = await queue.dequeue({ installationId: 111 });
      expect(inst1task1!.type).toBe('inst1-task1');
      expect(inst1task2!.type).toBe('inst1-task2');

      // Installation 333 still has its tasks
      const inst3task1 = await queue.dequeue({ installationId: 333 });
      const inst3task2 = await queue.dequeue({ installationId: 333 });
      expect(inst3task1!.type).toBe('inst3-task1');
      expect(inst3task2!.type).toBe('inst3-task2');
    });

    it('list filters correctly across installations', async () => {
      await queue.enqueue({ type: 'a', installationId: 111, payload: {} });
      await queue.enqueue({ type: 'b', installationId: 222, payload: {} });
      await queue.enqueue({ type: 'c', installationId: 111, payload: {} });
      await queue.enqueue({ type: 'd', installationId: 333, payload: {} });

      const inst111 = await queue.list({ installationId: 111 });
      expect(inst111).toHaveLength(2);
      expect(inst111.every((t) => t.installationId === 111)).toBe(true);

      const inst222 = await queue.list({ installationId: 222 });
      expect(inst222).toHaveLength(1);

      const all = await queue.list();
      expect(all).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------
  // complete/fail lifecycle
  // -------------------------------------------------------------------------

  describe('complete/fail lifecycle', () => {
    it('marks a task as completed', async () => {
      const task = await queue.enqueue({ type: 'test', payload: {} });
      await queue.dequeue(); // moves to processing
      await queue.complete(task.id);

      const listed = await queue.list({ status: 'completed' });
      expect(listed).toHaveLength(1);
      expect(listed[0]!.status).toBe('completed');
    });

    it('marks a task as failed with an error message', async () => {
      const task = await queue.enqueue({ type: 'test', payload: {} });
      await queue.dequeue(); // moves to processing
      await queue.fail(task.id, 'Connection timed out');

      const listed = await queue.list({ status: 'failed' });
      expect(listed).toHaveLength(1);
      expect(listed[0]!.status).toBe('failed');
      expect(listed[0]!.error).toBe('Connection timed out');
    });

    it('throws when completing a non-existent task', async () => {
      await expect(queue.complete('non-existent')).rejects.toThrow('Task not found');
    });

    it('throws when failing a non-existent task', async () => {
      await expect(queue.fail('non-existent', 'error')).rejects.toThrow('Task not found');
    });

    it('list filters by status', async () => {
      const t1 = await queue.enqueue({ type: 'a', payload: {} });
      const t2 = await queue.enqueue({ type: 'b', payload: {} });
      await queue.enqueue({ type: 'c', payload: {} });

      await queue.dequeue(); // t1 -> processing
      await queue.complete(t1.id);
      await queue.dequeue(); // t2 -> processing
      await queue.fail(t2.id, 'oops');

      const pending = await queue.list({ status: 'pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0]!.type).toBe('c');

      const completed = await queue.list({ status: 'completed' });
      expect(completed).toHaveLength(1);

      const failed = await queue.list({ status: 'failed' });
      expect(failed).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // SaaS mode (requireInstallationId)
  // -------------------------------------------------------------------------

  describe('SaaS mode (requireInstallationId)', () => {
    let saasQueue: InMemoryTaskQueue;

    beforeEach(() => {
      saasQueue = new InMemoryTaskQueue({ requireInstallationId: true });
    });

    it('rejects tasks without installationId', async () => {
      await expect(
        saasQueue.enqueue({ type: 'test', payload: {} }),
      ).rejects.toThrow('installationId is required in SaaS mode');
    });

    it('rejects tasks with explicit null installationId', async () => {
      await expect(
        saasQueue.enqueue({ type: 'test', installationId: null, payload: {} }),
      ).rejects.toThrow('installationId is required in SaaS mode');
    });

    it('accepts tasks with a valid installationId', async () => {
      const task = await saasQueue.enqueue({
        type: 'test',
        installationId: 1001,
        payload: {},
      });
      expect(task.installationId).toBe(1001);
    });
  });

  // -------------------------------------------------------------------------
  // utility methods
  // -------------------------------------------------------------------------

  describe('utility methods', () => {
    it('clear removes all tasks', async () => {
      await queue.enqueue({ type: 'a', payload: {} });
      await queue.enqueue({ type: 'b', payload: {} });
      expect(queue.size).toBe(2);

      queue.clear();
      expect(queue.size).toBe(0);

      const tasks = await queue.list();
      expect(tasks).toHaveLength(0);
    });

    it('size returns the correct count', async () => {
      expect(queue.size).toBe(0);
      await queue.enqueue({ type: 'a', payload: {} });
      expect(queue.size).toBe(1);
      await queue.enqueue({ type: 'b', payload: {} });
      expect(queue.size).toBe(2);
    });
  });
});
