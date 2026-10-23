// Lead delegates an undecided review; it never decides or integrates it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../../src/adapters/agents/agents.js';
import { run } from '../../../src/composition/create-cli.js';
import { openRepairFixture } from '../../lib/integration-repair-fixture.js';

test('task-2620 AC1: px lead forwards an undecided review round to review and records no approval', async (t) => {
  const fixture = await openRepairFixture({ slug: 'task-9620', state: 'undecided-review' });
  t.after(() => fixture.close());
  const atReviewerLaunch: Array<{ approved: boolean; status: string }> = [];
  setCommandPathProbe(() => '/fixture-agent');
  setLauncherHealthProbe(() => ({ ok: true as const }));
  // The configured reviewer reached through `review` is the only
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

  assert.deepEqual(atReviewerLaunch, [{ approved: false, status: 'review' }], 'lead forwarded to review once, with no approval written before the reviewer ran');
  const approvals = mission.review!.rounds.filter((round) => round.decision?.kind === 'approved');
  assert.equal(approvals.length, 1, 'the only approval is the one the forwarded reviewer recorded');
  assert.notEqual(mission.status, 'done', 'lead did not integrate');
});

