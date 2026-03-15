/**
 * Task Queue Interface
 *
 * Defines the contract for multi-tenant task queue implementations.
 * Supports optional installationId for tenant isolation in SaaS mode
 * while remaining backward-compatible with self-hosted (null installationId).
 */

/** Represents a queued task. */
export interface ITask {
  /** Unique task identifier (UUID). */
  id: string;
  /** Task type (e.g. "github.issues.opened", "github.push.unknown"). */
  type: string;
  /** GitHub App installation ID for multi-tenant isolation. Null/undefined for self-hosted. */
  installationId?: number | null;
  /** Arbitrary task payload. */
  payload: Record<string, unknown>;
  /** Current status of the task. */
  status: 'pending' | 'processing' | 'completed' | 'failed';
  /** Error message if the task failed. */
  error?: string;
  /** ISO 8601 timestamp when the task was created. */
  createdAt: string;
  /** ISO 8601 timestamp when the task was last updated. */
  updatedAt: string;
}

/** Options for enqueueing a new task. */
export type EnqueueTaskInput = Omit<ITask, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'error'>;

/** Options for dequeuing tasks. */
export interface DequeueOptions {
  /** Filter by installationId. When set, only returns tasks for this installation. */
  installationId?: number;
}

/** Options for listing tasks. */
export interface ListTasksOptions {
  /** Filter by installationId. */
  installationId?: number;
  /** Filter by task status. */
  status?: ITask['status'];
}

/** Interface for task queue operations. */
export interface ITaskQueue {
  /**
   * Add a new task to the queue.
   * Returns the created task with a generated id, 'pending' status, and timestamps.
   */
  enqueue(task: EnqueueTaskInput): Promise<ITask>;

  /**
   * Dequeue the next pending task, optionally filtered by installationId.
   * The task is atomically moved to 'processing' status.
   * Returns null if no matching tasks are available.
   */
  dequeue(options?: DequeueOptions): Promise<ITask | null>;

  /**
   * Mark a task as completed.
   */
  complete(taskId: string): Promise<void>;

  /**
   * Mark a task as failed with an error message.
   */
  fail(taskId: string, error: string): Promise<void>;

  /**
   * List tasks, optionally filtered by installationId and/or status.
   */
  list(options?: ListTasksOptions): Promise<ITask[]>;
}
