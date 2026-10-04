// TASK-2601 — task-2599 recorded `user_value` through `px classification set`,
// so the Mission database held the classification while the Backlog task kept
// `labels: []`. Draft completion accepted the stored classification, but the
// draft stage-stat row warned about the missing Backlog label and `px active`
// startup preflight refused to launch the implementer. Classification is
// Mission state after TASK-2521.03; the Backlog label must not gate it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../../../src/adapters/sqlite/migration-runner.js';
import { closeMeasurementStores } from '../../../src/adapters/sqlite/measurement-store.js';
import * as stats from '../../../src/adapters/cli/commands/stats.js';
import { collectHistoricalStatsBackfill } from '../../../src/adapters/cli/commands/stats-backfill.js';
import { recordDraftStats } from '../../../src/adapters/cli/commands/draft-stats.js';
import { normalizeDraftClassification } from '../../../src/adapters/cli/commands/draft-prompts.js';
import { startupPreflight } from '../../../src/adapters/cli/startup-preflight.js';
import { createIntegrationPreflight } from '../../../src/application/integrate/preflight.js';
import { createIntegrationContextBuilder } from '../../../src/application/integrate/context.js';
import type { IntegrateWorkflowPorts } from '../../../src/application/ports/integrate-workflow.js';

const slug = 'task-2599';


/**
 * A Parallix home whose Mission database stores `labels` for the slug (no
 * aggregate when `labels` is null) and a repository whose Backlog task carries
 * `taskLabels`.
 */
