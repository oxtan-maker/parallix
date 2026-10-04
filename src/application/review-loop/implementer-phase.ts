/**
 * The implementer half of a round: launch act-on-review, consume and recover
 * its disposition, and decide the next step — another review round, a stop for
 * a blocked/parked implementer, or human escalation when no new revision exists.
 */
import { currentReviewRound } from '../../domain/review.js';
import { missionId } from '../../domain/mission.js';
import { DEFAULT_REBOUND_ATTEMPTS, rebound } from '../rebound-kernel.js';
import { isArtifactInfraDiagnostic, isPollTimeout, type ImplementerArtifactFacts } from '../ports/review-round.js';
import { adoptLaunchedAgent, elapsedSince, reboundCollaborators, type LoopContext, type ReviewRound } from './round.js';

const CONTINUE_DISPOSITIONS = new Set(['BLOCKED', 'PARKED']);

/** Implementer-phase scratch for one round. */
interface Disposition {
  value: unknown;
  /** A stale BLOCKED/PARKED found on --continue: the implementer is relaunched. */
  reLaunch: boolean;
  sinceIso: string;
  /** The disposition predates this run, so no relaunch produced a revision. */
  skippedLaunch: boolean;
  implementerExited: boolean;
}

type Step = 'stop' | 'next-round';

/**
 * A --continue re-enters its round with a disposition check: an existing
 * BLOCKED/PARKED relaunches the implementer to assess the blocker; any other
 * disposition is answered without a launch.
 */
async function existingDispositionOnContinue(context: LoopContext, round: ReviewRound, disposition: Disposition): Promise<void> {
  const { ports, state, identities } = context;
  if (!(context.isContinue && round.attempt === state.round)) { return; }
  if (!ports.provider) {
    if (context.verbose) {
      context.emit({ kind: 'local-disposition', attempt: round.attempt });
    }
    return;
  }
  context.emit({ kind: 'disposition-probe', attempt: round.attempt, implementer: identities.implementer, startedAt: state.startedAt });
  const existing = await ports.provider.pollDisposition(identities.implementer, state.startedAt, { label: `round ${round.attempt} skip-check`, quick: true });
  if (isPollTimeout(existing)) { return; }
  if (CONTINUE_DISPOSITIONS.has(existing as string)) {
    context.emit({ kind: 'stale-disposition', attempt: round.attempt, existing: existing as string });
    disposition.reLaunch = true;
    disposition.sinceIso = strictlyLaterIso(state.startedAt);
    return;
  }
  disposition.value = existing;
}

/** An instant strictly after `earlierIso`, so a fresh disposition cannot match the stale one. */
export function strictlyLaterIso(earlierIso: string, nowMs = Date.now()): string {
  const earlierMs = Date.parse(earlierIso);
  if (!Number.isFinite(earlierMs)) { return new Date(nowMs).toISOString(); }
  return new Date(Math.max(nowMs, earlierMs + 1)).toISOString();
}

/** Persist the request-changes outcome and launch act-on-review. */
async function launchImplementer(context: LoopContext, round: ReviewRound, reviewState: unknown, disposition: Disposition): Promise<'stop' | null> {
  const { ports, state, identities } = context;
  if (context.dryRun) {
    context.emit({ kind: 'implementer-dry-run-header', implementer: identities.implementer });
    context.emit({ kind: 'implementer-dry-run-prompt', prompt: ports.agents.dryRunPrompt('implementer', round.promptFacts()) });
    if (disposition.reLaunch) {
      context.emit({ kind: 'disposition-relaunched', attempt: round.attempt });
    }
    return 'stop';
  }
  await ports.state.persist(state);
  context.emit({ kind: 'review-verdict', disposition: state.disposition, findings: round.blockingFindings, verbose: context.verbose });
  if (round.blockingFindings.length > 0) {
    context.emit({ kind: 'acting-on-review' });
    for (const finding of round.blockingFindings) {
      context.emit({ kind: 'acting-on-finding', id: finding.id, summary: finding.summary });
    }
  }
  await ports.task.mirror('active', identities.implementer);
  if (identities.implementer === 'autonomous' && !ports.provider) {
    context.emit({ kind: 'autonomous-implementer', attempt: round.attempt });
    return null;
  }
  context.emit({ kind: 'implementer-launching', attempt: round.attempt, implementer: identities.implementer });
  let launch;
  try {
    launch = await ports.agents.launch({ role: 'implementer', agent: identities.implementer, exclude: [identities.reviewer], prompt: round.promptFacts(reviewState) });
  } catch (err: unknown) {
    context.emit({ kind: 'implementer-launch-failed', implementer: identities.implementer, message: (err as Error).message });
    context.exit(1);
    return 'stop';
  }
  await adoptLaunchedAgent(context, 'implementer', identities.implementer, launch);
  disposition.implementerExited = launch?.result?.status === 0;
  await ports.agents.recordStage('implementer', state, identities, launch);
  context.emit({ kind: 'implementer-completed', attempt: round.attempt, implementer: identities.implementer });
  return null;
}

