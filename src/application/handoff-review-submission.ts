import { isReviewerPoolExhausted } from '../domain/reviewer-assignment-policy.js';
/**
 * Review submission for handoff: choose the reviewer, record legacy checkpoint
 * evidence, bind the review subject to the committed revision, and transition
 * the Mission to review.
 */

import * as path from 'node:path';
import * as fmt from './presentation/cli-format.js';
import { beginNextReviewRound, startReview, ConfiguredReviewerEligibility, changeRevision, reviewStatus, currentReviewRound, replaceCurrentRound } from '../domain/review.js';
import { agentFamily } from '../domain/agents.js';
import { missionId } from '../domain/mission.js';
import type { HandoffLog, HandoffMissionServicesPort, HandoffResult, HandoffWorkflowPorts } from './ports/handoff-workflow.js';
import type { VerifiedCheckpointDocument } from './handoff-contract.js';

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

export class HandoffReviewSubmission {
  private readonly ports: HandoffWorkflowPorts;

  constructor(ports: HandoffWorkflowPorts) {
    this.ports = ports;
  }

  resolveHandoffReviewAssignment(
    implementerName: string,
    options: {
      worktree?: string;
      eligibleAgentsForStepFn?: HandoffWorkflowPorts['agentSelection']['eligibleAgentsForStep'];
      selectAgentFn?: HandoffWorkflowPorts['agentSelection']['selectAgent'];
      preparedSelection?: { select(_step: string, _opts: Record<string, unknown>): string } | null;
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

    try {
      const reviewer = agentFamily(options.preparedSelection
        ? options.preparedSelection.select('review', { excluded: new Set([implementer]) })
        : selectFn('review', {
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
        `No reviewer available besides ${fmt.agent(implementer)}; falling back to self-review for this handoff. `
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
  async submit(slug: string, context: {
    rootDir: string;
    branch: string;
    missionDirPath: string;
    forgejoUser: string;
    submittedPr: { id: string; url: string | null } | null;
    checkpoint: VerifiedCheckpointDocument | null;
    occurredAt: string;
    missionServicesFn: HandoffMissionServicesPort;
    eligibleAgentsForStepFn: HandoffWorkflowPorts['agentSelection']['eligibleAgentsForStep'];
    selectAgentFn: HandoffWorkflowPorts['agentSelection']['selectAgent'];
    log: HandoffLog;
    error: HandoffLog;
  }): Promise<HandoffResult | null> {
    const ports = this.ports;
    const { rootDir, branch, missionDirPath, forgejoUser, submittedPr, checkpoint, occurredAt, missionServicesFn, eligibleAgentsForStepFn, selectAgentFn, log, error } = context;
    const { finalCheckpoint, checkpointContent, evidenceRows } = checkpoint ?? { finalCheckpoint: null, checkpointContent: '', evidenceRows: [] };
    const missionServices = await missionServicesFn(rootDir, { missionDir: missionDirPath });

    // architecture invariant: the checkpoint this handoff verified becomes durable Mission evidence
    // in SQLite. CP-N.md stays an operator-authored input; it is never the
    // authority the review transition reads.
    // Evidence recorded through `px checkpoint record` is already durable, so
    // handoff re-records only when it verified a legacy checkpoint document.
    if (finalCheckpoint) {
    const checkpointName = path.basename(finalCheckpoint).replace(/\.md$/, '');
    const nextActionMatch = checkpointContent.match(/^[ \t]*(?:\*\*)?Next action(?:\*\*)?:[ \t]*(.+)$/mi);
    const checkpointOutcome = await missionServices.checkpoints.record({
      operationId: `handoff-checkpoint-${slug}`,
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
      return { ok: false, error: msg };
    }
    }

    // The review subject records where the branch is headed. A repository without
    // a detectable primary branch still hands off; the target is nominal here.
    let targetBranch = 'main';
    try {
      targetBranch = ports.missionUtils.getPrimaryBranch(rootDir) || 'main';
    } catch {
      targetBranch = 'main';
    }
    const { reviewer, implementer, reviewerEligibility } = this.resolveHandoffReviewAssignment(forgejoUser, {
      worktree: rootDir,
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
      const msg = `Cannot capture the HEAD commit for ${slug}; repair the Git checkout and retry handoff before starting review.`;
      error(msg);
      return { ok: false, error: msg };
    }
    // A mission that already carries a Review is handing back a later round of
    // the same change, not starting a new review. Restarting it would submit
    // round 1 against a recorded round N and the workflow would reject the
    // handoff ("A new review round must advance the same pull request or local
    // branch"); the change identity (pull request or branch) is preserved by
    // advancing the existing aggregate instead.
    const existing = await missionServices.store.load(missionId(slug));
    const loadedReview = existing.kind === 'found' && 'review' in existing.mission
      ? existing.mission.review
      : null;
    // A review with no round carries no change identity to advance, so it is
    // treated as no review at all rather than read for a current round.
    const priorReview = loadedReview && loadedReview.rounds?.length > 0 ? loadedReview : null;
    // AC11: the review subject records the git commit hash the branch is headed
    // to, never a placeholder. Capture it once here so a fresh review round and
    // any later correction bind to the same commit identity.
    const startedAt = occurredAt;
    let reviewForHandoff = priorReview;
    if (reviewForHandoff && reviewStatus(reviewForHandoff) === 'awaiting-implementation') {
      const msg = `Review findings for ${slug} are awaiting an implementer resolution; record the actual finding dispositions before starting the next round.`;
      error(msg);
      return { ok: false, error: msg };
    }
    let review = reviewForHandoff
      ? (reviewStatus(reviewForHandoff) === 'ready-for-next-round'
        ? beginNextReviewRound(reviewForHandoff, reviewer, implementer, startedAt, reviewerEligibility)
        // Undecided round: this handoff is a resubmission of the round already
        // recorded (a relaunch, a retried CLI invocation), so it is submitted
        // unchanged rather than rewritten.
        : reviewForHandoff)
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
    // Repair invalidation has already opened an undecided round. Bind it to
    // the committed repair only when handoff's gates have passed, retaining
    // the revoked decision and its original subject in the preceding round.
    if (priorReview && existing.kind === 'found' && existing.mission.status === 'active'
      && reviewStatus(priorReview) === 'awaiting-review'
      && priorReview.rounds.length > 1) {
      const head = ports.git.git(['-C', rootDir, 'rev-parse', 'HEAD']);
      const repairedHead = (head.stdout ?? '').trim();
      if (head.status !== 0 || !repairedHead) {
        return { ok: false, error: `Cannot read the committed repair revision for ${slug}.` };
      }
      const current = currentReviewRound(review);
      review = { ...review, rounds: replaceCurrentRound(review, {
        ...current, subject: { ...current.subject, revision: changeRevision(repairedHead) },
        reviewer, implementer, startedAt,
      }) };
    }
    const transitionResult = await missionServices.lifecycle.transition({
      operationId: `handoff-transition-${slug}`,
      missionId: missionId(slug),
      capabilities: new Set(['mission:transition']),
      command: {
        type: 'submit-for-review',
        gatesPassed: true,
        review,
        reviewerEligibility,
      },
      actor: reviewer,
      occurredAt,
      // Stable across relaunches so the lane-event UNIQUE constraint deduplicates
      // a retried handoff instead of recording a second entry per attempt.
      idempotencyKey: priorReview ? `handoff-${slug}:round-${currentReviewRound(review).number}` : `handoff-${slug}`,
    });
    if (transitionResult.status !== 'completed') {
      const msg = `Mission state transition failed: ${transitionResult.error?.message || 'unknown'}.`;
      error(msg);
      return { ok: false, error: msg };
    }
    return null;
  }
}
