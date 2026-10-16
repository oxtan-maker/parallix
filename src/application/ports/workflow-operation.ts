import type { WorkflowOperation } from '../../domain/workflow-operation.js';

export interface WorkflowInvocation { readonly command: 'draft' | 'review' | 'integrate'; readonly args: readonly string[]; }
/** Transport details remain application state, outside the domain operation. */
export interface WorkflowOperationRecord extends WorkflowOperation {
  readonly requestedAgent?: string | null;
  readonly invocation?: WorkflowInvocation;
  readonly payload?: import('../controller/board-command.js').BoardCommandPayload;
}

/** All methods run on the same connection as the supplied Mission authority. */
export interface WorkflowOperationStore {
  readOnly<T>(_work: () => Promise<T>): Promise<T>;
  transaction<T>(_work: () => Promise<T>): Promise<T>;
  get(_id: string): Promise<WorkflowOperationRecord | null>;
  byRequest(_mission: string, _key: string): Promise<WorkflowOperationRecord | null>;
  current(_mission: string): Promise<WorkflowOperationRecord | null>;
  open(): Promise<readonly WorkflowOperationRecord[]>;
  insert(_operation: WorkflowOperationRecord): Promise<void>;
  replace(_operation: WorkflowOperationRecord, _generation: number): Promise<void>;
}

/** Process hosting is a mechanism; admission, recovery and replacement are use cases. */
export interface WorkflowProcessPort {
  identity(): { readonly pid: number; readonly identity: string };
  launch(_id: string): Promise<void>;
  alive(_owner: NonNullable<WorkflowOperation['owner']>): Promise<boolean | null>;
  stopEffects?(_operation: WorkflowOperation): Promise<boolean>;
  effectsSettled?(_operation: WorkflowOperation): Promise<boolean>;
  stop(_owner: NonNullable<WorkflowOperation['owner']>): Promise<boolean>;
}