/**
 * A resolution may commit to Mission authority while the implementer still
 * runs. Accept it only for this exact implementer turn: same round, same
 * implementer, CHANGES_MADE, and a resulting revision equal to the branch tip.
 */
async function storedImplementerResolution(context: LoopContext): Promise<string | null> {
  const store = context.ports.missionStore;
  if (!store) { return null; }
  try {
    const loaded = await store.load(missionId(context.slug));
    if (loaded.kind !== 'found' || !loaded.mission.review) { return null; }
    const round = currentReviewRound(loaded.mission.review);
    if (round.number !== context.state.round || round.implementer !== context.identities.implementer || round.disposition !== 'CHANGES_MADE' || !round.response) {
      return null;
    }
    const revision = context.ports.preReview.head();
    return revision && round.response.resultingRevision === revision ? 'CHANGES_MADE' : null;
  } catch {
    return null;
  }
}

function implementerDiagnostic(context: LoopContext, artifacts: ImplementerArtifactFacts, fallback: string): string {
  return artifacts.diagnostic || (artifacts.consumed ? `Implementer ${context.identities.implementer} ${fallback}` : `Implementer ${context.identities.implementer} completed with no protocol output`);
}

/**
 * Consume the implementer's output; incomplete output is relaunched through one
 * rebound occurrence, and an infrastructure failure or spent budget escalates.
 */
async function consumeImplementerOutput(context: LoopContext, round: ReviewRound, reviewState: unknown, disposition: Disposition): Promise<'stop' | null> {
  const { ports, state, identities, slug } = context;
  let artifacts = await ports.artifacts.consumeImplementer(identities.implementer, state);
  if (!artifacts.consumed && disposition.implementerExited) {
    const stored = await storedImplementerResolution(context);
    if (stored) {
      disposition.value = stored;
      context.emit({ kind: 'stored-resolution', attempt: round.attempt, implementer: identities.implementer });
      return null;
    }
    context.emit({ kind: 'missing-implementer-output', attempt: round.attempt, implementer: identities.implementer });
  }
  if (!artifacts.consumed && !disposition.implementerExited) { return null; }
  if (artifacts.changedRevision === false) {
    await context.escalateToHumanReview('IMPLEMENTER_NO_CHANGE');
    return 'stop';
  }
  if (artifacts.ok) {
    disposition.value = artifacts.disposition;
    return null;
  }
  const diagnostic = implementerDiagnostic(context, artifacts, 'produced incomplete or invalid artifacts');
  if (isArtifactInfraDiagnostic(diagnostic)) {
    context.emit({ kind: 'implementer-artifact-infra', diagnostic: diagnostic });
    await context.escalateToHumanReview('IMPLEMENTER_ARTIFACT_INFRA_FAILURE');
    return 'stop';
  }
  if (round.capReached()) { return await round.stopForCap('implementer artifact'); }
  let stored: string | null = null;
  const maxAttempts = round.occurrenceBudget(DEFAULT_REBOUND_ATTEMPTS);
  const recovery = await rebound({ kind: 'artifact-incomplete', role: 'implementer', diagnostic }, {
    ...reboundCollaborators(context, 'implementer', () => round.promptFacts(reviewState)),
    implementer: identities.implementer, maxAttempts,
    verify: async () => {
      artifacts = await ports.artifacts.consumeImplementer(identities.implementer);
      if (!artifacts.consumed) {
        stored = await storedImplementerResolution(context);
        if (stored) {
          context.emit({ kind: 'stored-recovery-resolution', attempt: round.attempt, implementer: identities.implementer });
          return { ok: true };
        }
        return { ok: false, diagnostic: `Implementer ${identities.implementer} produced no round artifacts after the relaunch` };
      }
      return artifacts.ok ? { ok: true } : { ok: false, diagnostic: artifacts.diagnostic || `Implementer ${identities.implementer} still produced incomplete artifacts after the relaunch` };
    },
  });
  round.used += recovery.attempts ?? 0;
  identities.implementer = recovery.implementer || identities.implementer;
  if (recovery.outcome !== 'fixed') {
    if (recovery.outcome === 'human-only' || isArtifactInfraDiagnostic(recovery.diagnostic)) {
      context.emit({ kind: 'implementer-recovery-human', slug: slug });
      await context.escalateToHumanReview('IMPLEMENTER_ARTIFACT_INFRA_FAILURE');
      return 'stop';
    }
    if (round.capReached()) { return await round.stopForCap('implementer artifact'); }
    context.emit({ kind: 'implementer-recovery-exhausted', maxAttempts: maxAttempts, slug: slug });
    await context.escalateToHumanReview('IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED');
    return 'stop';
  }
  context.emit({ kind: 'implementer-artifacts-recovered', attempts: recovery.attempts });
  disposition.value = (artifacts.consumed ? artifacts.disposition : null) || stored;
  return null;
}

