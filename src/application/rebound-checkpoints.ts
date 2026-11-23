import { randomUUID } from 'node:crypto';
import type { ReboundContext, ReboundReason, ReboundClassification } from './rebound-kernel.js';
import type { OpenRepairCheckpoint, RepairCheckpointPort } from './ports/repair-checkpoint.js';
import { repairCheckpointPort } from './ports/repair-checkpoint.js';
import { captureGateFailureEvidence, recoveryEvidenceForPrompt } from './rebound-evidence.js';
import type { RecoveryEvidenceRef } from './recovery-evidence.js';
import { buildFreshDiagnosticRepairPrompt, promptSlotsFor, recoveryEvidenceRoute } from './rebound-prompts.js';
import { renderRepairPrompt } from './ports/repair-prompts.js';
import type { FixLaunch } from './rebound-launch-result.js';
import type { InvalidContractBlocker } from '../domain/rebound-policy.js';
import { NON_GATE_REPAIR_COMMANDS } from '../domain/repair-coverage.js';
export { isRetainedGateRepair } from '../domain/repair-coverage.js';

const _NON_GATE_REPAIR_COMMANDS_COMPLETE: Record<Exclude<ReboundReason['kind'],
  'gate-failure' | 'declared-gate-validation'>, string> = NON_GATE_REPAIR_COMMANDS;
void _NON_GATE_REPAIR_COMMANDS_COMPLETE;

type RepairPromptState = {
  occurrenceId: string;
  reason: ReboundReason;
  originalReason: ReboundReason;
  classification: ReboundClassification;
  diagnostic: string;
  originalDiagnostic: string;
  capturedEvidence?: RecoveryEvidenceRef | null;
  repairObligations?: readonly NonNullable<ReboundContext['repairObligations']>[number][];
  aggregateEvidence?: Array<{ gateKey: string; evidence?: RecoveryEvidenceRef }>;
};

type RepairCheckpointRef = { gateKey: string; command: string; name: string; version: number };

interface PreparedRepairPrompt {
  fixPrompt: string;
  repairPort: RepairCheckpointPort | undefined;
  repairCheckpoint: { name: string; version: number } | null;
  repairCheckpointRefs?: readonly RepairCheckpointRef[];
}

/** Retains attempt usage only after an agent repair process actually ran. */
export async function recordConsumedRepairAttempts(slug: string, prepared: PreparedRepairPrompt,
  launch: Pick<FixLaunch, 'repairAttempted'>, attempt: number): Promise<string | null> {
  const { repairPort, repairCheckpoint } = prepared;
  if (!launch.repairAttempted || !repairCheckpoint) { return null; }
  const checkpoints = preparedCheckpointSet(prepared);
  try {
    for (const checkpoint of checkpoints) {
      await repairPort!.recordAttempt?.(slug, checkpoint.name, attempt);
    }
    return null;
  } catch (cause) { return `Repair attempt accounting failed after launch: ${String(cause)}`; }
}

/** Reads the first blocker from the prepared checkpoint set. */
export async function readRepairCheckpointBlocker(slug: string,
  prepared: PreparedRepairPrompt): Promise<InvalidContractBlocker | undefined> {
  const { repairPort } = prepared;
  let blocker: InvalidContractBlocker | undefined;
  for (const checkpoint of preparedCheckpointSet(prepared)) {
    blocker ??= await repairPort!.readBlocker(slug, checkpoint.name);
  }
  return blocker;
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
  const obligations = state.repairObligations?.length ? state.repairObligations : null;
  await captureAggregateEvidence(state, context, obligations, command);
  const opened = await openRepairCheckpointSet(
    state, context, obligations, repairPort, command, attempt, maxAttempts);
  const { repairCheckpoint } = opened;
  const repairCheckpointRefs = obligations && opened.repairCheckpointRefs.length
    ? opened.repairCheckpointRefs : undefined;
  const lookup = recoveryPromptLookup(context);
  const slots = { label: state.classification.label, slug, worktree, diagnostic: state.diagnostic,
    originalDiagnostic: state.originalDiagnostic, classification: state.classification, attempt, maxAttempts,
    ...promptSlotsFor(state.reason, slug), ...lookup,
    recoveryEvidence: state.capturedEvidence ?? lookup.recoveryEvidence,
    recoveryEvidenceAll: state.aggregateEvidence?.flatMap(item => item.evidence ? [{ gateKey: item.gateKey, evidence: item.evidence }] : []),
    repairCheckpoint, ...(repairCheckpointRefs ? { repairCheckpointRefs } : {}) };
  const fixPrompt = buildFreshDiagnosticRepairPrompt(slots);
  return { fixPrompt, repairPort, repairCheckpoint, ...(repairCheckpointRefs ? { repairCheckpointRefs } : {}) };
}

function repairCommand(reason: ReboundReason): string {
  return reason.kind === 'gate-failure' || reason.kind === 'declared-gate-validation'
    ? reason.command : NON_GATE_REPAIR_COMMANDS[reason.kind];
}

