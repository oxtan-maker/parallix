/**
 * Durable rebound repair telemetry (TASK-2653).
 *
 * One operational-history row per completed repair attempt, for every rebound
 * consumer. The kernel assembles the evidence; this module only shapes it and
 * hands it to the sink the composition root bound once for the process.
 *
 * Recording is best-effort: a sink failure is logged and never changes the
 * rebound outcome. The rows are history, never read back as current state
 * (ADR 0053).
 */

import type { OperationalHistoryRepository } from './ports/operation-history.js';

/** `operational_history.event_type` for one completed repair attempt. */
export const REBOUND_REPAIR_EVENT = 'rebound.repair';

export type ReboundRepairOutcome = 'pass' | 'advance' | 'rescue' | 'escalate';

export interface ReboundRepairRecord {
  /** Shared by every attempt of one `rebound()` occurrence. */
  readonly occurrenceId: string;
  readonly missionId: string;
  readonly reasonKind: string;
  /** Gate, hook or role the failure belongs to, when the reason names one. */
  readonly area: string | null;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly strategy: 'targeted' | 'fresh-diagnostic';
  readonly context: 'resumed' | 'fresh';
  /** Agent that ran the attempt, after fallback selection. */
  readonly agent: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly fingerprintBefore: string;
  readonly fingerprintAfter: string;
  readonly headBefore: string | null;
  readonly headAfter: string | null;
  readonly outcome: ReboundRepairOutcome;
  readonly durationMs: number;
}

export interface ReboundTelemetrySink {
  readonly repositoryId: string;
  readonly history: Pick<OperationalHistoryRepository, 'append'>;
}

let sink: ReboundTelemetrySink | null = null;

/** Composition root binds the process sink once; `null` unbinds it. */
export function configureReboundTelemetry(next: ReboundTelemetrySink | null): void {
  sink = next;
}

/** Append one attempt record; failures are reported through `log` and swallowed. */
export async function recordReboundRepair(record: ReboundRepairRecord, log?: (_msg: string) => void): Promise<void> {
  const bound = sink;
  if (!bound) { return; }
  try {
    await bound.history.append({
      eventType: REBOUND_REPAIR_EVENT,
      eventData: JSON.stringify({ ...record, repositoryId: bound.repositoryId }),
      createdAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    log?.(`RECOVERY_TELEMETRY could not be recorded: ${(err as Error)?.message ?? String(err)}`);
  }
}
