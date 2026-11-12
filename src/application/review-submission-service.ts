import { failureReason, StructuredFailure } from '../domain/failure-reason.js';
import type { MissionVersion } from './domain-ports.js';
import { integrationRepairNeedsReview } from '../domain/integration-repair-policy.js';
import { classifyReboundReason, type ReboundReason } from '../domain/rebound-policy.js';
import { isReviewerPoolExhausted } from '../domain/reviewer-assignment-policy.js';
import { transitionReviewRepair } from './review-repair-lifecycle.js';
import type { ReviewPreparationMissionServices } from "./ports/review-preparation-workflow.js";
/**
 * Review submission for review preparation: choose the reviewer, record legacy checkpoint
 * evidence, bind the review subject to the committed revision, and transition
 * the Mission to review.
 */

import * as path from 'node:path';
import * as fmt from './presentation/cli-format.js';
import { beginNextReviewRound, startReview, ConfiguredReviewerEligibility, changeRevision, reviewStatus, currentReviewRound, replaceCurrentRound, openRepairFromReview } from '../domain/review.js';
import { agentFamily } from '../domain/agents.js';
import { missionId } from '../domain/mission.js';
import type { ReviewPreparationLog, ReviewPreparationMissionServicesPort, ReviewPreparationResult, ReviewPreparationWorkflowPorts } from "./ports/review-preparation-workflow.js";
import type { VerifiedCheckpointDocument } from "./review-preparation-contract.js";
import type { WorkflowReturnStage } from '../domain/board-event.js';


/**
 * A selection failure that means "no other family is available right now",
 * as opposed to a broken configuration or an unreadable agent policy.
 *
 * Only exhaustion may fall back to self-review. Every other failure — an
 * unreadable agent config, no eligible agents at all, no working launcher —
 * must propagate: silently reviewing your own work is not the right answer to
 * a machine that is misconfigured.
 */
export { isReviewerPoolExhausted } from '../domain/reviewer-assignment-policy.js';

export class ReviewSubmissionService {
  private readonly ports: ReviewPreparationWorkflowPorts;

  constructor(ports: ReviewPreparationWorkflowPorts) {
    this.ports = ports;
  }

  resolveReviewPreparationReviewAssignment(
    implementerName: string,
    options: {
      worktree?: string;
      reviewer?: import('../domain/agents.js').AgentFamily;
      eligibleAgentsForStepFn?: ReviewPreparationWorkflowPorts['agentSelection']['eligibleAgentsForStep'];
      selectAgentFn?: ReviewPreparationWorkflowPorts['agentSelection']['selectAgent'];
      log?: (_msg: string) => void;
    } = {},
  ) {
    const ports = this.ports;
    const implementer = agentFamily(implementerName);
    const eligibleFn = options.eligibleAgentsForStepFn || ports.agentSelection.eligibleAgentsForStep;
    const selectFn = options.selectAgentFn || ports.agentSelection.selectAgent;
    const log = options.log || fmt.log.plain;
    const configured = eligibleFn('review', { worktree: options.worktree });
    const configuredFamilies = configured.map((candidate: string) => agentFamily(candidate));

    if (options.reviewer) {
      if (!configuredFamilies.includes(options.reviewer)) { throw new Error(`Reviewer ${options.reviewer} is not eligible for review`); }
      return { reviewer: options.reviewer, implementer, reviewerEligibility: ConfiguredReviewerEligibility.fromReviewStep({ eligible: configuredFamilies, strategy: 'random' }) };
    }
    try {
      const reviewer = agentFamily(selectFn('review', {
          exclude: new Set([implementerName]),
          worktree: options.worktree,
        }));
      return {
        reviewer,
        implementer,
        reviewerEligibility: ConfiguredReviewerEligibility.fromReviewStep({
          eligible: configuredFamilies,
          strategy: 'random',
        }),
      };
    } catch (error) {
      if (!isReviewerPoolExhausted(error)) { throw error; }
      // The documented single-family escape hatch: this workstation has no other
      // runnable reviewer at this moment. Record the eligibility that actually
      // applied — the implementer's own family — so the round states plainly that
      // it was self-reviewed instead of claiming a reviewer pool it never had.
      log(fmt.status(
        'WARN',
        `No reviewer available besides ${fmt.agent(implementer)}; falling back to self-review for this review preparation. `
        + `${(error as Error).message}`,
      ));
      return {
        reviewer: implementer,
        implementer,
        reviewerEligibility: ConfiguredReviewerEligibility.fromReviewStep({
          eligible: [implementer],
          strategy: 'random',
        }),
      };
    }
  }

