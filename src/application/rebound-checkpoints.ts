import type { ReboundContext, ReboundReason, ReboundClassification } from './rebound-kernel.js';
import { repairCheckpointPort } from './ports/repair-checkpoint.js';
import { recoveryEvidenceForPrompt } from './rebound-evidence.js';
import type { RecoveryEvidenceRef } from './recovery-evidence.js';
import { buildFreshDiagnosticRepairPrompt, promptSlotsFor } from './rebound-prompts.js';

/** Persists the harness checkpoint before exposing each fresh diagnostic repair prompt. */
export async function prepareRepairPrompt(
  state: { occurrenceId: string; reason: ReboundReason; originalReason: ReboundReason; classification: ReboundClassification; diagnostic: string; originalDiagnostic: string; capturedEvidence?: RecoveryEvidenceRef | null },
  context: ReboundContext, attempt: number, maxAttempts: number,
) {
  const { slug, worktree } = context;
  const repairPort = context.repairCheckpoints ?? repairCheckpointPort();
  const required = state.originalReason;
  const command = required.kind === 'gate-failure' || required.kind === 'declared-gate-validation'
    ? required.command : required.kind === 'handoff-verification' ? 'px handoff' : required.kind;
  const repairCheckpoint = await repairPort?.open({ slug, incidentId: state.occurrenceId, command, attempt }) ?? null;
  const lookup = worktree ? recoveryEvidenceForPrompt(worktree, slug) : {};
  const slots = { label: state.classification.label, slug, worktree, diagnostic: state.diagnostic,
    originalDiagnostic: state.originalDiagnostic, classification: state.classification, attempt, maxAttempts,
    ...promptSlotsFor(state.reason, slug), ...lookup,
    recoveryEvidence: state.capturedEvidence ?? lookup.recoveryEvidence, repairCheckpoint };
  const fixPrompt = buildFreshDiagnosticRepairPrompt(slots);
  return { fixPrompt, repairPort, repairCheckpoint };
}
