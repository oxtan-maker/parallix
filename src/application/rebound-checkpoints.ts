import { randomUUID } from 'node:crypto';
import type { ReboundContext, ReboundReason, ReboundClassification } from './rebound-kernel.js';
import type { OpenRepairCheckpoint, RepairCheckpointPort } from './ports/repair-checkpoint.js';
import { repairCheckpointPort } from './ports/repair-checkpoint.js';
import { captureGateFailureEvidence, recoveryEvidenceForPrompt } from './rebound-evidence.js';
import type { RecoveryEvidenceRef } from './recovery-evidence.js';
import { buildFreshDiagnosticRepairPrompt, promptSlotsFor, recoveryEvidenceRoute } from './rebound-prompts.js';
import { renderRepairPrompt } from './ports/repair-prompts.js';

// Non-gate checkpoints store workflow labels, not executable checks. Keep the
// encoding shared with continuation so legacy interrupted repairs stay resumable.
const NON_GATE_COMMANDS = {
  'rebase-conflict': 'rebase-conflict',
  'review-preparation-verification': 'review-preparation',
  'hook-failure': 'hook-failure',
  'artifact-incomplete': 'artifact-incomplete',
  'agent-timeout': 'agent-timeout',
} satisfies Record<Exclude<ReboundReason['kind'], 'gate-failure' | 'declared-gate-validation'>, string>;

export function isRetainedGateRepair(command: string): boolean {
  return !Object.values(NON_GATE_COMMANDS).includes(command);
}

type RepairPromptState = {
  occurrenceId: string;
  reason: ReboundReason;
  originalReason: ReboundReason;
  classification: ReboundClassification;
  diagnostic: string;
  originalDiagnostic: string;
  capturedEvidence?: RecoveryEvidenceRef | null;
  aggregateEvidence?: Array<{ gateKey: string; evidence?: RecoveryEvidenceRef }>;
};

type RepairCheckpointRef = { gateKey: string; command: string; name: string; version: number };

interface PreparedRepairPrompt {
  fixPrompt: string;
  repairPort: RepairCheckpointPort | undefined;
  repairCheckpoint: { name: string; version: number } | null;
  repairCheckpointRefs?: readonly RepairCheckpointRef[];
}

/** Persists the harness checkpoint before exposing each fresh diagnostic repair prompt. */
export async function prepareRepairPrompt(
  state: RepairPromptState,
  context: ReboundContext, attempt: number, maxAttempts: number,
): Promise<PreparedRepairPrompt> {
  // Git completion has a stage-owned instruction and is certified by its Git
  // verifier. Code-repair checkpoint evidence belongs to the generic path.
  if (context.repairPrompt !== undefined) {
    const fixPrompt = await context.repairPrompt();
    return { fixPrompt, repairPort: undefined, repairCheckpoint: null };
  }
  if (isReviewerOutputFailure(state.reason)) { return reviewerOutputRepairPrompt(state, context, attempt, maxAttempts); }
  return prepareCheckpointRepairPrompt(state, context, attempt, maxAttempts);
}

function isReviewerOutputFailure(reason: ReboundReason): boolean {
  return (reason.kind === 'agent-timeout' || reason.kind === 'artifact-incomplete') && reason.role === 'reviewer';
}

function reviewerOutputRepairPrompt(state: RepairPromptState, context: ReboundContext,
  attempt: number, maxAttempts: number): PreparedRepairPrompt {
  const expectedOutput = state.reason.kind === 'agent-timeout' && state.reason.expectedOutput
    ? `Required output: ${state.reason.expectedOutput}\n` : '';
  return { fixPrompt: renderRepairPrompt('reviewer-output', {
    label: state.classification.label, attempt, maxAttempts, slug: context.slug, expectedOutput,
    evidenceRoute: recoveryEvidenceRoute({ recoveryEvidence: state.capturedEvidence }).join('\n'),
    originalDiagnostic: state.originalDiagnostic, latestDiagnostic: state.diagnostic,
  }), repairPort: undefined, repairCheckpoint: null };
}

async function prepareCheckpointRepairPrompt(state: RepairPromptState, context: ReboundContext,
  attempt: number, maxAttempts: number): Promise<PreparedRepairPrompt> {
  const { slug, worktree } = context;
  const repairPort = context.repairCheckpoints ?? repairCheckpointPort();
  // A phase rerun can expose a different failed gate. Authorize the check
  // named by this launch, while retaining the original diagnostic for history.
  const command = repairCommand(state.reason);
  const obligations = context.repairObligations?.length ? context.repairObligations : null;
  await captureAggregateEvidence(state, context, obligations, command);
  const { repairCheckpoint, repairCheckpointRefs } = await openRepairCheckpointSet(
    state, context, obligations, repairPort, command, attempt);
  const lookup = recoveryPromptLookup(context);
  const slots = { label: state.classification.label, slug, worktree, diagnostic: state.diagnostic,
    originalDiagnostic: state.originalDiagnostic, classification: state.classification, attempt, maxAttempts,
    ...promptSlotsFor(state.reason, slug), ...lookup,
    recoveryEvidence: state.capturedEvidence ?? lookup.recoveryEvidence,
    recoveryEvidenceAll: state.aggregateEvidence?.flatMap(item => item.evidence ? [{ gateKey: item.gateKey, evidence: item.evidence }] : []),
    repairCheckpoint, repairCheckpointRefs };
  const fixPrompt = buildFreshDiagnosticRepairPrompt(slots);
  return { fixPrompt, repairPort, repairCheckpoint, repairCheckpointRefs };
}

