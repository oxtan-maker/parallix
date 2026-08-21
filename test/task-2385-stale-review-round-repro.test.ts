/**
 * Regression repro for TASK-2385: a flattened review-state write carrying a
 * round number lower than the aggregate's current round used to silently
 * renumber the newest round downward (round 2 -> round 1), which then violated
 * the round uniqueness constraint on the SQLite write and dropped the verdict.
 *
 * Before the fix this file is red: applying `round: 1` to an aggregate holding
 * rounds [1, 2] renumbers round 2 to round 1 and produces a duplicate round.
 * After the fix the stale write is rejected before persistence with a
 * diagnostic naming both the supplied and current round numbers, and equal /
 * higher round writes keep their monotonic numbering.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  applyReviewStateToReview,
} from '../src/adapters/review/review-state-mapping.js';
import { postWorkflowReview } from '../src/adapters/review/review-artifacts.js';
import { ReviewState } from '../src/adapters/review/review-state.js';
import { reviewLoopBindings } from '../src/composition/review-persistence.js';
import { agentFamily } from '../src/domain/agents.js';
import {
  ConfiguredReviewerEligibility,
  changeRevision,
  currentReviewRound,
  Review,
  ReviewRound,
  startReview,
} from '../src/domain/review.js';

function twoRoundReview(): Review {
  const change = { kind: 'local-branch' as const, sourceBranch: 'mission/task-2385', targetBranch: 'main' };
  const reviewer = agentFamily('codex');
  const implementer = agentFamily('claude');
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer] } as never);
  const round1 = startReview({ change, revision: changeRevision('rev-1') }, reviewer, implementer, '2026-08-01T10:00:00.000Z', eligibility);
  const base = round1.rounds[0];
  const round2: ReviewRound = { ...base, number: 2 };
  return { ...round1, rounds: [base, round2] as unknown as Review['rounds'] };
}

describe('TASK-2385 stale review round', () => {
  it('rejects a lower state round without renumbering an existing round', () => {
    const review = twoRoundReview();
    assert.deepEqual(
      review.rounds.map((round) => round.number),
      [1, 2],
      'seeded aggregate holds rounds 1 and 2',
    );

    let message = '';
    try {
      applyReviewStateToReview(review, { reviewer: 'codex', implementer: 'claude', round: 1, phase: 'reviewing' });
    } catch (error) {
      message = (error as Error).message;
    }

    // The stale write must be rejected, not silently applied.
    assert.ok(message, 'a stale lower round must be rejected');
    // The diagnostic must name both the supplied round and the current round.
    assert.match(message, /round 1/, `diagnostic must name the supplied round 1: ${message}`);
    assert.match(message, /round 2/, `diagnostic must name the current round 2: ${message}`);

    // A stale write must not mutate the input aggregate: round 2 stays numbered
    // 2. The rejection itself prevents any duplicate round from being created
    // (the mapper throws before constructing a new round list), so the only
    // observable duplicate-round guarantee is that the input is left intact.
    const numbers = review.rounds.map((round) => round.number);
    assert.deepEqual(numbers, [1, 2], `rejected write must not mutate the input aggregate: ${JSON.stringify(numbers)}`);
    const unique = new Set(numbers);
    assert.equal(unique.size, numbers.length, 'round numbers must remain unique');
  });

  it('updates the current round when the state round equals it', () => {
    const review = twoRoundReview();
    const applied = applyReviewStateToReview(
      review,
      { reviewer: 'codex', implementer: 'claude', round: 2, phase: 'approved', disposition: 'APPROVED' },
    );
    assert.deepEqual(
      applied.rounds.map((round) => round.number),
      [1, 2],
      'equal round must not add or shift rounds',
    );
    assert.equal(currentReviewRound(applied).phase, 'approved');
    assert.equal(currentReviewRound(applied).disposition, 'APPROVED');
  });

  it('advances to a higher round without changing prior round numbers', () => {
    const review = twoRoundReview();
    const applied = applyReviewStateToReview(
      review,
      { reviewer: 'codex', implementer: 'claude', round: 3, phase: 'reviewing' },
    );
    assert.deepEqual(
      applied.rounds.map((round) => round.number),
      [1, 2, 3],
      'a higher round appends without altering rounds 1 and 2',
    );
  });
});

describe('TASK-2385 verdict persistence through the consumeReviewerArtifacts seam', () => {
  /**
   * A 2-round mission in the operator store. Round 2 is current. This test
   * drives the FULL production artifact-consumption path via `reviewLoopBindings`
   * with a real bound store: it does NOT inject `readReviewStateFn` into
   * `postWorkflowReview`, so the verdict can only persist if the production path
   * forwards the bound reader (and `missionStore`) to `recordLocalReviewVerdict`.
   * A regression that drops that forward (TASK-2385 F1) makes the verdict read
   * miss and throws, so this test fails until the forward is present.
   */
  function twoRoundStore() {
    const base = {
      number: 1,
      subject: {
        change: { kind: 'local-branch' as const, sourceBranch: 'mission/task-2385', targetBranch: 'main' },
        revision: 'rev-1',
      },
      reviewer: 'claude',
      implementer: 'codex',
      startedAt: '2026-08-01T10:00:00.000Z',
      decision: null,
      response: null,
      phase: 'reviewing',
      disposition: null,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    };
    const state = { mission: { review: { rounds: [base, { ...base, number: 2 }], intervention: null, stageLaunches: [], reviewEvents: [] } as any }, version: 1, saves: [] as unknown[] };
    return {
      state,
      async load() { return { kind: 'found', mission: state.mission, version: state.version }; },
      async save(mission: any) { state.mission = mission; state.version += 1; state.saves.push(mission); return state.version; },
      async saveWithTransition(mission: any) { return this.save(mission); },
    };
  }

  function artifactDir(files: Record<string, string>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2385-'));
    for (const [name, content] of Object.entries(files)) { fs.writeFileSync(path.join(dir, name), content, 'utf8'); }
    return dir;
  }

  it('records an approve verdict onto the stored round 2 through the bound consumption path', async () => {
    const store = twoRoundStore();
    const tmpDir = artifactDir({
      'task-2385-review-findings.md': 'No blocking findings.',
      'task-2385-review-outcome.md': 'Verdict: approve',
      'task-2385-review-verdict.txt': 'approve',
    });
    let providerReviewCalled = false;

    const result = await reviewLoopBindings(store as never).consumeReviewerArtifactsFn('task-2385', 'claude', {
      worktree: tmpDir,
      tmpDir,
      providerEnabled: true,
      readTokenFn: () => 'mock-token',
      postCommentFn: () => ({ ok: true }),
      // Self-author: claude is the reviewer AND the PR author, so the provider
      // review POST is skipped and the verdict must persist locally on round 2.
      getPrAuthorFn: () => 'claude',
      postReviewFn: () => { providerReviewCalled = true; return { ok: true }; },
    });

    assert.equal(result.ok, true, 'the bound consumption path consumes the artifacts');
    assert.equal(providerReviewCalled, false, 'a self-author verdict skips the provider review POST');
    // The persisted verdict survives on round 2, not a fabricated round 1, and
    // round 1 keeps its number: the stale-round invariant holds end to end.
    assert.equal(store.state.mission.review.rounds[1].disposition, 'APPROVED', 'the approve verdict persists on the current round 2');
    assert.equal(store.state.mission.review.rounds[1].phase, 'approved', 'round 2 transitions to the approved phase');
    assert.deepEqual(
      store.state.mission.review.rounds.map((round: any) => round.number),
      [1, 2],
      'round numbers stay 1 and 2 after the verdict persists',
    );
  });
});

