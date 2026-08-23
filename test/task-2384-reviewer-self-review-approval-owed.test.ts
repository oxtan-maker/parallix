import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReviewerIdentity } from '../src/adapters/review/review-agent-fallback.js';
import { postWorkflowReview } from '../src/adapters/review/review-artifacts.js';
import { renderStatus } from '../src/interfaces/cli/status.js';

test('exhausted reviewer pool launches the PR author, retains its verdict, and marks formal approval owed', async () => {
  const selectionLogs: string[] = [];
  const selected = resolveReviewerIdentity({
    implementer: 'custom',
    isContinue: false,
    persisted: null,
    agents: ['custom', 'claude', 'codex'],
    selectReviewer: () => { throw new Error('No agents available'); },
    workflowLauncherStatusFn: (agent: string) => ({
      agent,
      supported: agent === 'custom',
      detail: agent === 'claude' ? 'blocked: stale session' : 'launcher unavailable: review sandbox',
    }),
    buildAutonomousReviewMatrixFn: () => ({}),
    formatMatrixSummaryFn: () => [],
    maxAttempts: 1,
    dryRun: false,
    forgejoEnabled: true,
    slug: 'task-2384',
    log: (message: string) => selectionLogs.push(message),
    error: () => {},
  });

  assert.equal(selected?.reviewer, 'custom', 'the single-family escape hatch must still select the author');
  assert.ok(
    selectionLogs.some((message) => /PR author|external formal approval/i.test(message)),
    `selection must announce the approval requirement before launch: ${selectionLogs.join(' | ')}`,
  );
  assert.ok(
    selectionLogs.some((message) => /claude: blocked: stale session.*codex: launcher unavailable: review sandbox/i.test(message)),
    `fallback diagnostics must name every unavailable family and reason: ${selectionLogs.join(' | ')}`,
  );

  let writtenState: any = null;
  const events: any[] = [];
  const outcome = await postWorkflowReview('task-2384', 'approve', 'looks good', {
    reviewIdentity: 'custom',
    readTokenFn: () => 'token',
    getPrAuthorFn: () => 'custom',
    postReviewFn: () => { throw new Error('self approval must not reach Forgejo'); },
    readReviewStateFn: () => ({ mission: 'task-2384', reviewer: 'custom', implementer: 'custom' }),
    writeReviewStateFn: async (_slug: string, state: unknown) => {
      writtenState = state;
      return { outcome: 'committed' as const };
    },
    createEventFn: (_slug: string, type: string, params: unknown) => {
      events.push({ type, params });
      return { ok: true, path: '/mock' };
    },
    buildMetadataFooterFn: () => '',
    log: () => {},
    error: () => {},
  });

  assert.equal(outcome.skipped, true);
  assert.equal(writtenState.disposition, 'APPROVED', 'the local self-review verdict must remain recorded');
  assert.equal(writtenState.metadata?.approvalOwed, true, 'self-review must persist that external formal approval is owed');
  assert.deepEqual(events, [{
    type: 'reviewer_outcome',
    params: { verdict: 'approve', content: 'Review verdict: approve', blockedReason: 'external-formal-approval-owed' },
  }], 'the local aggregate event must durably identify the approval-owed outcome');

  const statusLines: string[] = [];
  renderStatus({
    branch: 'mission/task-2384', worktree: '/tmp/task-2384', rebaseInfo: null, slug: 'task-2384',
    missionData: {
      backlogStatus: 'review', reviewPhase: 'approved', reviewRound: 1, reviewDisposition: 'APPROVED',
      approvalOwed: true,
      reviewHistory: [],
    } as any,
    prInfo: { exists: true, number: 2384, state: 'open' }, staleWorktrees: [], staleWorktreeRebase: {},
    agentMatrix: [], lastThreeCommits: [], uncommittedCount: 0,
  }, (message) => statusLines.push(message));
  assert.ok(
    statusLines.some((message) => /approval owed|external formal approval/i.test(message)),
    `px status must expose the approval requirement: ${statusLines.join(' | ')}`,
  );
});
