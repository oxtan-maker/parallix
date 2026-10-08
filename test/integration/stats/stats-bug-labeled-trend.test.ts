import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStatsReport } from '../../../src/application/services/statistics-report-selection.js';
import type { StatsMissionFlow } from '../../../src/application/ports/cli-workflows.js';

// Dedicated contract for the additive bug trend, separate from telemetry spend.
const bug: StatsMissionFlow = {
  repo: 'fixture', mission: 'bug-mission', closedAt: '2026-09-08T12:00:00Z',
  labels: ['bug', 'ai_sdlc'],
};

test('completed Mission bug label produces a weekly bug count and share (TASK-2669)', () => {
  const selection = selectStatsReport([], [bug], { mode: 'weekly', today: '2026-09-20' });
  const week = selection.bugTrend?.find(row => row.start === '2026-09-07');
  assert.ok(week, 'full UTC ISO week must appear in the bug series');
  assert.equal(week.bugs, 1);
  assert.equal(week.share, 1);
});

test('bug trend preserves classifications and includes empty full weeks', () => {
  const flow = [bug, { ...bug, mission: 'feature', labels: ['user_value'] }];
  const selection = selectStatsReport([], flow, { mode: 'range', from: '2026-09-07', to: '2026-09-20' });
  assert.deepEqual(selection.current.flow, { total: 2, aiSdlc: 1, userValue: 1, unclassified: 0 });
  assert.deepEqual(selection.bugTrend?.map(({ completed, bugs, share }) => ({ completed, bugs, share })), [
    { completed: 2, bugs: 1, share: 0.5 }, { completed: 0, bugs: 0, share: null },
  ]);
});

test('weekly and range reports render bug share and trailing direction alongside flow', async () => {
  const { renderWeeklyStatsReport, renderRangeStatsReport } = await import('../../../src/adapters/cli/commands/stats-report.js');
  for (const report of [
    renderWeeklyStatsReport([], { missionFlow: [bug], today: '2026-09-20' }),
    renderRangeStatsReport([], { missionFlow: [bug], from: '2026-09-07', to: '2026-09-20' }),
  ]) {
    assert.match(report, /Bug-labeled mission trend/);
    assert.match(report, /2026-09-07 → 2026-09-13/);
    assert.match(report, /100.0%/);
    assert.match(report, /Trailing average \(3 weeks\)/);
    assert.match(report, /no completions/);
    assert.match(report, /# AI SDLC missions/);
  }
});

test('Mission state labels override conflicting Backlog labels through the stats command', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { withStatisticsDatabase, laneEvent } = await import('../../fixtures/statistics-database.js');
  const { fixtureMission } = await import('../../fixtures/mission-builders.js');
  const { missionLabels } = await import('../../../src/domain/mission.js');
  const { repositoryId } = await import('../../../src/domain/repository.js');
  const { SqliteMissionStore } = await import('../../../src/adapters/sqlite/mission-store.js');
  const { createStatsMissionFlowReader, createStatisticsCommand } = await import('../../../src/composition/stats.js');
  await withStatisticsDatabase(async ({ dir, db, databasePath, laneEventRepo, usageRepo }) => {
    const repo = repositoryId('fixture');
    const store = new SqliteMissionStore(db);
    const tasks = path.join(dir, 'backlog', 'tasks');
    fs.mkdirSync(tasks, { recursive: true });
    for (const [slug, labels, backlogLabels] of [
      ['task-1', ['bug', 'ai_sdlc'], ['ai_sdlc']],
      ['task-2', ['user_value'], ['bug', 'user_value']],
    ] as const) {
      await store.save(fixtureMission(slug, { repositoryId: repo, status: 'done', labels: missionLabels([...labels]) }), null);
      await laneEventRepo.append(laneEvent({ repositoryId: repo, missionId: slug, from: 'integration', to: 'done', at: '2026-09-08T12:00:00Z' }));
      fs.writeFileSync(path.join(tasks, `${slug} - Example.md`), `---\nid: ${slug}\nlabels: [${backlogLabels.join(', ')}]\n---\n`);
    }
    const options = { rootDir: dir, repositoryId: repo, missionStore: store, laneEventRepo, usageRepo, dbPath: databasePath };
    const flow = await createStatsMissionFlowReader(options)();
    assert.ok(flow);
    assert.deepEqual(flow.find(row => row.mission === 'task-1')?.labels, ['bug', 'ai_sdlc']);
    const selection = selectStatsReport([], flow, { mode: 'range', from: '2026-09-07', to: '2026-09-20' });
    assert.equal(selection.bugTrend?.[0].bugs, 1);
    assert.equal(selection.bugTrend?.[0].share, 0.5);
    const command = createStatisticsCommand(options);
    for (const args of [['--today', '2026-09-20'], ['--from', '2026-09-07', '--to', '2026-09-20']]) {
      const output: string[] = [];
      await command(args, { rootDir: dir, log: message => output.push(message), error: assert.fail, exit: code => assert.fail(`unexpected CLI exit: ${code}`) });
      assert.match(output.join('\n'), /50.0%/);
      assert.match(output.join('\n'), /no completions/);
    }
  });
});

test('partial weeks and unavailable lifecycle history have explicit states', async () => {
  const { renderRangeStatsReport } = await import('../../../src/adapters/cli/commands/stats-report.js');
  assert.match(renderRangeStatsReport([], { missionFlow: [], from: '2026-09-08', to: '2026-09-13' }), /No full UTC ISO weeks/);
  assert.match(renderRangeStatsReport([], { missionFlow: null, from: '2026-09-07', to: '2026-09-20' }), /Bug trend unavailable/);
});

test('mixed, non-bug, and empty weeks distinguish observed zero from missing share', () => {
  const selection = selectStatsReport([], [
    bug, { ...bug, mission: 'feature', labels: ['user_value'] },
    { ...bug, mission: 'maintenance', closedAt: '2026-09-15T12:00:00Z', labels: [] },
  ], { mode: 'range', from: '2026-09-07', to: '2026-09-27' });
  assert.deepEqual(selection.bugTrend?.map(week => [week.bugs, week.completed, week.share]), [
    [1, 2, 0.5], [0, 1, 0], [0, 0, null],
  ]);
  assert.deepEqual(selection.current.flow, { total: 3, aiSdlc: 1, userValue: 1, unclassified: 1 });
});
