// TASK-2620 red-to-green reproduction for the supervised integration-repair
// loop. Reproduces the task-2591 sequence: an approved mission in the
// integration lane whose integration gate goes red.
//
// On the parent commit this run either skips the repair after the budget or
// chains `px integrate` after `review --continue` and merges the re-approved
// work in the same invocation (the mission moves to `done`) — the defect.
// After the fix the run repairs once through the bounded implementer budget,
// re-reviews the repaired revision through the single live `px review
// --continue` route, and then STOPS in the integration lane for the human: no
// merge, no `done`, no auto-restart.
//
// Only external boundaries are mocked: the agent launcher, the Forgejo HTTP
// layer (the fixture disables the review provider), and the gate runner (the
// fixture controls the gate through a file in the worktree). Evidence is read
// back from the committed Mission state and the lane-event log, not from
// captured log lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../src/adapters/agents/agents.js';
import { run } from '../src/composition/create-cli.js';
import { openRepairFixture } from './lib/integration-repair-fixture.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { reviewStatus } from '../src/domain/review.js';
import { setLogger } from '../src/application/presentation/cli-format.js';

async function integrate(slug: string, worktree: string): Promise<number> {
  return await run(['integrate', slug], {
    baseCwd: worktree,
    log: () => '',
    error: () => '',
  });
}

test('task-2620: a red integration gate repairs once, re-reviews, and stops in the integration lane', async (t) => {
  const fixture = await openRepairFixture({ slug: 'task-2620' });
  t.after(() => fixture.close());
  const approvedRounds = (await fixture.load()).review!.rounds.length;

  setCommandPathProbe(() => '/fixture-agent');
  setLauncherHealthProbe(() => ({ ok: true }));
  const prompts: { review: string[]; repair: string[] } = { review: [], repair: [] };
  setWorkflowLaunchPort(({ prompt, worktree }: { prompt: string; worktree?: string }) => ({
    invocation: { command: 'fixture-agent', args: [], options: { cwd: worktree } },
    resultPromise: (async () => {
      prompts[/^Mode: review\./m.test(prompt) ? 'review' : 'repair'].push(prompt);
      if (/^Mode: review\./m.test(prompt)) {
        // The live re-review route: approve the repaired revision through the
        // same `verdict` command a human reviewer would run.
        const mission = await fixture.load();
        const round = mission.review!.rounds.at(-1)!;
        await run(['verdict', 'approve', '--slug', fixture.slug, '--actor', round.reviewer, '--expected-version', String(await fixture.version()), '--comment', 'Repair verified'], { baseCwd: fixture.worktree, log: () => '', error: () => '' });
      } else {
        // The bounded implementer budget: one repair, committed so the gate
        // re-run verifies a finalized tree.
        fs.writeFileSync(path.join(fixture.worktree, 'repaired.txt'), 'ok\n');
        fixture.git(fixture.worktree, ['add', 'repaired.txt']);
        fixture.git(fixture.worktree, ['commit', '-m', 'repair']);
      }
      return { status: 0, stdout: '', stderr: '' };
    })(),
  }));

  const code = await integrate(fixture.slug, fixture.worktree);
  const mission = await fixture.load();
  const events = await fixture.laneEvents();

  // The gate ran red and the bounded implementer budget attempted one repair.
  assert.equal(mission.review!.rounds.length, approvedRounds + 1, 'the repaired revision opened and was re-reviewed through one fresh round');
  assert.ok(fs.existsSync(path.join(fixture.worktree, 'repaired.txt')), 'the bounded repair budget attempted one repair');
  // The repaired revision was re-reviewed and approved through the live route.
  assert.equal(reviewStatus(mission.review!), 'approved', 'the repaired revision was re-reviewed and approved');
  // The run stops cleanly in the integration lane: no auto-merge, no `done`.
  assert.equal(code, 0, 'the run stops cleanly without failing');
  assert.equal(mission.status, 'integration', 'the repaired-and-re-approved mission stays in the integration lane for the human');
  assert.equal(events.at(-1)?.to_status, 'integration', 'the last lane event lands in the integration lane, not done');

  // AC3: the repair agent is told the story: approved revision, failed gate, command, logs.
  const repair = prompts.repair.join('\n');
  assert.match(repair, new RegExp(fixture.approvedRevision), 'the repair prompt names the approved revision');
  assert.match(repair, /integration gate unit/, 'the repair prompt names the failed gate');
  assert.match(repair, /repaired\.txt is missing/, 'the repair prompt carries the captured gate output');
  // AC6: the re-review prompt carries the repair context and leaves scope to the reviewer.
  const repairedRevision = String(mission.review!.rounds.at(-1)!.subject.revision);
  const review = prompts.review.join('\n');
  assert.notEqual(repairedRevision, fixture.approvedRevision, 'the re-reviewed round names the repaired commit');
  assert.match(review, /integration gate `unit`/, 'the re-review prompt names the failed gate');
  assert.match(review, /repaired\.txt is missing/, 'the re-review prompt carries the gate output');
  assert.ok(review.includes(`${fixture.approvedRevision}..${repairedRevision}`), 'the re-review prompt names the repair range A..B');
  assert.match(review, /withdrew and dismissed that prior approval/, 'the re-review prompt states the prior approval was dismissed');
  assert.match(review, /review scope is yours/i, 'the reviewer decides the scope');
  // AC13: px status shows the previous failure, repair range and re-review outcome.
  const status: string[] = [];
  const previousLogger = setLogger({ log: (line: string) => { status.push(line); }, error: () => {} });
  try { await run(['status', fixture.slug], { baseCwd: fixture.worktree }); } finally { setLogger(previousLogger); }
  assert.match(status.join('\n'), new RegExp(`Previous integration failed at integration gate unit .*repair range ${fixture.approvedRevision}\.\.${repairedRevision}; re-review approved`));

  void SqliteDatabaseAdapter;
});

