export type TerminalStatus = 'completed' | 'rejected' | 'failed' | 'cancelled';

export type ErrorKind = 'validation' | 'capability' | 'conflict' | 'unavailable' | 'execution' | 'cancelled';

export interface ApplicationError {
  readonly kind: ErrorKind;
  readonly message: string;
}

export interface DurableEvidence {
  readonly id: string;
  /** `mission-store` is the selected Mission authority behind the repository port. */
  readonly source: 'task-markdown' | 'git' | 'stats' | 'mission-store';
  readonly detail: string;
}

export interface ApplicationOutcome<T> {
  readonly status: TerminalStatus;
  readonly value?: T;
  readonly error?: ApplicationError;
  readonly durableEvidence: readonly DurableEvidence[];
}

export interface SourceFact<T> {
  readonly source: 'task-markdown' | 'mission-store' | 'git' | 'stats' | 'configuration' | 'integration-gates';
  readonly status: 'fresh' | 'stale' | 'unavailable';
  readonly value?: T;
}

export interface ProgressEvent {
  readonly operationId: string;
  readonly sequence: number;
  readonly phase: string;
  readonly message: string;
  readonly timestamp: string;
  readonly agent?: string;
}

export interface Cancellation {
  readonly requested: boolean;
}

export type Capability =
  | 'stats:apply'
  | 'active:execute'
  | 'mission:intake'
  | 'mission:transition'
  | 'integration:decide'
  | 'closure:record'
  | 'checkpoint:record'
  | 'handoff:record';

export function completed<T>(
  value: T,
  durableEvidence: readonly DurableEvidence[] = [],
): ApplicationOutcome<T> {
  return { status: 'completed', value, durableEvidence };
}

export function failure<T>(kind: ErrorKind, message: string, durableEvidence: readonly DurableEvidence[] = []): ApplicationOutcome<T> {
  return { status: kind === 'cancelled' ? 'cancelled' : 'failed', error: { kind, message }, durableEvidence };
}

export function rejected<T>(kind: 'validation' | 'capability', message: string): ApplicationOutcome<T> {
  return { status: 'rejected', error: { kind, message }, durableEvidence: [] };
}