  /** Record evidence and move the Mission to review; null means the transition committed. */
  async submit(slug: string, context: SubmissionContext): Promise<ReviewPreparationResult | null> {
    const ports = this.ports;
    const { rootDir, missionDirPath, forgejoUser, checkpoint, occurredAt, missionServicesFn, eligibleAgentsForStepFn, selectAgentFn, log, error } = context;
    const missionServices = await missionServicesFn(rootDir, { missionDir: missionDirPath });

    // architecture invariant: the checkpoint this review preparation verified becomes durable Mission evidence
    // in SQLite. CP-N.md stays an operator-authored input; it is never the
    // authority the review transition reads.
    // Evidence recorded through `px checkpoint record` is already durable, so
    // review preparation re-records only when it verified a legacy checkpoint document.
    const checkpointFailure = await recordLegacyReviewPreparationCheckpoint(slug, checkpoint, missionServices, error);
    if (checkpointFailure) { return checkpointFailure; }

    // The review subject records where the branch is headed. A repository without
    // a detectable primary branch still hands off; the target is nominal here.
    const targetBranch = reviewPreparationTargetBranch(ports, rootDir);
    const { reviewer, implementer, reviewerEligibility } = this.resolveReviewPreparationReviewAssignment(forgejoUser, {
      worktree: rootDir,
      reviewer: context.reviewer,
      eligibleAgentsForStepFn,
      selectAgentFn,
      log,
    });
    // AC11: capture the commit hash the branch is headed to. A review subject
    // is a git commit hash, never a placeholder, so an approval of A covers A
    // (plus whitelisted bookkeeping) and a moved branch is provably stale.
    const reviewHeadSha = (() => {
      try {
        const head = ports.git.git(['-C', rootDir, 'rev-parse', 'HEAD']);
        if (head.status === 0 && head.stdout?.trim()) { return head.stdout.trim(); }
      } catch { /* Report a failed revision capture below. */ }
      return null;
    })();
    if (!reviewHeadSha) {
      const msg = `Cannot capture the HEAD commit for ${slug}; repair the Git checkout and retry review preparation before starting review.`;
      error(msg);
      return { ok: false, error: msg, failureReason: failureReason('state-machine', 'lifecycle') };
    }
    // A mission that already carries a Review is handing back a later round of
    // the same change, not starting a new review. Restarting it would submit
    // round 1 against a recorded round N and the workflow would reject the
    // review preparation ("A new review round must advance the same pull request or local
    // branch"); the change identity (pull request or branch) is preserved by
    // advancing the existing aggregate instead.
    const existing = await missionServices.store.load(missionId(slug));
    const priorReview = priorReviewPreparationReview(existing);
    // AC11: the review subject records the git commit hash the branch is headed
    // to, never a placeholder. Capture it once here so a fresh review round and
    // any later correction bind to the same commit identity.
    const reviewForReviewPreparation = priorReview;
    if (reviewForReviewPreparation && reviewStatus(reviewForReviewPreparation) === 'awaiting-implementation') {
      const msg = `Review findings for ${slug} are awaiting an implementer resolution; record the actual finding dispositions before starting the next round.`;
      error(msg);
      return { ok: false, error: msg, failureReason: failureReason('state-machine', 'lifecycle') };
    }
    let review = reviewSubmissionRound(reviewForReviewPreparation, { reviewer, implementer, reviewerEligibility }, context, targetBranch, reviewHeadSha);
    // Repair invalidation has already opened an undecided round. Bind it to
    // the committed repair only when review preparation's gates have passed, retaining
    // the revoked decision and its original subject in the preceding round.
    review = bindCommittedReviewPreparationRepair(review, priorReview, existing, context, { reviewer, implementer, reviewerEligibility }, reviewHeadSha);
    const transitionResult = await missionServices.lifecycle.transition({
      operationId: `review-preparation-transition-${slug}`,
      missionId: missionId(slug),
      capabilities: new Set(['mission:transition']),
      command: {
        type: 'submit-for-review',
        gatesPassed: true,
        preparedRevision: changeRevision(reviewHeadSha),
        review,
        reviewerEligibility,
      },
      actor: reviewer,
      occurredAt,
      // Stable across relaunches so the lane-event UNIQUE constraint deduplicates
      // a retried review preparation instead of recording a second entry per attempt.
      idempotencyKey: priorReview ? `review-preparation-${slug}:round-${currentReviewRound(review).number}` : `review-preparation-${slug}`,
    });
    if (transitionResult.status !== 'completed') {
      const msg = `Mission state transition failed: ${transitionResult.error?.message || 'unknown'}.`;
      error(msg);
      const reason = transitionResult.error?.failureReason ?? failureReason('state-machine', 'lifecycle', { operation: 'submit-for-review' });
      return { ok: false, error: msg, failureReason: reason, recoveryFailure: { kind: 'review-preparation-verification', error: msg, failureReason: reason } };
    }
    return null;
  }
}

