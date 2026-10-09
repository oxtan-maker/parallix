import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStatsReport } from '../../../src/application/services/statistics-report-selection.js';
import type { StatsMissionFlow } from '../../../src/application/ports/cli-workflows.js';

// This suite exercises the operator's local reporting timezone in its isolated process.
process.env.TZ = 'Europe/Stockholm';

// Dedicated contract for the additive bug trend, separate from telemetry spend.
const bug: StatsMissionFlow = {
  repo: 'fixture', mission: 'bug-mission', closedAt: '2026-09-08T12:00:00Z',
  labels: ['bug', 'ai_sdlc'],
};

test('completed Mission bug label produces a weekly bug count and share (TASK-2669)', () => {
  const selection = selectStatsReport([], [bug], { mode: 'weekly', today: '2026-09-14' });
  const week = selection.bugTrend?.find(row => row.start === '2026-09-08');
  assert.ok(week, 'rolling decision period must appear in the bug series');
  assert.equal(week.bugs, 1);
  assert.equal(week.share, 1);
});

test('bug trend preserves classifications and retains the full explicit range', () => {
  const flow = [bug, { ...bug, mission: 'feature', labels: ['user_value'] }];
  const selection = selectStatsReport([], flow, { mode: 'range', from: '2026-09-07', to: '2026-09-20' });
  assert.deepEqual(selection.current.flow, { total: 2, aiSdlc: 1, userValue: 1, unclassified: 0 });
  assert.deepEqual(selection.bugTrend?.map(({ completed, bugs, share }) => ({ completed, bugs, share })), [
    { completed: 2, bugs: 1, share: 0.5 },
  ]);
});

test('weekly and range reports render exact periods and bug share alongside flow', async () => {
  const { renderWeeklyStatsReport, renderRangeStatsReport } = await import('../../../src/adapters/cli/commands/stats-report.js');
  for (const report of [
    renderWeeklyStatsReport([], { missionFlow: [bug], today: '2026-09-14' }),
    renderRangeStatsReport([], { missionFlow: [bug], from: '2026-09-07', to: '2026-09-20' }),
  ]) {
    assert.match(report, /Bug-labeled mission share/);
    assert.match(report, /2026-09-(08 → 2026-09-14|07 → 2026-09-20)/);
    assert.match(report, /100.0%/);
    assert.doesNotMatch(report, /ISO weeks|Trailing average/);
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
    for (const args of [['--today', '2026-09-14'], ['--from', '2026-09-07', '--to', '2026-09-20']]) {
      const output: string[] = [];
      await command(args, { rootDir: dir, log: message => output.push(message), error: assert.fail, exit: code => assert.fail(`unexpected CLI exit: ${code}`) });
      assert.match(output.join('\n'), /50.0%/);
      if (args.includes('--today')) { assert.match(output.join('\n'), /no completions/); }
    }
  });
});

test('partial weeks and unavailable lifecycle history have explicit states', async () => {
  const { renderRangeStatsReport } = await import('../../../src/adapters/cli/commands/stats-report.js');
  assert.match(renderRangeStatsReport([], { missionFlow: [], from: '2026-09-08', to: '2026-09-13' }), /no completions/);
  assert.match(renderRangeStatsReport([], { missionFlow: null, from: '2026-09-07', to: '2026-09-20' }), /Bug trend unavailable/);
  assert.match(renderRangeStatsReport([], { missionFlow: [{ ...bug, labels: [] }], from: '2026-09-08', to: '2026-09-13' }), /0\.0%/);
});

test('mixed explicit range keeps every completed mission', () => {
  const selection = selectStatsReport([], [
    bug, { ...bug, mission: 'feature', labels: ['user_value'] },
    { ...bug, mission: 'maintenance', closedAt: '2026-09-15T12:00:00Z', labels: [] },
  ], { mode: 'range', from: '2026-09-07', to: '2026-09-27' });
  assert.deepEqual(selection.bugTrend?.map(week => [week.bugs, week.completed, week.share]), [
    [1, 3, 1 / 3],
  ]);
  assert.deepEqual(selection.current.flow, { total: 3, aiSdlc: 1, userValue: 1, unclassified: 1 });
});

