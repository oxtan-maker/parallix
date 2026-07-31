import type { DurableEvidence, ProgressEvent, SourceFact } from './contracts.js';

// Re-export operator-state repository ports so presentation consumers (TUI,
// CLI status) can import them from the application layer without referencing
// the adapter layer directly. This satisfies the ADR 0051 boundary rule that
// UI modules delegate through application ports.
export type {
  AgentBlocklistRepository,
  OperationalHistoryRepository,
  BoardLaneEventRepository,
  UsageRepository,
} from '../adapters/sqlite/ports.js';

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

export interface ActiveLaunch {
  readonly agent: string;
  readonly evidence: DurableEvidence;
}

export interface ActivePort {
  validateSlug(_slug: string): Promise<string | null>;
  launch(_slug: string, _agent?: string | null): Promise<ActiveLaunch>;
  recordLaunch(_slug: string, _agent: string): Promise<DurableEvidence>;
  handoff(_slug: string, _agent: string): Promise<void>;
}

export type ProgressPort = (_event: ProgressEvent) => void;
