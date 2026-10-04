// TASK-2620 AC8: the board keeps showing live work for the whole `px integrate`
// run, including the repair agent and the nested re-review, with the family
// that is actually running; a stop reason appears only when automation cannot
// continue; a review failure surfaces as a failure, not as `ended`.
//
// In-memory operational history only: no agent, no database, no Git.
import test from 'node:test';
import assert from 'node:assert/strict';

import { IntegrateCommandUseCase } from '../../../src/application/integrate-command-use-case.js';
import { ReviewCommandUseCase } from '../../../src/application/review-command-use-case.js';
import {
  CurrentWorkRecorder,
  parseCurrentWorkEntry,
  publishedAgentLaunch,
  type NestedWorkPublisher,
} from '../../../src/application/recording/current-work-recorder.js';
import { reconcileCurrentWork } from '../../../src/application/projections/current-work.js';
import type { OperationalHistoryEntry } from '../../../src/application/ports/operation-history.js';
import type { ReviewWorkflowContext } from '../../../src/application/ports/review-workflow.js';
import { missionId } from '../../../src/domain/mission.js';

const SLUG = 'task-2620';

function recorder() {
  const appended: OperationalHistoryEntry[] = [];
  let id = 0;
  const port = new CurrentWorkRecorder({
    async findAll() { return appended; },
    async findByType(type: string) { return appended.filter((entry) => entry.eventType === type); },
    async append(entry: OperationalHistoryEntry) { appended.push({ ...entry, id: ++id } as OperationalHistoryEntry); },
    async clear() { appended.length = 0; },
  }, { processId: 4242 });
  /** What the board would show right now. */
  const board = () => reconcileCurrentWork(appended.flatMap((entry) => parseCurrentWorkEntry(entry) ?? []), {
    nowMs: Date.now(), ttlMs: 60_000, isProcessAlive: () => true,
  }).get(missionId(SLUG)) ?? null;
  return { port, board };
}

function reviewWorkflow(onContinue: (_context: ReviewWorkflowContext) => Promise<void>) {
  return {
    async preflight(args: string[], options: Record<string, unknown>) { return { slug: SLUG, args, options }; },
    continue: onContinue,
  } as never;
}

test('integration, its repair agent and its nested re-review keep the mission live with the running family', async () => {
  const { port, board } = recorder();
  const seen: Array<{ phase: string | undefined; agent: string | null | undefined } | null> = [];
  const snapshot = () => { const work = board()?.currentWork ?? null; seen.push(work ? { phase: work.phase, agent: work.agent } : null); };

  const review = new ReviewCommandUseCase(reviewWorkflow(async (context) => {
    snapshot();
    await (context.options.onAgentLaunched as (_a: string, _p: string) => Promise<void>)('codex', 'review');
    snapshot();
  }), port);

  const integrate = new IntegrateCommandUseCase({
    async execute(_args: string[], options: Record<string, unknown>) {
      snapshot();
      const nested = options.nestedWork as NestedWorkPublisher;
      const launch = publishedAgentLaunch(async (_step, launchOptions) => {
        snapshot();
        await (launchOptions.onLaunch as (_info: { agent: string }) => Promise<void>)({ agent: 'custom' });
        snapshot();
        return { agent: 'custom', result: { status: 0 } };
      }, nested, 'execute', (agent) => `integration repair: implementer ${agent}`);
      await launch('act-on-review', { agent: 'claude' });
      snapshot();
      await review.execute([SLUG, '--continue'], { nestedWork: nested });
      snapshot();
      return 0;
    },
  } as never, port);

  await integrate.execute([SLUG]);

  assert.deepEqual(seen, [
    { phase: 'integrate', agent: null },
    { phase: 'execute', agent: 'claude' },
    { phase: 'execute', agent: 'custom' },
    { phase: 'integrate', agent: null },
    { phase: 'review', agent: null },
    { phase: 'review', agent: 'codex' },
    { phase: 'integrate', agent: null },
  ], 'no gap in live work from integrate start to integrate end, and the actual family is shown');
  assert.equal(board()?.currentWork ?? null, null, 'a finished integrate ends its live work');
  assert.equal(board()?.blockingReason ?? null, null, 'a clean stop in the integration lane shows no stop reason');
});

test('an integrate that cannot continue shows why, not a silent end', async () => {
  const { port, board } = recorder();
  const integrate = new IntegrateCommandUseCase({
    async execute() { throw new Error('Integration gate unit still fails after 2 repair(s)'); },
  } as never, port);
  await assert.rejects(integrate.execute([SLUG]));
  assert.equal(board()?.blockingReason, 'Integration gate unit still fails after 2 repair(s)');
});

test('a review whose injected exit reports failure is published as blocked, not ended', async () => {
  const { port, board } = recorder();
  const review = new ReviewCommandUseCase(reviewWorkflow(async (context) => {
    (context.options.exit as (_code: number) => void)(1);
  }), port);
  await review.execute([SLUG, '--continue'], { exit: () => {} });
  assert.match(board()?.blockingReason ?? '', /px review --continue task-2620 exited with status 1/);
});