test('stats and DONE rail share persisted delivery days despite later closure (TASK-2685)', async () => {
  const { withStatisticsDatabase, laneEvent } = await import('../../fixtures/statistics-database.js');
  const { fixtureMission } = await import('../../fixtures/mission-builders.js');
  const { repositoryId } = await import('../../../src/domain/repository.js');
  const { missionLabels } = await import('../../../src/domain/mission.js');
  const { SqliteMissionStore } = await import('../../../src/adapters/sqlite/mission-store.js');
  const { createStatsMissionFlowReader } = await import('../../../src/composition/stats.js');
  const { BoardProjectionBuilder } = await import('../../../src/application/projections/board-readers.js');
  const { ConcreteMetricsReadAdapter } = await import('../../../src/application/projections/metrics-read-adapter.js');
  await withStatisticsDatabase(async ({ dir, db, laneEventRepo, usageRepo }) => {
    const repo = repositoryId('fixture');
    const store = new SqliteMissionStore(db);
    const cases = [
      ['task-first', '2026-10-02T00:00:00+02:00', [], '2026-10-09T12:00:00Z'],
      ['task-delivery', '2026-10-07T12:00:00Z', ['bug', 'user_value'], '2026-10-09T12:00:00Z'],
      ['task-last', '2026-10-08T23:59:59.999+02:00', [], '2026-10-09T12:00:00Z'],
      ['task-old', '2026-10-01T23:59:59+02:00', ['bug', 'ai_sdlc'], '2026-10-08T12:00:00Z'],
      ['task-unknown', null, [], '2026-01-01T00:00:00Z'],
      ['task-unclosed', '2026-01-01T00:00:00Z', [], null],
    ] as const;
    for (const [id, delivered, labels, closedAt] of cases) {
      await store.save(fixtureMission(id, { repositoryId: repo, status: 'done', labels: missionLabels([...labels]), closedAt }), null);
      if (delivered) {
        await laneEventRepo.append(laneEvent({ repositoryId: repo, missionId: id, from: null, to: 'integration', at: '2025-12-01T00:00:00Z' }));
        await laneEventRepo.append(laneEvent({ repositoryId: repo, missionId: id, from: 'integration', to: 'done', at: delivered }));
        if (closedAt) { await laneEventRepo.append(laneEvent({ repositoryId: repo, missionId: id, from: 'done', to: 'done', at: closedAt, trigger: 'close' })); }
      }
    }
    const flow = await createStatsMissionFlowReader({ rootDir: dir, repositoryId: repo, missionStore: store, laneEventRepo, usageRepo })();
    const selection = selectStatsReport([], flow, { mode: 'weekly', today: '2026-10-08' });
    assert.deepEqual(selection.bugTrend?.map(row => [row.completed, row.bugs, row.share]), [[3, 1, 1 / 3], [1, 1, 1]]);
    const missions = await store.loadByRepository(repo);
    for (const instant of ['2026-10-08T00:00:00+02:00', '2026-10-08T23:59:59+02:00']) {
      const builder = new BoardProjectionBuilder(
        { loadAllMissions: async () => missions, loadMission: async id => missions.find(m => m.id === id) ?? null, getSourceFacts: () => [] },
        { loadReviews: async () => new Map() }, { loadGateStatus: async () => 'unknown' },
        { loadAgentAvailability: async () => [], loadAssignedAgent: async () => null },
        { loadRepositoryId: async () => repo, loadHeadCommit: async () => '' }, { loadOperationLog: async () => [] },
        { now: () => Date.parse(instant), metricsAdapter: new ConcreteMetricsReadAdapter({ laneEventRepo, usageRepo, repositoryId: repo, clock: () => instant }) },
      );
      const board = await builder.build();
      const done = board.stages.find(s => s.lane === 'done')!;
      assert.deepEqual(done.cards.map(c => c.id).sort(), ['task-delivery', 'task-first', 'task-last']);
      assert.deepEqual(done.historyCards?.map(c => c.id).sort(), ['task-unclosed', 'task-unknown']);
      // Keep the original visibility invariant across both rendered groups.
      assert.deepEqual([...done.cards, ...done.historyCards ?? []].map(c => c.id).sort(),
        ['task-delivery', 'task-first', 'task-last', 'task-unclosed', 'task-unknown']);
      assert.equal(done.count, selection.current.flow.total);
      assert.equal(done.count, board.metrics.decisionWindow?.current.completedMissions);
      assert.equal(done.count, board.metrics.weeklyCumulativeFlow?.series.at(-1)?.counts.done);
    }
  });
});