test('task-2620 AC1: px lead forwards an undecided review round to review --continue and records no approval', async (t) => {
  const fixture = await openRepairFixture({ slug: 'task-9620', state: 'undecided-review' });
  t.after(() => fixture.close());
  const atReviewerLaunch: Array<{ approved: boolean; status: string }> = [];
  setCommandPathProbe(() => '/fixture-agent');
  setLauncherHealthProbe(() => ({ ok: true }));
  // The configured reviewer reached through `review --continue` is the only
  // actor that decides. It records what lead left behind, then approves
  // through the same `verdict` command a human reviewer would run.
  setWorkflowLaunchPort(({ prompt, worktree }: { prompt: string; worktree?: string }) => ({
    invocation: { command: 'fixture-agent', args: [], options: { cwd: worktree } },
    resultPromise: (async () => {
      if (/^Mode: review\./m.test(prompt)) {
        const mission = await fixture.load();
        atReviewerLaunch.push({ approved: mission.review!.rounds.some((round) => round.decision?.kind === 'approved'), status: mission.status });
        const round = mission.review!.rounds.at(-1)!;
        await run(['verdict', 'approve', '--slug', fixture.slug, '--actor', round.reviewer, '--expected-version', String(await fixture.version()), '--comment', 'Reviewed'], { baseCwd: fixture.worktree, log: () => '', error: () => '' });
      }
      return { status: 0, stdout: '', stderr: '' };
    })(),
  }));

  // Lead settles the review it forwarded before it returns, so the fixture is
  // closed only after that review has finished.
  await run(['lead', '--once', '--budget', '0', fixture.slug], { baseCwd: fixture.worktree, log: () => '', error: () => '' });
  const mission = await fixture.load();

  assert.deepEqual(atReviewerLaunch, [{ approved: false, status: 'review' }], 'lead forwarded to review --continue once, with no approval written before the reviewer ran');
  const approvals = mission.review!.rounds.filter((round) => round.decision?.kind === 'approved');
  assert.equal(approvals.length, 1, 'the only approval is the one the forwarded reviewer recorded');
  assert.notEqual(mission.status, 'done', 'lead did not integrate');
});