async function withStoredMission(labels: readonly string[] | null, taskLabels: string, run: (_root: string) => Promise<void> | void) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2601-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2601-repo-'));
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  try {
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: path.join(home, 'parallix.db') });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    if (labels) {
      await db.execute('INSERT INTO missions (id, repository_id, title, status) VALUES (?, ?, ?, ?)', [slug, 'parallix', 'Classified Mission', 'active']);
      for (const [position, label] of labels.entries()) {
        await db.execute('INSERT INTO mission_labels (mission_id, position, label) VALUES (?, ?, ?)', [slug, position, label]);
      }
    }
    await db.close();

    const taskFile = path.join(root, 'backlog', 'tasks', `${slug} - Classified-Mission.md`);
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, ['---', `id: ${slug.toUpperCase()}`, 'title: Classified Mission', 'status: active', `labels: ${taskLabels}`, '---', ''].join('\n'));
    await run(root);
  } finally {
    closeMeasurementStores();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runStartupPreflight(root: string) {
  const lines: string[] = [];
  const result = startupPreflight([slug], {
    returnResult: true,
    cwdFn: () => root,
    getCurrentBranchFn: () => `mission/${slug}`,
    conventionalWorktreePathFn: () => root,
    findMissionDirFn: () => null,
    resolveMissionBaseBranchFn: () => null,
    getPrimaryBranchFn: () => 'main',
    getLastCommitFn: () => ({ sha: 'abcdef123456', subject: 'draft', date: '2026-09-28' }),
    isForgejoReviewEnabledFn: () => false,
    log: (line: unknown) => lines.push(String(line)),
    error: (line: unknown) => lines.push(String(line)),
  });
  return { result, output: lines.join('\n').replace(/\x1B\[\d+m/g, '') };
}

test('TASK-2601: stored user_value classification with empty Backlog labels completes draft and passes px active startup preflight', async () => {
  await withStoredMission(['bug', 'user_value'], '[]', async (root) => {
    const draftCheck = normalizeDraftClassification(slug, root, { errorFn: () => null });
    assert.deepEqual(draftCheck, { ok: true, classification: 'user_value' });

    const draftLog: string[] = [];
    recordDraftStats({ slug, rootDir: root, agentFamily: 'claude', result: { telemetry: null }, log: (line: string) => { draftLog.push(line); return null; } });
    const draftOutput = draftLog.join('\n');
    assert.doesNotMatch(draftOutput, /Could not record draft stats/, draftOutput);
    assert.match(draftOutput, /Draft stats recorded: task-2599 stage=draft/);

    const draftRow = stats.loadMeasurementRows({ rootDir: root }).rows.find(row => row.mission === slug && row.stage === 'draft');
    assert.equal(draftRow?.classification, 'user_value');

    const { result, output } = runStartupPreflight(root);
    assert.doesNotMatch(output, /\[FAIL\].*classification/i, output);
    assert.match(output, /classification: user_value/);
    assert.deepEqual(result, { pass: true });
  });
});

test('TASK-2601: later stage-stat rows use the stored classification when the Backlog label conflicts', async () => {
  await withStoredMission(['user_value'], '[ai_sdlc]', async (root) => {
    assert.deepEqual(stats.resolveMissionClassification(slug, root), { classification: 'user_value', taskFile: null, source: 'mission' });

    stats.recordActiveStats({ slug, rootDir: root, implementer: 'codex' });
    stats.recordReviewStats({ slug, rootDir: root, reviewer: 'claude', implementer: 'codex' });
    stats.accumulateStageStats({ slug, stage: 'active', rootDir: root, implementer: 'codex' });
    const rows = stats.loadMeasurementRows({ rootDir: root }).rows.filter(row => row.mission === slug);
    assert.deepEqual([...new Set(rows.map(row => row.stage))].sort(), ['active', 'review']);
    assert.ok(rows.every(row => row.classification === 'user_value'), JSON.stringify(rows));

    const { result, output } = runStartupPreflight(root);
    assert.match(output, /\[PASS\] Mission classification: user_value/);
    assert.deepEqual(result, { pass: true });
  });
});

for (const [name, labels] of [['no', ['bug']], ['two', ['ai_sdlc', 'user_value']]] as const) {
  test(`TASK-2601: a stored Mission with ${name} classification fails clearly even when the Backlog label is valid`, async () => {
    await withStoredMission(labels, '[ai_sdlc]', async (root) => {
      const resolution = stats.resolveMissionClassification(slug, root);
      assert.equal(resolution.classification, null);
      assert.equal(resolution.source, 'mission');
      assert.match(resolution.error ?? '', /authoritative Mission state.*px classification set/);

      assert.throws(
        () => stats.recordStageStats({ slug, stage: 'active', rootDir: root, implementer: 'codex' }),
        /Cannot record stage stats for task-2599: Missing or invalid classification .* authoritative Mission state/,
      );
      assert.deepEqual(normalizeDraftClassification(slug, root, { errorFn: () => null }), { ok: false, reason: 'missing-classification' });

      const { result, output } = runStartupPreflight(root);
      assert.match(output, /\[FAIL\] Mission classification: Missing or invalid classification for task-2599 in authoritative Mission state/);
      assert.deepEqual(result, { pass: false });
    });
  });
}

test('TASK-2604: a task label cannot classify a Mission absent from px state', async () => {
  await withStoredMission(null, '[ai_sdlc]', async (root) => {
    const resolution = stats.resolveMissionClassification(slug, root);
    assert.equal(resolution.classification, null);
    assert.equal(resolution.source, 'mission');
    assert.equal(resolution.taskFile, null);
    assert.match(resolution.error ?? '', /absent from the px database/);
    assert.throws(
      () => stats.recordStageStats({ slug, stage: 'active', rootDir: root, implementer: 'codex' }),
      /absent from the px database/,
    );

    const { result, output } = runStartupPreflight(root);
    assert.match(output, /\[FAIL\].*classification/i);
    assert.deepEqual(result, { pass: false });
  });
  await withStoredMission(null, '[]', async (root) => {
    const resolution = stats.resolveMissionClassification(slug, root);
    assert.equal(resolution.classification, null);
    assert.match(resolution.error ?? '', /absent from the px database/);
  });
});

test('TASK-2604: an unreadable px database cannot be rescued by a task label', async () => {
  await withStoredMission(null, '[ai_sdlc]', async (root) => {
    const absent = path.join(root, 'missing.db');
    const resolution = stats.resolveMissionClassification(slug, root, () => ({ kind: 'unavailable', reason: `no Mission database at ${absent}` }));
    assert.equal(resolution.classification, null);
    assert.equal(resolution.source, 'mission');
    assert.equal(resolution.taskFile, null);
    assert.match(resolution.error ?? '', /Mission database unavailable.*no Mission database/);
  });
});

test('TASK-2604: integration statistics reject absent and unreadable Mission state', async () => {
  await withStoredMission(null, '[ai_sdlc]', async (root) => {
    await assert.rejects(
      stats.recordIntegrationStats({
        slug, rootDir: root,
        missionStore: { load: async () => ({ kind: 'missing' }) },
      }),
      /absent from the px database/,
    );
    await assert.rejects(
      stats.recordIntegrationStats({
        slug, rootDir: root,
        missionStore: { load: async () => { throw new Error('database locked'); } },
      }),
      /Cannot read Mission .*database locked/,
    );
    assert.deepEqual(stats.loadMeasurementRows({ rootDir: root }).rows, []);
  });
});

test('TASK-2601: stats backfill keeps stored Mission classification authoritative over provider fallbacks', async () => {
  for (const [labels, expected] of [[['user_value'], 'user_value'], [['bug'], null]] as const) {
    await withStoredMission(labels, '[ai_sdlc]', async (root) => {
      const taskDir = path.join(root, 'backlog', 'tasks');
      const taskFile = fs.readdirSync(taskDir).map(name => path.join(taskDir, name))[0];
      fs.writeFileSync(taskFile, fs.readFileSync(taskFile, 'utf8').replace('status: active', "status: done\nupdated_date: '2026-09-27 10:00'\nclassification: ai_sdlc"));
      const missionDir = path.join(root, 'docs', 'missions', '2026', slug);
      fs.mkdirSync(missionDir, { recursive: true });
      fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: workflow review checkpoint cli stats\n');
      fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# checkpoint\n');

      const report = await collectHistoricalStatsBackfill(root, { dbPath: path.join(root, 'measurements.db') });
      const entry = [...report.rows, ...report.unresolved].find(item => (item.mission ?? item.slug) === slug);
      assert.ok(entry, JSON.stringify(report));
      assert.equal(entry.classification, expected);
      assert.equal(entry.sources.classification, 'mission-state');
    });
  }
});

test('TASK-2604: historical backfill leaves a labelled task unresolved without a stored Mission', async () => {
  await withStoredMission(null, '[ai_sdlc]', async (root) => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    const taskFile = fs.readdirSync(taskDir).map(name => path.join(taskDir, name))[0];
    fs.writeFileSync(taskFile, fs.readFileSync(taskFile, 'utf8').replace('status: active', "status: done\nupdated_date: '2026-09-27 10:00'\nclassification: ai_sdlc"));
    const missionDir = path.join(root, 'docs', 'missions', '2026', slug);
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: workflow statistics\n');
    fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# checkpoint\n');

    const report = await collectHistoricalStatsBackfill(root, { dbPath: path.join(root, 'measurements.db') });
    assert.equal(report.rows.length, 0);
    const unresolved = report.unresolved.find(item => item.slug === slug);
    assert.ok(unresolved, JSON.stringify(report));
    assert.equal(unresolved.classification, null);
    assert.equal(unresolved.sources.classification, 'mission-state');
  });
});

function integratePreflightPorts(): IntegrateWorkflowPorts {
  return {
    missionPaths: {
      findMissionDir: () => null,
      resolveWorktree: () => '/mission',
      missionBranchName: () => `mission/${slug}`,
      missionDirForSlug: () => `/base/missions/${slug}`,
      findMissionDocInBranches: () => [],
      conventionalWorktreePath: () => process.cwd(),
    },
    backlog: {
      resolveTaskFile: () => ({ ok: true, taskFile: `/mission/backlog/tasks/${slug}.md` }),
      getTaskAssignee: () => 'codex',
      // The provider task carries a valid label; it must never classify a stored Mission.
      getTaskClassification: () => 'ai_sdlc',
      classificationFromLabels: (labels: readonly string[]) => {
        const found = new Set(labels.filter(label => ['ai_sdlc', 'user_value', 'unknown'].includes(label)));
        return found.size === 1 ? [...found][0] : null;
      },
      classificationLabels: () => new Set(['ai_sdlc', 'user_value', 'unknown']),
    },
    productConfig: { isForgejoReviewEnabled: () => false },
    git: {
      getCurrentBranch: () => `mission/${slug}`,
      git: (args: string[]) => ({ status: 0, stdout: args.includes('branch') ? 'main' : '', stderr: '' }),
      detectRebaseState: () => ({ inProgress: false }),
    },
    checkout: { getUnresolvedIndexConflicts: () => ({ ok: true, files: [] }) },
    fileSystem: { existsSync: () => false },
    forgejo: {}, review: {}, landing: {},
    stateMap: { toVirtual: () => 'ready-for-integration' },
  } as unknown as IntegrateWorkflowPorts;
}

test('TASK-2601: integration preflight never lets a Backlog label classify a stored Mission', async () => {
  const ports = integratePreflightPorts();
  const context = await createIntegrationContextBuilder(ports).buildIntegrationContext(slug, { baseBranch: 'main', baseWorktree: '/base' });
  for (const [missionLabels, failed] of [[[], true], [['bug'], true], [['user_value'], false]] as const) {
    const lines: string[] = [];
    const report = createIntegrationPreflight(ports).printIntegrationPreflight({
      ...context, missionLabels, missionStatus: 'integration',
      missionBrief: { goal: 'g', why: 'w', scope: null, outOfScope: [] },
    }, { log: (line: string) => lines.push(line) });
    assert.equal(report.failures.includes('classification'), failed, `${JSON.stringify(missionLabels)}: ${lines.join('\n')}`);
    if (failed) { assert.match(lines.join('\n'), /authoritative Mission state for task-2599/); }
  }
});
