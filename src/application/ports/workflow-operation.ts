import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type { ReviewOperatorResumePermit } from '../review-recovery.js';
import type { ExecutionActivityActor } from '../../domain/execution-activity.js';

export interface WorkflowInvocation { readonly command: 'draft' | 'review' | 'rebase' | 'integrate'; readonly args: readonly string[]; readonly interactive?: boolean; }
/** Transport details remain application state, outside the domain operation. */
export interface WorkflowOperationRecord extends WorkflowOperation {
  readonly activityActor?: ExecutionActivityActor;
  readonly operatorInvocation?: boolean;
  readonly requestedAgent?: string | null;
  readonly pinnedAgent?: boolean;
  readonly invocation?: WorkflowInvocation;
  readonly reviewOperatorResume?: ReviewOperatorResumePermit;
}

/** All methods run on the same connection as the supplied Mission authority. */
export interface WorkflowOperationStore {
  readonly activity: import('./execution-activity.js').ExecutionActivityStore;
  readOnly<T>(_work: () => Promise<T>): Promise<T>;
  transaction<T>(_work: () => Promise<T>): Promise<T>;
  get(_id: string): Promise<WorkflowOperationRecord | null>;
  byRequest(_mission: string, _key: string): Promise<WorkflowOperationRecord | null>;
  current(_mission: string): Promise<WorkflowOperationRecord | null>;
  open(): Promise<readonly WorkflowOperationRecord[]>;
  latest(_mission: string): Promise<WorkflowOperationRecord | null>;
  latestByMission(): Promise<readonly WorkflowOperationRecord[]>;
  /** Revision of durable historical operation evidence used by analytics. */
  analyticsRevision?(): Promise<string>;
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
