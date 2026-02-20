/**
 * Workflow engine abstraction for orchestrating ELSA workflows.
 *
 * Defines the contract for interacting with the ELSA workflow runtime,
 * allowing the engine to start, monitor, pause, resume, and cancel
 * workflow instances.
 */

export interface WorkflowInstanceStatus {
  instanceId: string;
  definitionId: string;
  status: 'Running' | 'Suspended' | 'Finished' | 'Cancelled' | 'Faulted' | 'Unknown';
  currentActivity?: string;
  createdAt?: string;
  completedAt?: string;
  variables: Record<string, unknown>;
}

export interface IWorkflowEngine {
  startWorkflow(name: string, input: Record<string, unknown>): Promise<string>;
  getWorkflowStatus(instanceId: string): Promise<WorkflowInstanceStatus>;
  pauseWorkflow(instanceId: string): Promise<void>;
  resumeWorkflow(instanceId: string): Promise<void>;
  cancelWorkflow(instanceId: string): Promise<void>;
  sendSignal(instanceId: string, signal: string, payload?: unknown): Promise<void>;
}