test('local CLI and board refresh include a new delivery immediately with stable periods (TASK-2685)', async () => {
  const { withStatisticsDatabase, laneEvent } = await import('../../fixtures/statistics-database.js');
  const { fixtureMission } = await import('../../fixtures/mission-builders.js');
  const { repositoryId } = await import('../../../src/domain/repository.js');
  const { missionLabels } = await import('../../../src/domain/mission.js');
  const { SqliteMissionStore } = await import('../../../src/adapters/sqlite/mission-store.js');
  const { createStatsMissionFlowReader, createStatisticsCommand } = await import('../../../src/composition/stats.js');
  const { BoardProjectionBuilder } = await import('../../../src/application/projections/board-readers.js');
  const { ConcreteMetricsReadAdapter } = await import('../../../src/application/projections/metrics-read-adapter.js');
  await withStatisticsDatabase(async ({ dir, db, laneEventRepo, usageRepo, databasePath }) => {
    const repo = repositoryId('fixture');
    const store = new SqliteMissionStore(db);
    const options = { rootDir: dir, repositoryId: repo, missionStore: store, laneEventRepo, usageRepo, dbPath: databasePath };
    const readFlow = createStatsMissionFlowReader(options);
    const cli = createStatisticsCommand(options);
    let now = '2026-10-08T08:00:00+02:00';
    const builder = new BoardProjectionBuilder(
      { loadAllMissions: () => store.loadByRepository(repo), loadMission: async id => { const result = await store.load(id); return result.kind === 'found' ? result.mission : null; }, getSourceFacts: () => [] },
      { loadReviews: async () => new Map() }, { loadGateStatus: async () => 'unknown' },
      { loadAgentAvailability: async () => [], loadAssignedAgent: async () => null },
      { loadRepositoryId: async () => repo, loadHeadCommit: async () => '' }, { loadOperationLog: async () => [] },
      { now: () => Date.parse(now), metricsAdapter: new ConcreteMetricsReadAdapter({ laneEventRepo, usageRepo, repositoryId: repo, clock: () => now }) },
    );
    const persist = async (id: string, at: string) => {
      await store.save(fixtureMission(id, { repositoryId: repo, status: 'done', labels: missionLabels(['bug']), closedAt: now }), null);
      await laneEventRepo.append(laneEvent({ repositoryId: repo, missionId: id, from: null, to: 'active', at: '2026-10-01T10:00:00Z' }));
      await laneEventRepo.append(laneEvent({ repositoryId: repo, missionId: id, from: 'integration', to: 'done', at }));
    };
    // The real reported boundary case, represented both ways in existing storage.
    await persist('task-offset', '2026-10-02T00:28:41+02:00');
    await persist('task-utc', '2026-10-01T22:28:41Z');
    const before = selectStatsReport([], await readFlow(), { mode: 'weekly', today: now });
    assert.equal(before.current.flow?.total, 2);
    assert.equal((await builder.build()).metrics.decisionWindow?.current.completedMissions, 2);
    now = '2026-10-08T18:00:00+02:00';
    await persist('task-new', '2026-10-08T15:59:59Z');
    const after = selectStatsReport([], await readFlow(), { mode: 'weekly', today: now });
    assert.deepEqual(after.current.window, before.current.window);
    assert.deepEqual(after.previous?.window, before.previous?.window);
    assert.deepEqual(after.previous?.flow, before.previous?.flow);
    assert.equal(after.current.flow?.total, 3);
    assert.equal(after.bugTrend?.[0].completed, 3);
    const board = await builder.build();
    assert.equal(board.metrics.decisionWindow?.current.completedMissions, 3);
    assert.equal(board.stages.find(stage => stage.lane === 'done')?.count, 3);
    assert.equal(board.metrics.weeklyCumulativeFlow?.series[0]?.counts.done, 2);
    const output: string[] = [];
    await cli(['--today', '2026-10-08'], { log: message => output.push(message), error: assert.fail, exit: code => assert.fail(`unexpected CLI exit: ${code}`) });
    const report = output.join('\n');
    assert.match(report, /Reporting timezone: Europe\/Stockholm/);
    assert.match(report, /2026-10-02 → 2026-10-08/);
    assert.match(report, /100\.0%/);
    assert.doesNotMatch(report, /UTC calendar days|UTC days|ISO weeks/);
    // An unchanged mission set must still roll its cached metrics at local midnight.
    now = '2026-10-09T00:00:00+02:00';
    const nextDay = await builder.build();
    assert.equal(nextDay.metrics.decisionWindow?.current.startDate, '2026-10-03');
    assert.equal(nextDay.metrics.decisionWindow?.current.completedMissions, 1);
    assert.equal(nextDay.stages.find(stage => stage.lane === 'done')?.count, 1);
  });
});