/** Poll for the disposition; a timeout relaunches the implementer through the kernel. */
async function pollDisposition(context: LoopContext, round: ReviewRound, reviewState: unknown, disposition: Disposition): Promise<'stop' | null> {
  const { ports, state, identities } = context;
  if (!disposition.value && ports.provider) {
    disposition.value = await ports.provider.pollDisposition(identities.implementer, disposition.sinceIso, { label: `round ${round.attempt} disposition`, retryCount: 0 });
  }
  if (!isPollTimeout(disposition.value)) {
    if (disposition.value) { return null; }
    context.emit({ kind: 'missing-disposition', implementer: identities.implementer });
    context.exit(1);
    return 'stop';
  }
  const recovery = await rebound({
    kind: 'agent-timeout', role: 'implementer',
    diagnostic: `No implementer disposition for ${ports.branch} after ${elapsedSince(state.startedAt)}.`,
    expectedOutput: 'a disposition: PUSHBACK_ALL, BLOCKED, PARKED, or a completed fix response',
  }, {
    ...reboundCollaborators(context, 'implementer', () => round.promptFacts(reviewState)),
    implementer: identities.implementer, step: 'act-on-review', role: 'implementer', exclude: [identities.reviewer],
    maxAttempts: round.occurrenceBudget(DEFAULT_REBOUND_ATTEMPTS),
    verify: async () => {
      const retry = await ports.artifacts.consumeImplementer(identities.implementer);
      const retryArtifactDiagnostic = retry.diagnostic || `Implementer disposition still missing for ${ports.branch}`;
      const diagnostic = isArtifactInfraDiagnostic(retryArtifactDiagnostic) ? `Recovery infrastructure failure: ${retryArtifactDiagnostic}` : retryArtifactDiagnostic;
      disposition.value = retry.consumed && retry.ok ? retry.disposition : null;
      if (!disposition.value && ports.provider) {
        disposition.value = await ports.provider.pollDisposition(identities.implementer, disposition.sinceIso, { label: `round ${round.attempt} disposition recovery`, retryCount: 0 });
      }
      return disposition.value && !isPollTimeout(disposition.value)
        ? { ok: true }
        : { ok: false, diagnostic, reason: { kind: 'artifact-incomplete', role: 'implementer', diagnostic } };
    },
  });
  round.used += recovery.attempts;
  identities.implementer = recovery.implementer || identities.implementer;
  if (recovery.outcome === 'fixed') { return null; }
  if (isArtifactInfraDiagnostic(recovery.diagnostic)) {
    context.emit({ kind: 'implementer-timeout-infra', diagnostic: recovery.diagnostic });
    await context.escalateToHumanReview('IMPLEMENTER_ARTIFACT_INFRA_FAILURE');
    return 'stop';
  }
  if (round.capReached()) { return await round.stopForCap('implementer timeout recovery'); }
  await ports.state.persist(state);
  context.emit({ kind: 'implementer-timeout-exhausted', dossier: recovery.dossier, branch: ports.branch });
  await context.escalateToHumanReview('IMPLEMENTER_TIMEOUT_EXHAUSTED');
  return 'stop';
}

