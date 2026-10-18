import type { WorkflowOperationRecord } from '../application/ports/workflow-operation.js';
import type { RunRecord, RunHistoryRef } from '../application/run-history-types.js';
import type { RecoveryEvidenceRef } from '../application/recovery-evidence-types.js';
import type { ReboundOutcomeRecord } from '../application/rebound-telemetry.js';
import type { WorkflowFailureFacts } from '../application/presentation/workflow-failure.js';

/** Projection of retained facts, never a parser for a verifier's report. */
export function workflowFailureEvidence(operation: WorkflowOperationRecord, runs: readonly RunRecord[],
  gates: readonly RecoveryEvidenceRef[], outcomes: readonly ReboundOutcomeRecord[]): Partial<WorkflowFailureFacts> {
  const run = runs.filter(record => record.operationId === operation.id && record.captureKind === 'coordinator' && record.supervisorPid !== process.pid)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const diagnostics: string[] = [];
  const output: RunHistoryRef[] = [];
  if (run) {
    for (const stream of ['stdout', 'stderr'] as const) {
      const coverage = run.streams[stream];
      // The final retained range avoids any hole introduced by retention.
      if (coverage?.retainedBytes > 0) {
        const start = Math.max(0, ...coverage.omitted.map(range => range.to), coverage.bytes - 16384);
        if (coverage.bytes > start) { output.push({ runId: run.runId, stream, offset: start, length: coverage.bytes - start }); }
      }
    }
    diagnostics.push(...run.omissions);
  }
  const related = gates.filter(gate => gate.capturedAt >= operation.createdAt && gate.capturedAt <= operation.updatedAt);
  for (const gate of related.slice(0, 3)) {
    diagnostics.push(gateDiagnostic(gate));
  }
  const recovery = outcomes.filter(event => event.operationId === operation.id && event.missionId === operation.missionId).at(-1);
  if (recovery?.diagnostic) { diagnostics.push(recovery.diagnostic); }
  return { exitCode: run?.exitCode, signal: run?.signal, output, diagnostics,
    ...recoveryFacts(recovery, operation.missionId) };
}

function recoveryFacts(recovery: ReboundOutcomeRecord | undefined, mission: string): Partial<WorkflowFailureFacts> {
  if (!recovery) { return {}; }
  if (recovery.outcome === 'human-only') {
    return { ...(recovery.attempts > 0 ? { recovery: { outcome: 'attempted' as const, attempts: recovery.attempts } } : {}),
      next: `Resolve the recorded human-only blocker; inspect px status ${mission} before explicitly retrying.` };
  }
  return { recovery: { outcome: recovery.outcome === 'fixed' ? 'resolved' : 'exhausted', attempts: recovery.attempts } };
}

function gateDiagnostic(gate: RecoveryEvidenceRef): string {
  return `Gate: ${gate.command}; ${gate.signal ? `signal ${gate.signal}` : `exit ${gate.exitCode ?? 'unknown'}`}`;
}

export function retainedRecoveryOutcome(data: string, repository: string): ReboundOutcomeRecord[] {
  try {
    const event: unknown = JSON.parse(data);
    if (!event || typeof event !== 'object') { return []; }
    const record = event as Record<string, unknown>;
    if (record.repositoryId !== repository || typeof record.operationId !== 'string' || typeof record.missionId !== 'string'
      || !['fixed', 'exhausted', 'human-only'].includes(String(record.outcome))
      || !Number.isSafeInteger(record.attempts) || Number(record.attempts) < 0 || typeof record.diagnostic !== 'string') { return []; }
    return [record as unknown as ReboundOutcomeRecord];
  } catch { return []; }
}