/** Stage entry records intent, without inventing a Review subject or verification. */
export async function beginReviewPreparation(slug: string, services: Pick<ReviewPreparationMissionServices, 'store' | 'lifecycle'>): Promise<MissionVersion> {
  const loaded = await services.store.load(missionId(slug));
  if (loaded.kind !== 'found') { throw new Error(`The operator database holds no Mission ${slug}; review preparation cannot read its recorded contract.`); }
  if (loaded.mission.status === 'review') { return loaded.version; }
  const result = await services.lifecycle.transition({
    operationId: `review-preparation:${slug}`, missionId: loaded.mission.id, expectedVersion: loaded.version,
    capabilities: new Set(['mission:transition']), command: { type: 'begin-review-preparation' },
    actor: loaded.mission.assignee ?? 'review', occurredAt: new Date().toISOString(),
    idempotencyKey: `review-preparation:${slug}:${loaded.version}`,
  });
  if (result.status !== 'completed' || !result.value) { throw new StructuredFailure(result.error?.message ?? 'Cannot enter review preparation', result.error?.failureReason ?? failureReason('state-machine', 'lifecycle', { operation: 'begin-review-preparation' })); }
  return result.value.version;
}

/** Reuse the planned checkpoint owner for concrete implementation/evidence repairs. */
export async function recordReviewPreparationFailure(slug: string, diagnostic: string,
  services: Pick<ReviewPreparationMissionServices, 'store' | 'lifecycle' | 'checkpoints'>,
  reason: ReboundReason, returnStage: WorkflowReturnStage): Promise<void> {
  const action = classifyReboundReason(reason).dispatchAction;
  if (action !== 'AutoSendBack') { return; }
  const loaded = await services.store.load(missionId(slug));
  if (loaded.kind !== 'found' || !loaded.mission.assignee) { return; }
  await transitionReviewRepair(slug,
    { destination: 'active', sourceStage: returnStage }, loaded.mission.assignee, services.store, services.lifecycle);
  if (reason?.kind === 'gate-failure') { return; } // The gate incident already has its own checkpoint owner.
  const current = await services.store.load(missionId(slug));
  if (current.kind !== 'found' || !services.checkpoints.plan) { return; }
  // A pending plan already tells the implementer what remains. Replays add no work.
  if (current.mission.checkpoints.some(cp => cp.goalCheck.length === 0 || cp.repair && !cp.repair.verified)) { return; }
  if (openRepairFromReview(current.mission.review, current.mission.successCriteria ?? [], current.mission.checkpoints.flatMap(cp => cp.goalCheck))) { return; }
  const number = Math.max(0, ...current.mission.checkpoints.map(cp => Number(cp.name.slice(3)))) + 1;
  const result = await services.checkpoints.plan({
    operationId: `review-preparation-repair:${slug}`, missionId: current.mission.id, expectedVersion: current.version,
    capabilities: new Set(['mission:context']), name: `CP-${number}`, description: `Review preparation repair: ${diagnostic}`.slice(0, 512),
  });
  // Planning enriches recovery; an unavailable optional plan cannot create a new launch gate.
  if (result.status !== 'completed') { return; }
}

type SubmissionContext = {
  reviewer?: import('../domain/agents.js').AgentFamily;
  rootDir: string;
  branch: string;
  missionDirPath: string;
  forgejoUser: string;
  submittedPr: { id: string; url: string | null } | null;
  checkpoint: VerifiedCheckpointDocument | null;
  occurredAt: string;
  missionServicesFn: ReviewPreparationMissionServicesPort;
  eligibleAgentsForStepFn: ReviewPreparationWorkflowPorts['agentSelection']['eligibleAgentsForStep'];
  selectAgentFn: ReviewPreparationWorkflowPorts['agentSelection']['selectAgent'];
  log: ReviewPreparationLog;
  error: ReviewPreparationLog;
};
type MissionServices = Awaited<ReturnType<ReviewPreparationMissionServicesPort>>;