describe('TASK-2385 verdict recording read miss', () => {
  it('fails closed when review state cannot be read instead of fabricating round 1', async () => {
    let verdictStateWritten = false;
    await assert.rejects(
      postWorkflowReview('task-2385-verdict', 'approve', 'looks good', {
        forgejoUser: 'reviewer-agent',
        readTokenFn: () => 'mock-token',
        getPrAuthorFn: () => 'reviewer-agent', // self-author => local verdict path
        postReviewFn: () => ({ ok: true }),
        readReviewStateFn: () => null, // read miss: no review state
        writeReviewStateFn: () => {
          verdictStateWritten = true;
          return Promise.resolve({ outcome: 'committed' as const });
        },
        createEventFn: () => ({ ok: true, path: '/mock' }),
        buildMetadataFooterFn: () => '',
        log: () => {},
        error: () => {},
      }),
      /no review state found|fabricate round 1/i,
      'a verdict read miss must fail closed rather than record a fabricated round 1',
    );
    assert.equal(verdictStateWritten, false, 'no verdict state must be written on a read miss');
  });
});

describe('TASK-2385 verdict persistence to the Review aggregate', () => {
  it('records an approve verdict onto the current round without renumbering it', async () => {
    let captured: unknown;
    const result = await postWorkflowReview(
      'task-2385-persist',
      'approve',
      'looks good',
      {
        forgejoUser: 'reviewer-agent',
        readTokenFn: () => 'mock-token',
        getPrAuthorFn: () => 'reviewer-agent', // self-author => local verdict path
        readReviewStateFn: () => ({ round: 2, phase: 'reviewing', reviewer: 'claude', implementer: 'codex' }),
        writeReviewStateFn: (_slug: string, state: unknown) => {
          captured = state;
          return Promise.resolve({ outcome: 'committed' as const });
        },
        createEventFn: () => ({ ok: true, path: '/mock' }),
        buildMetadataFooterFn: () => '',
        log: () => {},
        error: () => {},
      },
    );

    assert.equal(result.ok, true, 'the self-author local verdict path records and returns ok');
    assert.equal(result.skipped, true, 'the provider POST is skipped on self-approval');
    assert.ok(captured instanceof ReviewState, 'the persisted verdict is a ReviewState aggregate');
    const capturedState = captured as ReviewState;
    assert.equal(capturedState.round, 2, 'the verdict attaches to the current round 2, not a fabricated round 1');
    assert.equal(capturedState.disposition, 'APPROVED', 'the approve verdict is recorded as APPROVED on the round');
    assert.equal(capturedState.phase, 'approved', 'the round transitions to the approved phase');
  });
});
