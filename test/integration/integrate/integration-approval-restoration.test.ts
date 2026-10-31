import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
// Exact unchanged repairs retain the original approval without model dispatch.
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

test('unchanged validated integration repair retains original approval without model dispatch and stops for human landing (TASK-2734)', async (t) => {
  const fixture = await openRepairFixture({ slug: 'task-9734', recordBaseline: true,
    gateCommand: 'test -f "$PARALLIX_HOME/green" || { echo "AssertionError: transient fixture failure" >&2; exit 1; }' });
  t.after(() => fixture.close());
  const original = await fixture.load();
  const round = original.review!.rounds[0];
  const source = { kind: 'mechanical-restoration' as const, approvedRevision: 'historical-judged-A',
    candidateRevision: fixture.approvedRevision, failedGate: 'unit', validationRevision: fixture.approvedRevision,
    validationReference: 'historical:1', validatedAt: '2026-09-20T10:59:00Z' };
  const restoredAssessment = { assessedAt: round.decision!.decidedAt, approvedRevision: source.approvedRevision,
    candidateRevision: source.candidateRevision, failedGate: 'unit', outcome: 'restored' as const, source };
  assert.ok(round.decision?.kind === 'approved');
  const historical = { ...round, decision: { ...round.decision!, source }, integrationRepairAssessment: restoredAssessment };
  await new SqliteMissionStore(fixture.database).save({ ...original, review: { ...original.review!, rounds: [historical] } }, missionVersion(await fixture.version()));

  let reviews = 0, repairs = 0;
  setCommandPathProbe(() => '/fixture-agent');
  setLauncherHealthProbe(() => ({ ok: true as const }));
  setWorkflowLaunchPort(({ prompt, worktree }: { prompt: string; worktree?: string }) => ({
    invocation: { command: 'fixture-agent', args: [], options: { cwd: worktree } },
    resultPromise: (async () => {
      if (/^Mode: review\./m.test(prompt)) { reviews++; throw new Error('reviewer must not launch'); }
      repairs++;
      fs.writeFileSync(path.join(fixture.repo, 'upstream.txt'), 'Unrelated base advancement during repair\n');
      fixture.git(fixture.repo, ['add', 'upstream.txt']);
      fixture.git(fixture.repo, ['commit', '-m', 'Advance base during live repair']);
      fs.writeFileSync(path.join(process.env.PARALLIX_HOME!, 'green'), 'ok');
      const checkpoint = /Harness-created repair checkpoint: (CP-\d+);/.exec(prompt)?.[1];
      assert.ok(checkpoint);
      assert.equal(await run(['checkpoint', 'record', '--slug', fixture.slug, '--name', checkpoint,
        '--criterion', 'feature ships', '--evidence', 'feature.txt; transient gate fixed', '--next', 'Revalidate and retain when patch unchanged'],
      { baseCwd: fixture.worktree, log: () => '', error: () => '' }), 0);
      return { status: 0, stdout: '', stderr: '' };
    })(),
  }));
  assert.equal(await integrate(fixture.slug, fixture.worktree), 0);
  const mission = await fixture.load();
  assert.equal(repairs, 1); assert.equal(reviews, 0);
  assert.equal(mission.status, 'integration');
  assert.notEqual(fixture.git(fixture.repo, ['rev-parse', 'main']), round.subject.baseline, 'the base advanced during the live repair');
  assert.equal(fixture.git(fixture.repo, ['show', 'main:upstream.txt']), 'Unrelated base advancement during repair');
  const restored = mission.review!.rounds.at(-1)!;
  assert.equal(restored.decision?.kind, 'approved');
  assert.equal(restored.integrationRepairAssessment?.outcome, 'retained');
  assert.equal(restored.decision?.kind === 'approved' && restored.decision.source.kind, 'mechanical-restoration');
  assert.deepEqual(restored.decision?.kind === 'approved' && restored.decision.source, source, 'historical source survives repair and SQLite reload');
  const history = projectReviewHistory(mission.review!);
  assert.equal(mission.review!.rounds.length, 1, 'no revoke/restore churn');
  assert.equal(restored.decision?.revision, fixture.approvedRevision);
  assert.equal(history.at(-1)?.integrationRepairAssessment?.approvedRevision, fixture.approvedRevision);
  assert.equal(history.at(-1)?.integrationRepairAssessment?.validation?.sha, restored.integrationRepairAssessment?.candidateRevision);
  const telemetry = new SqliteReviewClassificationStore(fixture.database);
  assert.equal((await telemetry.calls(String(mission.repositoryId))).length, 0, 'no classifier calls');
  const stats = await new SqliteClassifierStatisticsReader(fixture.database, telemetry, String(mission.repositoryId)).read();
  assert.equal(stats.decisions.filter(d => d.source === 'classifier').length, 0);
  const status: string[] = [];
  const logger = setLogger({ log: line => { status.push(String(line)); }, error: () => {} });
  try { await run(['status', fixture.slug], { baseCwd: fixture.worktree }); } finally { setLogger(logger); }
  assert.match(status.join('\n'), /integration repair source: original-approval; retained/);
  assert.match(status.join('\n'), /operational_history:\d+/);
  assert.equal((await fixture.laneEvents()).at(-1)?.to_status, 'integration');
});
