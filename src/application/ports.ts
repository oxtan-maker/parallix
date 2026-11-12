import type { StatsRow } from './services/statistics-row.js';
export type { StatsRow } from './services/statistics-row.js';
import type { DurableEvidence, ProgressEvent, SourceFact } from './contracts.js';
import type { StatsRecoveryCollection } from './stats-recovery-evidence.js';
export type { StatsRecoveryCollection, StatsRecoveryConflict, StatsRecoveryEvidence,
  StatsRecoveryFactKind, StatsRecoveryLinks, StatsRecoverySource, StatsRecoveryAudit,
} from './stats-recovery-evidence.js';
export type { StatsMeasurementRecoveryReport, StatsMeasurementRecoveryTarget } from './stats-backfill-service.js';

// Re-export operator-state repository ports so presentation consumers (TUI,
// CLI status) can import them from the application layer without referencing
// the adapter layer directly. This satisfies the ADR 0051 boundary rule that
// UI modules delegate through application ports.
export type {
  AgentBlocklistRepository,
  AgentBlockEntry,
} from './ports/agent-blocklist.js';
export type {
  OperationalHistoryRepository,
  BoardLaneEventRepository,
  OperationalHistoryEntry,
  BoardLaneEventEntry,
} from './ports/operation-history.js';
export type {
  UsageRepository,
  UsageRecord,
} from './ports/mission-measurements.js';
// Mechanism ports for the execute workflow. Each names an external mechanism —
// workspace, agent execution, telemetry, review preparation review — rather than a command
// phase; see `ports/execute-mission.ts`.
export type {
  MissionWorkspacePort,
  TaskFileResolution,
  AgentExecutionPort,
  AgentLaunchPlan,
  AgentLaunchRequest,
  AgentLaunchOutcome,
  ExecuteTelemetryPort,
  ExecuteTelemetryRecord,
  ExecuteMissionPorts,
} from './ports/execute-mission.js';

export interface StatsBackfillUnresolved {
  readonly slug: string; readonly reason: string; readonly detail?: string | null;
  readonly missing?: readonly string[];
  readonly date?: string | null; readonly classification?: string | null;
  readonly implementer?: string | null; readonly prFixRounds?: number | null;
  readonly sources?: { readonly classification: string; readonly implementer: string | null };
}
export interface StatsBackfillSkipped { readonly slug: string; readonly reason: string; }

export interface StatsReconstructionChange {
  readonly mission: string;
  readonly before: readonly (number | null)[];
  readonly beforeObserved: boolean;
  readonly after: number | null;
  readonly byImplementer: Readonly<Record<string, number>>;
  /** The final counting owner's distinct returns and their provenance. */
  readonly returns: import('./services/review-statistics.js').ReviewStatistics['returns'];
}
export interface StatsProjection {
  readonly changes?: readonly StatsReconstructionChange[];
  readonly rows: readonly StatsRow[];
  readonly sources: readonly SourceFact<string>[];
  readonly unresolved?: readonly StatsBackfillUnresolved[];
  readonly skipped?: readonly StatsBackfillSkipped[];
  readonly recovery?: StatsRecoveryCollection;
  readonly recoveryAudit?: import('./stats-recovery-evidence.js').StatsRecoveryAudit;
  /** Per-measurement native-run proof for the population frozen by the consistent copy. */
  readonly measurementRecovery?: import('./stats-backfill-service.js').StatsMeasurementRecoveryReport;
}

/** Where a recovery run reads and writes operator state. Apply is copy-only. */
export interface StatsRecoveryTarget {
  readonly databasePath: string;
  /** Only an explicit apply may materialize the consistent copy. */
  readonly materialize?: boolean;
}

export interface StatsBackfillPort {
  readProjection(_target?: StatsRecoveryTarget,
    _inventory?: readonly import('./stats-backfill-service.js').StatsMeasurementRecoveryTarget[]): Promise<StatsProjection>;
  applyProjection(_projection: StatsProjection, _target?: StatsRecoveryTarget): Promise<readonly DurableEvidence[]>;
}

export type ProgressPort = (_event: ProgressEvent) => void;
