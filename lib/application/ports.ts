import type { DurableEvidence, ProgressEvent, SourceFact } from './contracts.js';

export interface StatsRow {
  readonly mission: string;
  readonly implementer: string;
}

export interface StatsProjection {
  readonly rows: readonly StatsRow[];
  readonly sources: readonly SourceFact<string>[];
}

export interface StatsBackfillPort {
  readProjection(): Promise<StatsProjection>;
  applyRows(_rows: readonly StatsRow[]): Promise<readonly DurableEvidence[]>;
}

export interface ActiveLaunch {
  readonly agent: string;
  readonly evidence: DurableEvidence;
}

export interface ActivePort {
  validateSlug(_slug: string): Promise<string | null>;
  launch(_slug: string, _agent: string): Promise<ActiveLaunch>;
  recordLaunch(_slug: string, _agent: string): Promise<DurableEvidence>;
  handoff(_slug: string, _agent: string): Promise<void>;
}

export type ProgressPort = (_event: ProgressEvent) => void;
