/** Disposable public CLI observation: npx tsx test/fixtures/status-authority-manual.ts */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { resolveCanonicalRepositoryId } from '../../src/adapters/git/repository-identity.js';
import { repositoryId } from '../../src/domain/repository.js';
import { fixtureMission } from './mission-builders.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-status-authority-'));
const base = path.join(root, 'repo');
const home = path.join(root, 'operator');
const cli = path.resolve('build/px.mjs');
const database = new SqliteDatabaseAdapter();
const env = { PATH: process.env.PATH, HOME: root, PARALLIX_HOME: home,
  PRIMARY_WORKTREE: base, NO_COLOR: '1', PARALLIX_NO_TUI: '1' };
const git = (...args: string[]) => {
  const result = spawnSync('git', ['-C', base, ...args], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
};
try {
  fs.mkdirSync(base); fs.mkdirSync(home);
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Manual'); git('config', 'user.email', 'manual@example.invalid');
  fs.writeFileSync(path.join(base, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'none' } } }));
  fs.mkdirSync(path.join(base, 'backlog/tasks'), { recursive: true });
  fs.writeFileSync(path.join(base, 'backlog/tasks/task-live-mirror - Fixture.md'), '---\nid: TASK-LIVE-MIRROR\ntitle: Fixture\nstatus: done\n---\n');
  git('add', '.'); git('commit', '-qm', 'isolated status fixture');
  const slugs = ['task-active', 'task-review', 'task-integration', 'task-live-mirror', 'task-done', 'task-closed', 'task-missing', 'task-foreign'];
  for (const slug of slugs) {
    // The normal branch parser accepts mixed case and canonicalizes the id.
    const branchSlug = slug === 'task-active' ? slug.toUpperCase() : slug;
    git('worktree', 'add', '-qb', `mission/${branchSlug}`, path.join(root, slug));
  }
  await database.open({ path: path.join(home, 'parallix.db') });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(database);
  const repo = resolveCanonicalRepositoryId(base);
  for (const slug of slugs.filter(slug => slug !== 'task-missing')) {
    const status = slug === 'task-review' ? 'review' : slug === 'task-integration' ? 'integration'
      : ['task-done', 'task-closed', 'task-foreign'].includes(slug) ? 'done' : 'active';
    await store.save(fixtureMission(slug, { status, checkpoints: [],
      closedAt: slug === 'task-closed' ? '2026-10-01T00:00:00Z' : null,
      repositoryId: slug === 'task-foreign' ? repositoryId('other-repository') : repo,
    }), null);
  }
  await database.close();
  const result = spawnSync(process.execPath, [cli, 'status'], { cwd: base, env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  console.log(result.stdout.replaceAll(root, '<fixture>'));
  for (const slug of slugs.slice(0, 4)) { assert.ok(!result.stdout.includes(path.join(root, slug)), `${slug} is live`); }
  for (const slug of ['task-done', 'task-closed']) {
    assert.ok(result.stdout.includes(`Stale worktree: ${path.join(root, slug)}`));
    assert.ok(result.stdout.includes(`px integrate ${slug} --recover-landed`));
  }
  for (const slug of ['task-missing', 'task-foreign']) {
    assert.ok(result.stdout.includes(`Worktree state uncertain: ${path.join(root, slug)}`));
    assert.ok(!result.stdout.includes(`px integrate ${slug}`));
  }
  console.log('PASS: 4 live suppressed; done/closed recovery; missing/foreign uncertainty; no cleanup executed.');
} finally {
  await database.close();
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(!fs.existsSync(root));
  console.log('Fixtures cleaned: Git repository, 8 linked worktrees and isolated operator SQLite database.');
}
