import type { MissionId } from '../../domain/mission.js';

/** How one authoritative pre-integration gate run stands. Only `running` is unsettled. */
export type GateRunReportState = 'running' | 'passed' | 'failed' | 'interrupted' | 'cancelled';

/** One configured gate's standing in a run. Blocked, cancelled, not-run and validated gates are never failures;
 * `validated` is a configured gate this run skipped because earlier evidence already covered it. */
export type GateReportOutcome = 'pending' | 'passed' | 'failed' | 'blocked' | 'cancelled' | 'not-run' | 'validated';

export interface GateRunReportGate {
  readonly key: string;
  readonly outcome: GateReportOutcome;
  readonly exitCode: number | null;
  readonly blockedBy: readonly string[];
  /** Bounded tail of a failed gate's captured output; publishers redact it before display. */
  readonly diagnostics: string | null;
}

/**
 * Provider-neutral result of one gate run, identified by its run id and bound to
 * the revision it tested. It carries no review decision or approval state.
 */
export interface GateRunReport {
  readonly missionId: MissionId;
  readonly gateRunId: string;
  readonly revision: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly state: GateRunReportState;
  readonly gates: readonly GateRunReportGate[];
}

/** Best-effort outward publication of a run's start and settlement; never gates the run. */
export interface GateRunReportPublisher {
  publish(_root: string, _report: GateRunReport): Promise<void>;
}
