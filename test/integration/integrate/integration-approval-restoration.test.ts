// Exact unchanged repairs restore mechanical approval without model dispatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../../src/adapters/agents/agents.js';
import { run } from '../../../src/composition/create-cli.js';
import { openRepairFixture } from '../../lib/integration-repair-fixture.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setLogger } from '../../../src/application/presentation/cli-format.js';

async function integrate(slug: string, worktree: string): Promise<number> {
  return await run(['integrate', slug], {
    baseCwd: worktree,
    log: () => '',
    error: () => '',
  });
}

import { projectReviewHistory } from '../../../src/application/projections/mission-board.js';
import { SqliteClassifierStatisticsReader } from '../../../src/adapters/sqlite/classifier-statistics-reader.js';
import { SqliteReviewClassificationStore } from '../../../src/adapters/sqlite/review-classification-store.js';

test('unchanged validated integration repair restores mechanical approval without model dispatch and stops for human landing (TASK-2734)', async (t) => {
  const fixture = await openRepairFixture({ slug: 'task-9734', recordBaseline: true,
    gateCommand: 'test -f "$PARALLIX_HOME/green" || { echo "AssertionError: transient fixture failure" >&2; exit 1; }' });
  t.after(() => fixture.close());
  let reviews = 0, repairs = 0;
  setCommandPathProbe(() => '/fixture-agent');
  setLauncherHealthProbe(() => ({ ok: true as const }));
  setWorkflowLaunchPort(({ prompt, worktree }: { prompt: string; worktree?: string }) => ({
    invocation: { command: 'fixture-agent', args: [], options: { cwd: worktree } },
    resultPromise: (async () => {
      if (/^Mode: review\./m.test(prompt)) { reviews++; throw new Error('reviewer must not launch'); }
      repairs++;
      fs.writeFileSync(path.join(process.env.PARALLIX_HOME!, 'green'), 'ok');
      const checkpoint = /Harness-created repair checkpoint: (CP-\d+);/.exec(prompt)?.[1];
      assert.ok(checkpoint);
      assert.equal(await run(['checkpoint', 'record', '--slug', fixture.slug, '--name', checkpoint,
        '--criterion', 'feature ships', '--evidence', 'feature.txt; transient gate fixed', '--next', 'Revalidate and restore when patch unchanged'],
      { baseCwd: fixture.worktree, log: () => '', error: () => '' }), 0);
      return { status: 0, stdout: '', stderr: '' };
    })(),
  }));
  assert.equal(await integrate(fixture.slug, fixture.worktree), 0);
  const mission = await fixture.load();
  assert.equal(repairs, 1); assert.equal(reviews, 0);
  assert.equal(mission.status, 'integration');
  const restored = mission.review!.rounds.at(-1)!;
  assert.equal(restored.decision?.kind, 'approved');
  assert.equal(restored.integrationRepairAssessment?.outcome, 'restored');
  assert.equal(restored.decision?.kind === 'approved' && restored.decision.source.kind, 'mechanical-restoration');
  const history = projectReviewHistory(mission.review!);
  assert.equal(history.at(-1)?.integrationRepairAssessment?.source?.approvedRevision, fixture.approvedRevision);
  assert.equal(history.at(-1)?.integrationRepairAssessment?.source?.candidateRevision, restored.decision?.revision);
  const telemetry = new SqliteReviewClassificationStore(fixture.database);
  assert.equal((await telemetry.calls(String(mission.repositoryId))).length, 0, 'no classifier calls');
  const stats = await new SqliteClassifierStatisticsReader(fixture.database, telemetry, String(mission.repositoryId)).read();
  assert.equal(stats.decisions.filter(d => d.source === 'classifier').length, 0);
  const status: string[] = [];
  const logger = setLogger({ log: line => { status.push(String(line)); }, error: () => {} });
  try { await run(['status', fixture.slug], { baseCwd: fixture.worktree }); } finally { setLogger(logger); }
  assert.match(status.join('\n'), /integration repair source: mechanical-restoration; restored/);
  assert.match(status.join('\n'), /operational_history:\d+/);
  assert.equal((await fixture.laneEvents()).at(-1)?.to_status, 'integration');
});