/** Turn the final disposition into the next step. */
async function applyDisposition(context: LoopContext, round: ReviewRound, disposition: Disposition, preFixHead: string | null): Promise<Step> {
  const { ports, state } = context;
  const value = disposition.value as string;
  context.emit({ kind: 'implementer-disposition', attempt: round.attempt, value: value });
  state.disposition = value;
  if (value === 'PUSHBACK_ALL') {
    try { state.transitionTo('reviewing'); } catch { /* already reviewing */ }
    await ports.state.persist(state);
    context.emit({ kind: 'pushback-next-round', attempt: round.attempt });
    return 'next-round';
  }
  if (CONTINUE_DISPOSITIONS.has(value)) {
    await ports.state.persist(state);
    await ports.output.onAutonomousStop?.(`implementer reported ${value}`);
    context.emit({ kind: 'implementer-stopped', value: value });
    return 'stop';
  }
  try { state.transitionTo('reviewing'); } catch { /* already reviewing */ }
  const postFixHead = ports.preReview.head();
  const hasCommittedChange = disposition.skippedLaunch || preFixHead === null || postFixHead === null || postFixHead !== preFixHead;
  if (!hasCommittedChange) {
    state.disposition = 'IMPLEMENTER_NO_CHANGE';
    state.metadata = { ...state.metadata, humanEscalationReason: 'IMPLEMENTER_NO_CHANGE', humanEscalatedAt: new Date().toISOString() };
    await ports.state.persist(state);
    await ports.output.onAutonomousStop?.('implementer reported CHANGES_MADE with no new revision');
    context.emit({ kind: 'implementer-no-change', attempt: round.attempt });
    return 'stop';
  }
  const pushed = ports.provider?.publishRevision() ?? null;
  if (pushed) {
    context.emit({ kind: 'revision-published', ok: pushed.ok, attempt: round.attempt, branch: ports.branch, status: pushed.status, detail: pushed.detail });
  }
  await ports.state.persist(state);
  // TASK-2478/criterion 6: the corrected tree is what the next review evaluates.
  const revisedHead = ports.preReview.head();
  if (revisedHead && preFixHead && revisedHead !== preFixHead) {
    context.emit({ kind: 'revision-recorded', attempt: round.attempt, revisedHead: revisedHead });
  }
  context.emit({ kind: 'implementer-next-round', attempt: round.attempt });
  return 'next-round';
}

/** Run the implementer half for a round whose reviewer did not approve. */
export async function runImplementerPhase(context: LoopContext, round: ReviewRound, reviewState: unknown): Promise<Step> {
  const preFixHead = context.ports.preReview.head();
  const disposition: Disposition = { value: undefined, reLaunch: false, sinceIso: context.state.startedAt, skippedLaunch: false, implementerExited: false };
  await existingDispositionOnContinue(context, round, disposition);
  if (disposition.value) {
    context.emit({ kind: 'existing-disposition', attempt: round.attempt, value: disposition.value });
    disposition.skippedLaunch = true;
  } else {
    if (await launchImplementer(context, round, reviewState, disposition)) { return 'stop'; }
    if (await consumeImplementerOutput(context, round, reviewState, disposition)) { return 'stop'; }
    if (await pollDisposition(context, round, reviewState, disposition)) { return 'stop'; }
  }
  return applyDisposition(context, round, disposition, preFixHead);
}
