import type { ReboundContext, ReboundReason, ReboundClassification } from './rebound-kernel.js';
import { repairCheckpointPort } from './ports/repair-checkpoint.js';
import { recoveryEvidenceForPrompt } from './rebound-evidence.js';
import type { RecoveryEvidenceRef } from './recovery-evidence.js';
import { buildFreshDiagnosticRepairPrompt, promptSlotsFor } from './rebound-prompts.js';

// Non-gate checkpoints store workflow labels, not executable checks. Keep the
// encoding shared with continuation so legacy interrupted repairs stay resumable.
const NON_GATE_COMMANDS = {
  'rebase-conflict': 'rebase-conflict',
  'handoff-verification': 'px handoff',
  'hook-failure': 'hook-failure',
  'artifact-incomplete': 'artifact-incomplete',
  'agent-timeout': 'agent-timeout',
} satisfies Record<Exclude<ReboundReason['kind'], 'gate-failure' | 'declared-gate-validation'>, string>;

export function isRetainedGateRepair(command: string): boolean {
  return !Object.values(NON_GATE_COMMANDS).includes(command);
}

/** Persists the harness checkpoint before exposing each fresh diagnostic repair prompt. */
export async function prepareRepairPrompt(
  state: { occurrenceId: string; reason: ReboundReason; originalReason: ReboundReason; classification: ReboundClassification; diagnostic: string; originalDiagnostic: string; capturedEvidence?: RecoveryEvidenceRef | null },
  context: ReboundContext, attempt: number, maxAttempts: number,
) {
  // Git completion has a stage-owned instruction and is certified by its Git
  // verifier. Code-repair checkpoint evidence belongs to the generic path.
  if (context.repairPrompt !== undefined) {
    return { fixPrompt: context.repairPrompt, repairPort: undefined, repairCheckpoint: null };
  }
  const { slug, worktree } = context;
  const repairPort = context.repairCheckpoints ?? repairCheckpointPort();
  // A phase rerun can expose a different failed gate. Authorize the check
  // named by this launch, while retaining the original diagnostic for history.
  const required = state.reason;
  const command = required.kind === 'gate-failure' || required.kind === 'declared-gate-validation'
    ? required.command : NON_GATE_COMMANDS[required.kind];
  const repairCheckpoint = await repairPort?.open({ slug, incidentId: state.occurrenceId, command, attempt }) ?? null;
  const lookup = context.retainedFailure ? {} : worktree ? recoveryEvidenceForPrompt(worktree, slug) : {};
  const slots = { label: state.classification.label, slug, worktree, diagnostic: state.diagnostic,
    originalDiagnostic: state.originalDiagnostic, classification: state.classification, attempt, maxAttempts,
    ...promptSlotsFor(state.reason, slug), ...lookup,
    recoveryEvidence: state.capturedEvidence ?? lookup.recoveryEvidence, repairCheckpoint };
  const fixPrompt = buildFreshDiagnosticRepairPrompt(slots);
  return { fixPrompt, repairPort, repairCheckpoint };
}
