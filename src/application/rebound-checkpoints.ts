import { randomUUID } from 'node:crypto';
import type { ReboundContext, ReboundReason, ReboundClassification } from './rebound-kernel.js';
import type { OpenRepairCheckpoint } from './ports/repair-checkpoint.js';
import { repairCheckpointPort } from './ports/repair-checkpoint.js';
import { recoveryEvidenceForPrompt } from './rebound-evidence.js';
import type { RecoveryEvidenceRef } from './recovery-evidence.js';
import { buildFreshDiagnosticRepairPrompt, promptSlotsFor, recoveryEvidenceRoute } from './rebound-prompts.js';

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
  if ((state.reason.kind === 'agent-timeout' || state.reason.kind === 'artifact-incomplete') && state.reason.role === 'reviewer') {
    return { fixPrompt: [
      `${state.classification.label}`,
      'Reviewer output recovery. You have a fresh context. You remain the independent reviewer.',
      `Retry attempt: ${attempt}/${maxAttempts}`,
      ...(state.reason.kind === 'agent-timeout' && state.reason.expectedOutput ? [`Required output: ${state.reason.expectedOutput}`] : []),
      ...recoveryEvidenceRoute({ recoveryEvidence: state.capturedEvidence }),
      `Mission: ${context.slug}; attempt ${attempt}/${maxAttempts}.`,
      `Original failure: ${state.originalDiagnostic}`,
      `Latest failure: ${state.diagnostic}`,
      `Read px status ${context.slug} --json and the current revision; complete the remaining independent review obligations.`,
      'Submit your verdict through px verdict approve or px verdict request-changes with the assigned reviewer actor. You have authority to approve a correct fix.',
      'Read applicable AGENTS.md repository rules. Inspect the current branch revision and working-tree edits. If evidence is missing or stale, report it explicitly. This retry requires reviewer output only. Preserve the mission tree and report any workflow rejection with its cause and supported operator recovery action.',
    ].join('\n'), repairPort: undefined, repairCheckpoint: null };
  }
  const { slug, worktree } = context;
  const repairPort = context.repairCheckpoints ?? repairCheckpointPort();
  // A phase rerun can expose a different failed gate. Authorize the check
  // named by this launch, while retaining the original diagnostic for history.
  const required = state.reason;
  const command = required.kind === 'gate-failure' || required.kind === 'declared-gate-validation'
    ? required.command : NON_GATE_COMMANDS[required.kind];
  const repairCheckpoint = await repairPort?.open({ slug, incidentId: state.occurrenceId, command, attempt,
    ...failureOccurrence(command, worktree, state.capturedEvidence) }) ?? null;
  const lookup = context.retainedFailure ? {} : worktree ? recoveryEvidenceForPrompt(worktree, slug) : {};
  const slots = { label: state.classification.label, slug, worktree, diagnostic: state.diagnostic,
    originalDiagnostic: state.originalDiagnostic, classification: state.classification, attempt, maxAttempts,
    ...promptSlotsFor(state.reason, slug), ...lookup,
    recoveryEvidence: state.capturedEvidence ?? lookup.recoveryEvidence, repairCheckpoint };
  const fixPrompt = buildFreshDiagnosticRepairPrompt(slots);
  return { fixPrompt, repairPort, repairCheckpoint };
}

/** The harness snapshots authority before the exact verifier and certifies only its success. */
export async function runCheckpointVerification(context: ReboundContext, prepared: Awaited<ReturnType<typeof prepareRepairPrompt>>, attempt: number) {
  const { repairPort, repairCheckpoint } = prepared;
  const readHead = async () => await context.readHead?.() ?? context.head ?? null;
  const snapshot = repairCheckpoint ? await repairPort?.prepareVerification?.(context.slug, repairCheckpoint.name,
    { worktree: context.worktree, executionRevision: await readHead() }) : undefined;
  const startedAt = new Date().toISOString();
  const verified = await context.verify(attempt);
  const revisionAfter = snapshot ? await readHead() : null;
  const exact = verified.exactExecution;
  const freshExecution = snapshot && exact?.command === snapshot.command && exact.worktree === snapshot.worktree && exact.exitCode === 0;
  return { verified, certify: async () => {
    if (verified.ok && repairCheckpoint) {
      await repairPort!.verify(context.slug, repairCheckpoint.name, ...(freshExecution ? [{ snapshot,
        command: verified.command ?? '', revisionAfter,
        execution: { id: randomUUID(), producer: 'rebound-exact-verifier' as const, startedAt,
          completedAt: new Date().toISOString(), exitCode: 0 as const },
      }] : []));
    }
  } };
}

function failureOccurrence(command: string, worktree: string, failure?: RecoveryEvidenceRef | null): Pick<OpenRepairCheckpoint, 'worktree' | 'failureRevision' | 'failureEvidenceId'> {
  if (!failure || failure.command !== command || failure.cwd !== worktree || failure.exitCode === 0 || !failure.captureComplete) { return {}; }
  return { worktree, failureRevision: failure.capturedRevision,
    failureEvidenceId: `${failure.incidentId}:${failure.attempt}` };
}