async function captureAggregateEvidence(state: RepairPromptState, context: ReboundContext,
  obligations: ReboundContext['repairObligations'] | null, command: string): Promise<void> {
  if (!obligations) { return; }
  state.aggregateEvidence ??= [];
  for (const obligation of obligations) {
    if (state.aggregateEvidence.some(item => item.gateKey === obligation.gateKey)) { continue; }
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
  command: string, attempt: number, maxAttempts: number): Promise<{ repairCheckpoint: { name: string; version: number } | null;
    repairCheckpointRefs: RepairCheckpointRef[] }> {
  const refs: RepairCheckpointRef[] = [];
  if (obligations) {
    for (const obligation of obligations) {
      const evidence = state.aggregateEvidence?.find(item => item.gateKey === obligation.gateKey)?.evidence;
      const opened = await repairPort?.open({ slug: context.slug, incidentId: state.occurrenceId,
        gateKey: obligation.gateKey, command: obligation.reason.command, attempt, maxAttempts,
        ...failureOccurrence(obligation.reason.command, context.worktree, evidence) });
      if (opened) { refs.push({ gateKey: obligation.gateKey, command: obligation.reason.command, ...opened }); }
    }
    return { repairCheckpoint: refs[0] ?? null, repairCheckpointRefs: refs };
  }
  const repairCheckpoint = await repairPort?.open({ slug: context.slug, incidentId: state.occurrenceId,
    command, attempt, maxAttempts, ...failureOccurrence(command, context.worktree, state.capturedEvidence) }) ?? null;
  return { repairCheckpoint, repairCheckpointRefs: refs };
}

function recoveryPromptLookup(context: ReboundContext) {
  if (context.retainedFailure || !context.worktree) { return {}; }
  return recoveryEvidenceForPrompt(context.worktree, context.slug);
}

/**
 * Valid fresh evidence already recorded for this identical failure occurrence, as a checkpoint the exact verifier
 * can run against before any implementer launch. Aggregate, workflow and reviewer repairs never reuse it.
 */
export async function recordedRepairCheckpoint(state: RepairPromptState, context: ReboundContext): Promise<PreparedRepairPrompt | null> {
  const repairPort = context.repairCheckpoints ?? repairCheckpointPort();
  if (context.repairPrompt !== undefined || isReviewerOutputFailure(state.reason) || state.repairObligations?.length
    || !repairPort?.recordedEvidence) { return null; }
  const command = repairCommand(state.reason);
  const repairCheckpoint = await repairPort.recordedEvidence({ slug: context.slug, incidentId: state.occurrenceId,
    command, attempt: 1, ...failureOccurrence(command, context.worktree, state.capturedEvidence) });
  return repairCheckpoint ? { fixPrompt: '', repairPort, repairCheckpoint } : null;
}

/** A failed exact check leaves the recorded evidence uncertified, so the repair owes it again. */
export async function discardRecordedEvidence(slug: string, prepared: PreparedRepairPrompt): Promise<void> {
  await prepared.repairPort?.discardEvidence?.(slug, prepared.repairCheckpoint!.name);
}

/** The harness snapshots authority before the exact verifier and certifies only its success. */
export async function runCheckpointVerification(context: ReboundContext, prepared: Awaited<ReturnType<typeof prepareRepairPrompt>>, attempt: number) {
  const { repairPort, repairCheckpoint, repairCheckpointRefs } = prepared;
  const collectionBased = repairCheckpointRefs !== undefined;
  const readHead = async () => await context.readHead?.() ?? context.head ?? null;
  const executionRevision = await readHead();
  const refs = repairCheckpointRefs ?? (repairCheckpoint ? [{ gateKey: '', command: '', ...repairCheckpoint }] : []);
  const snapshots = await Promise.all(refs.map(async ref => ({ ref,
    snapshot: await repairPort?.prepareVerification?.(context.slug, ref.name,
      { worktree: context.worktree, executionRevision }) })));
  if (collectionBased && snapshots.some(item => !item.snapshot)) {
    throw new Error('Every gate repair checkpoint needs fresh authorized evidence before the integration gates rerun');
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
      if (collectionBased) {
        if (checks.length !== refs.length) { throw new Error('Authoritative gate rerun coverage is incomplete'); }
        if (!repairPort?.verifyAll) { throw new Error('Gate repair checkpoint collection authority is unavailable'); }
        await repairPort.verifyAll(context.slug, checks);
      } else if (refs[0]) {
        await repairPort!.verify(context.slug, refs[0].name, ...(checks[0] ? [checks[0].proof] : []));
      }
    }
  } };
}

function preparedCheckpointSet(prepared: PreparedRepairPrompt): readonly { readonly name: string }[] {
  return prepared.repairCheckpointRefs ?? (prepared.repairCheckpoint ? [prepared.repairCheckpoint] : []);
}

function failureOccurrence(command: string, worktree: string, failure?: RecoveryEvidenceRef | null): Pick<OpenRepairCheckpoint, 'worktree' | 'failureRevision' | 'failureEvidenceId'> {
  if (!failure || failure.command !== command || failure.cwd !== worktree || failure.exitCode === 0 || !failure.captureComplete) { return {}; }
  return { worktree, failureRevision: failure.capturedRevision,
    failureEvidenceId: `${failure.incidentId}:${failure.attempt}` };
}
