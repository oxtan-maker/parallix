import type { DurableEvidence, ProgressEvent, SourceFact } from './contracts.js';

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
// Mechanism ports for the execute workflow (TASK-2332.04). They replace the
// legacy phase-named `ActivePort`; see `ports/execute-mission.ts`.
export type {
  MissionWorkspacePort,
  TaskFileResolution,
  AgentExecutionPort,
  AgentLaunchPlan,
  AgentLaunchRequest,
  AgentLaunchOutcome,
  ExecuteTelemetryPort,
  ExecuteTelemetryRecord,
  HandoffReviewPort,
  HandoffReviewRequest,
  ExecuteMissionPorts,
} from './ports/execute-mission.js';

export interface StatsRow {
  readonly mission: string;
  readonly implementer: string;
  readonly [field: string]: unknown;
}

export interface StatsProjection {
  readonly rows: readonly StatsRow[];
  readonly sources: readonly SourceFact<string>[];
  readonly unresolved?: readonly Record<string, unknown>[];
  readonly skipped?: readonly Record<string, unknown>[];
}

export interface StatsBackfillPort {
  readProjection(_options?: { readonly filePath?: string | null }): Promise<StatsProjection>;
  applyRows(_rows: readonly StatsRow[], _options?: { readonly filePath?: string | null }): Promise<readonly DurableEvidence[]>;
}

export type ProgressPort = (_event: ProgressEvent) => void;
