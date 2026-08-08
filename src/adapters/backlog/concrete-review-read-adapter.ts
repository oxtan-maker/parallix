import type { MissionId } from '../../domain/mission.js';
import type { AgentFamily } from '../../domain/agents.js';
import {
  agentFamily,
} from '../../domain/agents.js';
import type {
  Review,
  ReviewRound,
  ReviewerDecision,
  ReviewedChange,
  ReviewedRevision,
} from '../../domain/review.js';
import {
  changeRevision,
  parseReviewDisposition,
  parseReviewPhase,
  stageLaunchWindowsFrom,
} from '../../domain/review.js';
import type { ReviewReadAdapter } from '../../application/projections/board-readers.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { ReviewState } from '../review/review-state.js';
import { findMissionDir } from '../filesystem/mission-utils.js';
import { readReviewState } from '../review/review-state.js';

// ---------------------------------------------------------------------------
// Parse-primitive types
// ---------------------------------------------------------------------------

type ReadReviewStateFn = (_slug: string, _rootDir?: string, _missionStore?: MissionStore | null) => ReviewState | null | Promise<ReviewState | null>;
type FindMissionDirFn = (_slug: string, _rootDir?: string, _options?: { missionPath?: string }) => string | null;

// ---------------------------------------------------------------------------
// Defaults — static imports (no circular deps)
// ---------------------------------------------------------------------------

function defaultReadReviewState(): ReadReviewStateFn {
  return readReviewState as ReadReviewStateFn;
}

/**
 * The change the review round is about.
 *
 * One helper serves `loadReview` and `loadReviewApproval` so the approval
 * subject and the round subject stay the same value — `sameReviewedRevision`
 * compares them, and a card only reports `reviewApproved` when they match.
 */
function reviewedChangeFrom(state: ReviewState): ReviewedChange {
  const pullRequest = state.pullRequest;
  if (pullRequest) {
    return { ...pullRequest, kind: 'pull-request' };
  }
  return {
    kind: 'local-branch',
    sourceBranch: `mission/${state.slug}`,
    targetBranch: 'main',
  };
}

/** Coerce an untyped metadata counter to a non-negative integer. */
function nonNegativeGateRetries(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function defaultFindMissionDir(): FindMissionDirFn {
  return findMissionDir as FindMissionDirFn;
}

// ---------------------------------------------------------------------------
// Concrete ReviewReadAdapter
// ---------------------------------------------------------------------------

export interface ConcreteReviewReadAdapterOptions {
  readonly rootDir: string;
  /** Mission authority used to read persisted review state. */
  readonly missionStore: MissionStore | null;
  /** Read persisted review state for a mission. */
  readonly readReviewState?: ReadReviewStateFn;
  /** Find mission directory for a slug. */
  readonly findMissionDir?: FindMissionDirFn;
}

/**
 * Concrete `ReviewReadAdapter` that materialises domain `Review` objects
 * from the review state the operator database holds for a mission.
 *
 * Returns typed unavailable/missing results rather than inventing lifecycle
 * state. No review exists → null.
 */
export class ConcreteReviewReadAdapter implements ReviewReadAdapter {
  private readonly rootDir: string;
  private readonly missionStore: MissionStore | null;
  private readonly readReviewState: ReadReviewStateFn;
  private readonly findMissionDir: FindMissionDirFn;

  constructor(options: ConcreteReviewReadAdapterOptions) {
    this.rootDir = options.rootDir;
    this.missionStore = options.missionStore;
    this.readReviewState = options.readReviewState ?? defaultReadReviewState();
    this.findMissionDir = options.findMissionDir ?? defaultFindMissionDir();
  }

  // -----------------------------------------------------------------------
  // ReviewReadAdapter port
  // -----------------------------------------------------------------------

  async loadReview(_missionId: MissionId): Promise<Review | null> {
    const state = await Promise.resolve(this.readReviewState(_missionId, this.rootDir, this.missionStore)) as ReviewState | null;
    if (!state) {
      return null;
    }
    return this.toDomainReview(state);
  }

  async loadReviewApproval(_missionId: MissionId): Promise<{ subject: ReviewedRevision; approvedAt: string | null } | null> {
    const state = await Promise.resolve(this.readReviewState(_missionId, this.rootDir, this.missionStore)) as ReviewState | null;
    if (!state) {
      return null;
    }

    // Approval is indicated by the 'approved' phase
    if (state.phase !== 'approved') {
      return null;
    }

    // Build a minimal ReviewedRevision from the review state data
    const subject: ReviewedRevision = {
      change: reviewedChangeFrom(state),
      revision: changeRevision(state.startedAt || 'unknown'),
    };

    return {
      subject,
      approvedAt: state.startedAt || null,
    };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private toDomainReview(state: ReviewState): Review {
    const reviewer: AgentFamily = (() => {
      try { return agentFamily(state.reviewer || 'codex'); }
      catch { return agentFamily('codex'); }
    })();

    const implementer: AgentFamily = (() => {
      try { return agentFamily(state.implementer || 'codex'); }
      catch { return agentFamily('codex'); }
    })();

    const decision: ReviewerDecision | null = this.decisionFromState(state);

    const round: ReviewRound = {
      number: state.round || 1,
      subject: {
        change: reviewedChangeFrom(state),
        revision: changeRevision(state.startedAt || 'unknown'),
      },
      reviewer,
      implementer,
      startedAt: state.startedAt || new Date().toISOString(),
      decision,
      response: null,
      phase: parseReviewPhase(state.phase) ?? 'reviewing',
      disposition: parseReviewDisposition(state.disposition),
      reviewerRetryCount: state.reviewerRetryCount || 0,
      implementerRetryCount: state.implementerRetryCount || 0,
    };

    return {
      rounds: [round] as [ReviewRound, ...ReviewRound[]],
      intervention: null,
      stageLaunches: stageLaunchWindowsFrom(state.metadata?.recordedStageLaunches),
      gateFailureRetryCount: nonNegativeGateRetries(state.metadata?.gateFailureRetryCount),
      reviewEvents: [],
    };
  }

  private decisionFromState(state: ReviewState): ReviewerDecision | null {
    if (state.phase === 'approved') {
      return {
        kind: 'approved',
        decidedAt: state.startedAt || new Date().toISOString(),
        comment: state.disposition || null,
        source: { kind: 'local' },
      };
    }

    if (state.phase === 'fixing' && state.disposition) {
      return {
        kind: 'changes-requested',
        decidedAt: state.startedAt || new Date().toISOString(),
        comment: state.disposition || null,
        findings: [],
      };
    }

    return null;
  }
}