async function recordLegacyReviewPreparationCheckpoint(slug: string, checkpoint: VerifiedCheckpointDocument | null, missionServices: MissionServices, error: ReviewPreparationLog): Promise<ReviewPreparationResult | null> {
  const { finalCheckpoint, checkpointContent, evidenceRows } = checkpoint ?? { finalCheckpoint: null, checkpointContent: '', evidenceRows: [] };
  if (finalCheckpoint) {
    const checkpointName = path.basename(finalCheckpoint).replace(/\.md$/, '');
    const nextActionMatch = checkpointContent.match(/^[ \t]*(?:\*\*)?Next action(?:\*\*)?:[ \t]*(\S.*)$/mi);
    const checkpointOutcome = await missionServices.checkpoints.record({
      operationId: `review-preparation-checkpoint-${slug}`,
      missionId: missionId(slug),
      capabilities: new Set(['checkpoint:record']),
      checkpoint: {
        missionId: missionId(slug),
        name: checkpointName,
        rawFilename: path.basename(finalCheckpoint),
        firstLine: (checkpointContent.split('\n')[0] || '').replace(/^#+\s*/, ''),
        goalCheck: evidenceRows.map((row) => {
          const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
          return { criterion: cells[0] || '', evidence: cells[1] || '' };
        }),
        nextActionText: nextActionMatch ? nextActionMatch[1].trim() : 'Review the handed-off change.',
      },
    });
    if (checkpointOutcome.status !== 'completed') {
      const msg = `Recording checkpoint ${checkpointName} failed: ${checkpointOutcome.error?.message || 'unknown'}.`;
      error(msg);
      return { ok: false, error: msg, failureReason: failureReason('state-machine', 'lifecycle') };
    }
  }

  return null;
}

function reviewPreparationTargetBranch(ports: ReviewPreparationWorkflowPorts, rootDir: string): string {
  let targetBranch = 'main';
  try {
    targetBranch = ports.missionUtils.getPrimaryBranch(rootDir) || 'main';
  } catch {
    targetBranch = 'main';
  }
  return targetBranch;
}

function priorReviewPreparationReview(existing: Awaited<ReturnType<MissionServices['store']['load']>>) {
  const loadedReview = existing.kind === 'found' && 'review' in existing.mission
    ? existing.mission.review
    : null;
  // A review with no round carries no change identity to advance, so it is
  // treated as no review at all rather than read for a current round.
  const priorReview = loadedReview && loadedReview.rounds?.length > 0 ? loadedReview : null;
  return priorReview;
}

function reviewSubmissionRound(reviewForReviewPreparation: import('../domain/review.js').Review | null, assignment: ReturnType<ReviewSubmissionService["resolveReviewPreparationReviewAssignment"]>, context: SubmissionContext, targetBranch: string, reviewHeadSha: string): import('../domain/review.js').Review {
  const { reviewer, implementer, reviewerEligibility } = assignment;
  const { occurredAt: startedAt, submittedPr, branch } = context;
  return reviewForReviewPreparation
    ? (reviewStatus(reviewForReviewPreparation) === 'ready-for-next-round'
      ? beginNextReviewRound(reviewForReviewPreparation, reviewer, implementer, startedAt, reviewerEligibility)
      // Undecided round: this review preparation is a resubmission of the round already
      // recorded (a relaunch, a retried CLI invocation), so it is submitted
      // unchanged rather than rewritten.
      : reviewForReviewPreparation)
    : startReview({
      change: submittedPr
        ? {
          kind: 'pull-request' as const,
          provider: 'forgejo',
          id: submittedPr.id,
          url: submittedPr.url,
          sourceBranch: branch,
          targetBranch,
        }
        : {
          kind: 'local-branch' as const,
          sourceBranch: branch,
          targetBranch,
        },
      revision: changeRevision(reviewHeadSha),
    }, reviewer, implementer, startedAt, reviewerEligibility);
}

function bindCommittedReviewPreparationRepair(review: import('../domain/review.js').Review, priorReview: import('../domain/review.js').Review | null, existing: Awaited<ReturnType<MissionServices['store']['load']>>, context: SubmissionContext, assignment: ReturnType<ReviewSubmissionService["resolveReviewPreparationReviewAssignment"]>, reviewHeadSha: string): import('../domain/review.js').Review {
  const { reviewer, implementer } = assignment;
  const startedAt = context.occurredAt;
  const current = currentReviewRound(review);
  const openedRound = priorReview !== null && current.number > currentReviewRound(priorReview).number;
  if (priorReview && reviewStatus(review) === 'awaiting-review' && (openedRound
    || existing.kind === 'found' && (existing.mission.status === 'active' || existing.mission.reviewPreparationPending
      || integrationRepairNeedsReview(existing.mission)))) {
    review = {
      ...review, rounds: replaceCurrentRound(review, {
        ...current, subject: { ...current.subject, revision: changeRevision(reviewHeadSha) },
        // An undecided legacy projection may still say fixing. Successful
        // preparation returns this verified revision to its owed reviewer;
        // retain publications and the implementer's response as evidence.
        phase: 'reviewing',
        reviewer, implementer, startedAt,
      })
    };
  }
  return review;
}