function repairCommand(reason: ReboundReason): string {
  return reason.kind === 'gate-failure' || reason.kind === 'declared-gate-validation'
    ? reason.command : NON_GATE_COMMANDS[reason.kind];
}

async function captureAggregateEvidence(state: RepairPromptState, context: ReboundContext,
  obligations: ReboundContext['repairObligations'] | null, command: string): Promise<void> {
  if (!obligations || state.aggregateEvidence) { return; }
  state.aggregateEvidence = [];
  for (const obligation of obligations) {
    const evidence = reuseCapturedEvidence(state, obligation.reason, command)
      ? state.capturedEvidence ?? undefined
      : await captureGateFailureEvidence(obligation.reason, context.worktree, context);
    state.aggregateEvidence.push({ gateKey: obligation.gateKey, evidence });
  }
}

function reuseCapturedEvidence(state: RepairPromptState, reason: Extract<ReboundReason, { kind: 'gate-failure' }>,
  command: string): boolean {
  return state.originalReason.kind === 'gate-failure'
    && reason.area === state.originalReason.area
    && reason.command === command
    && Boolean(state.capturedEvidence);
}

async function openRepairCheckpointSet(state: RepairPromptState, context: ReboundContext,
  obligations: ReboundContext['repairObligations'] | null, repairPort: RepairCheckpointPort | undefined,
  command: string, attempt: number): Promise<{ repairCheckpoint: { name: string; version: number } | null;
    repairCheckpointRefs: RepairCheckpointRef[] }> {
  const refs: RepairCheckpointRef[] = [];
  if (obligations) {
    for (const obligation of obligations) {
      const evidence = state.aggregateEvidence?.find(item => item.gateKey === obligation.gateKey)?.evidence;
      const opened = await repairPort?.open({ slug: context.slug, incidentId: state.occurrenceId,
        gateKey: obligation.gateKey, command: obligation.reason.command, attempt,
        ...failureOccurrence(obligation.reason.command, context.worktree, evidence) });
      if (opened) { refs.push({ gateKey: obligation.gateKey, command: obligation.reason.command, ...opened }); }
    }
    return { repairCheckpoint: refs[0] ?? null, repairCheckpointRefs: refs };
  }
  const repairCheckpoint = await repairPort?.open({ slug: context.slug, incidentId: state.occurrenceId,
    command, attempt, ...failureOccurrence(command, context.worktree, state.capturedEvidence) }) ?? null;
  return { repairCheckpoint, repairCheckpointRefs: refs };
}

function recoveryPromptLookup(context: ReboundContext) {
  if (context.retainedFailure || !context.worktree) { return {}; }
  return recoveryEvidenceForPrompt(context.worktree, context.slug);
}

/** The harness snapshots authority before the exact verifier and certifies only its success. */
export async function runCheckpointVerification(context: ReboundContext, prepared: Awaited<ReturnType<typeof prepareRepairPrompt>>, attempt: number) {
  const { repairPort, repairCheckpoint, repairCheckpointRefs = [] } = prepared;
  const readHead = async () => await context.readHead?.() ?? context.head ?? null;
  const executionRevision = await readHead();
  const refs = repairCheckpointRefs.length ? repairCheckpointRefs : repairCheckpoint ? [{ gateKey: '', command: '', ...repairCheckpoint }] : [];
  const snapshots = await Promise.all(refs.map(async ref => ({ ref,
    snapshot: await repairPort?.prepareVerification?.(context.slug, ref.name,
      { worktree: context.worktree, executionRevision }) })));
  if (refs.length > 1 && snapshots.some(item => !item.snapshot)) {
    throw new Error('Every aggregate repair checkpoint needs fresh authorized evidence before the integration gates rerun');
  }
  const startedAt = new Date().toISOString();
  const verified = await context.verify(attempt);
  const revisionAfter = snapshots.some(item => item.snapshot) ? await readHead() : null;
  const exactExecutions = verified.exactExecutions ?? (verified.exactExecution ? [verified.exactExecution] : []);
  return { verified, certify: async () => {
    if (verified.ok) {
      const checks = snapshots.flatMap(({ ref, snapshot }) => {
        const exact = snapshot && exactExecutions.find(receipt => receipt.command === snapshot.command
          && receipt.worktree === snapshot.worktree && receipt.exitCode === 0);
        return exact ? [{ name: ref.name, proof: { snapshot,
          command: exact.command, revisionAfter,
          execution: { id: randomUUID(), producer: 'rebound-exact-verifier' as const, startedAt,
            completedAt: new Date().toISOString(), exitCode: 0 as const },
        } }] : [];
      });
      if (refs.length > 1) {
        if (checks.length !== refs.length) { throw new Error('Authoritative aggregate rerun coverage is incomplete'); }
        if (!repairPort?.verifyAll) { throw new Error('Aggregate repair checkpoint authority is unavailable'); }
        await repairPort.verifyAll(context.slug, checks);
      } else if (refs[0]) {
        await repairPort!.verify(context.slug, refs[0].name, ...(checks[0] ? [checks[0].proof] : []));
      }
    }
  } };
}

function failureOccurrence(command: string, worktree: string, failure?: RecoveryEvidenceRef | null): Pick<OpenRepairCheckpoint, 'worktree' | 'failureRevision' | 'failureEvidenceId'> {
  if (!failure || failure.command !== command || failure.cwd !== worktree || failure.exitCode === 0 || !failure.captureComplete) { return {}; }
  return { worktree, failureRevision: failure.capturedRevision,
    failureEvidenceId: `${failure.incidentId}:${failure.attempt}` };
}
