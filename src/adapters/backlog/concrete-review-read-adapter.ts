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
import { changeRevision } from '../../domain/review.js';
import type { ReviewReadAdapter } from '../../application/projections/board-readers.js';
import type { ReviewState } from '../../platform/runtime/lib/review/review-state.js';

// ---------------------------------------------------------------------------
// Parse-primitive types
// ---------------------------------------------------------------------------

type ReadReviewStateFn = (_slug: string, _rootDir?: string) => ReviewState | null;
type FindMissionDirFn = (_slug: string, _rootDir?: string, _options?: { missionPath?: string }) => string | null;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultReadReviewState(): ReadReviewStateFn {
  const { readReviewState } = require('../../platform/runtime/lib/review/review-state.js');
  return readReviewState as ReadReviewStateFn;
}

function defaultFindMissionDir(): FindMissionDirFn {
  const { findMissionDir } = require('../../platform/runtime/lib/core/mission-utils.js');
  return findMissionDir as FindMissionDirFn;
}

// ---------------------------------------------------------------------------
// Concrete ReviewReadAdapter
// ---------------------------------------------------------------------------

export interface ConcreteReviewReadAdapterOptions {
  readonly rootDir: string;
  /** Read persisted review state for a mission. */
  readonly readReviewState?: ReadReviewStateFn;
  /** Find mission directory for a slug. */
  readonly findMissionDir?: FindMissionDirFn;
}

/**
 * Concrete `ReviewReadAdapter` that materialises domain `Review` objects
 * from Git-owned review-state artifacts (`review-state.json` in mission dirs).
 *
 * Returns typed unavailable/missing results rather than inventing lifecycle
 * state. No review exists → null.
 */
export class ConcreteReviewReadAdapter implements ReviewReadAdapter {
  private readonly rootDir: string;
  private readonly readReviewState: ReadReviewStateFn;
  private readonly findMissionDir: FindMissionDirFn;

  constructor(options: ConcreteReviewReadAdapterOptions) {
    this.rootDir = options.rootDir;
    this.readReviewState = options.readReviewState ?? defaultReadReviewState();
    this.findMissionDir = options.findMissionDir ?? defaultFindMissionDir();
  }

  // -----------------------------------------------------------------------
  // ReviewReadAdapter port
  // -----------------------------------------------------------------------

  async loadReview(_missionId: MissionId): Promise<Review | null> {
    const state = this.readReviewState(_missionId, this.rootDir);
    if (!state) {
      return null;
    }
    return this.toDomainReview(state);
  }

  async loadReviewApproval(_missionId: MissionId): Promise<{ subject: ReviewedRevision; approvedAt: string | null } | null> {
    const state = this.readReviewState(_missionId, this.rootDir);
    if (!state) {
      return null;
    }

    // Approval is indicated by the 'approved' phase
    if (state.phase !== 'approved') {
      return null;
    }

    // Build a minimal ReviewedRevision from the review state data
    const subject: ReviewedRevision = {
      change: {
        kind: 'local-branch',
        sourceBranch: `mission/${_missionId}`,
        targetBranch: 'main',
      } as ReviewedChange,
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
        change: {
          kind: 'local-branch',
          sourceBranch: `mission/${state.slug}`,
          targetBranch: 'main',
        } as ReviewedChange,
        revision: changeRevision(state.startedAt || 'unknown'),
      },
      reviewer,
      implementer,
      startedAt: state.startedAt || new Date().toISOString(),
      decision,
      response: null,
    };

    return {
      rounds: [round] as [ReviewRound, ...ReviewRound[]],
      intervention: null,
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
