/** Disposable public web integration observation (TASK-2777). Run with npx tsx. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { resolveProcessConfiguration } from '../../src/composition/config.js';
import { createProductionApplicationServices } from '../../src/composition/application-services.js';
import { composeWorkflowOperations, runWorkflowWorker } from '../../src/composition/workflow-operations.js';
import { createWebHost } from '../../src/interfaces/web/host.js';
import { loadWebAssets } from '../../src/adapters/web/asset-store.js';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { fixtureMission } from './mission-builders.js';
import { resolveCanonicalRepositoryId } from '../../src/adapters/git/repository-identity.js';
import { applyReviewerCommand, startReview, changeRevision, ConfiguredReviewerEligibility } from '../../src/domain/review.js';
import { missionId, missionLabels } from '../../src/domain/mission.js';
import { agentFamily } from '../../src/domain/agents.js';
async function until(check: () => Promise<boolean>, description: string, timeout: number) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() > deadline) { throw new Error(description); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

const source = import.meta.filename;
const tsx = createRequire(import.meta.url).resolve('tsx');
const cli = { command: process.execPath, args: ['--import', tsx, source] };
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
if (process.argv[2]?.startsWith('--workflow-')) {
  process.exitCode = await runWorkflowWorker(process.argv[3], process.argv[4], resolveProcessConfiguration(), process.argv[2] === '--workflow-execute');
} else if (process.argv[2] === '--host') {
  const root = process.cwd();
  const configuration = resolveProcessConfiguration();
  const graph = await createProductionApplicationServices(root, undefined, { configuration });
  const owned = await composeWorkflowOperations(root, configuration, graph.presentationCapabilities!.commandController,
    path.join(process.env.PARALLIX_HOME!, 'parallix.db'), async () => 'codex', cli, false);
  const host = createWebHost({ assets: loadWebAssets(process.argv[3]), commandDispatcher: () => owned.service });
  process.send?.({ ...await host.start(), cwd: process.cwd() });
  process.on('message', () => process.send?.({ cwd: process.cwd() }));
  process.once('disconnect', () => { void (async () => { await host.close(); await owned.close(); await graph.operatorState.close(); })(); });
} else {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'px-web-landing-')));
  const root = path.join(parent, 'repo');
  const home = path.join(parent, 'operator');
  const slug = 'task-97779';
  const worktree = `${root}-${slug}`;
  const database = new SqliteDatabaseAdapter();
  let child: ReturnType<typeof fork> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    fs.mkdirSync(root); fs.mkdirSync(home);
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.name', 'Disposable Operator'); git(root, 'config', 'user.email', 'operator@example.invalid');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'none' }, terminal: { host: 'pipe', whenUnavailable: 'fallback' }, verification: { command: 'git diff --check', defaultArea: 'all' } } }));
    fs.writeFileSync(path.join(root, 'README.md'), 'Disposable integration repository\n');
    git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
    for (const remote of ['origin', 'review']) {
      const bare = path.join(parent, `${remote}.git`); fs.mkdirSync(bare); git(bare, 'init', '--bare', '-q', '-b', 'main');
      git(root, 'remote', 'add', remote, bare); git(root, 'push', '-q', remote, 'main');
    }
    git(root, 'worktree', 'add', '-qb', `mission/${slug}`, worktree);
    fs.mkdirSync(path.join(worktree, 'backlog/tasks'), { recursive: true });
    fs.writeFileSync(path.join(worktree, `backlog/tasks/${slug} - Disposable.md`), `---\nid: TASK-97779\ntitle: Disposable\nstatus: approved\nlabels: [user_value]\n---\n`);
    fs.writeFileSync(path.join(worktree, 'payload.txt'), 'landed from the web\n');
    git(worktree, 'add', '.'); git(worktree, 'commit', '-qm', 'feat: disposable web payload');
    const revision = git(worktree, 'rev-parse', 'HEAD');
    const reviewer = agentFamily('claude');
    const review = applyReviewerCommand(startReview({ change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
      revision: changeRevision(revision) }, reviewer, agentFamily('codex'), new Date().toISOString(),
      ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' })),
    { type: 'approve', decidedAt: new Date().toISOString(), comment: null, source: { kind: 'local' } });
    await database.open({ path: path.join(home, 'parallix.db') });
    await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
    const store = new SqliteMissionStore(database);
    await store.save(fixtureMission(slug, { repositoryId: resolveCanonicalRepositoryId(root), status: 'integration', labels: missionLabels(['user_value']), assignee: agentFamily('codex'),
      brief: { goal: 'Land disposable payload', why: 'Observe public web integration', scope: 'payload', outOfScope: ['operator state'] }, review }), null);
    child = fork(source, ['--host', path.resolve('build/web')], { cwd: root, execArgv: ['--import', tsx],
      env: { PATH: process.env.PATH, HOME: parent, PARALLIX_HOME: home, PRIMARY_WORKTREE: root, PARALLIX_NO_TUI: '1', DEBUG: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout?.on('data', chunk => process.stdout.write(chunk)); child.stderr?.on('data', chunk => process.stderr.write(chunk));
    const info = await new Promise<{ origin: string; cwd: string }>((resolve, reject) => { child!.once('message', message => resolve(message as never)); child!.once('exit', code => reject(new Error(`Host exited ${code}`))); });
    assert.equal(info.cwd, root); assert.equal(git(root, 'branch', '--show-current'), 'main');
    browser = await chromium.launch({ args: ['--disable-extensions'], executablePath: '/usr/bin/chromium', headless: true });
    const page = await browser.newPage(); await page.goto(info.origin);
    const admitted = await page.evaluate(async missionId => {
      const csrf = document.querySelector<HTMLMetaElement>('meta[name="px-csrf"]')!.content;
      const response = await fetch('/api/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-px-csrf': csrf },
        body: JSON.stringify({ kind: 'integrate:merge', missionId, missionStatusAtRequest: 'integration', requestKey: crypto.randomUUID() }) });
      return { status: response.status, body: await response.json() };
    }, slug);
    console.log('ADMISSION', JSON.stringify(admitted)); assert.equal(admitted.status, 202);
    let operation: { phase: string; reason?: string };
    await until(async () => {
      operation = await page.evaluate(async url => (await (await fetch(url)).json()).operation, admitted.body.value.statusUrl);
      return ['completed', 'failed', 'blocked', 'stopped'].includes(operation.phase);
    }, 'local web landing', 60_000);
    console.log('OUTCOME', JSON.stringify(operation!));
    assert.equal(operation!.phase, 'completed');
    const after = await new Promise<{ cwd: string }>(resolve => { child!.once('message', message => resolve(message as never)); child!.send('cwd'); });
    assert.equal(after.cwd, info.cwd);
    assert.equal(fs.readFileSync(path.join(root, 'payload.txt'), 'utf8'), 'landed from the web\n');
    const loaded = await store.load(missionId(slug)); assert.equal(loaded.kind, 'found');
    if (loaded.kind === 'found') { assert.equal(loaded.mission.status, 'done'); assert.ok(loaded.mission.closedAt); }
    console.log(JSON.stringify({ result: 'PASS', hostBranch: git(root, 'branch', '--show-current'), cwdBefore: info.cwd, cwdAfter: after.cwd, landedCommit: git(root, 'rev-parse', 'HEAD'), payload: 'landed from the web', closed: true, missionWorktreeRemoved: !fs.existsSync(worktree), remotes: ['disposable origin', 'disposable review'], interface: 'Chromium authenticated POST /api/commands and GET operation outcome', limitation: 'Local mode; no real Forgejo or paid models' }));
  } finally {
    await browser?.close(); child?.disconnect();
    if (child && child.exitCode === null) { await new Promise<void>(resolve => { const timer = setTimeout(() => { child!.kill('SIGKILL'); resolve(); }, 5000); child!.once('exit', () => { clearTimeout(timer); resolve(); }); }); }
    await database.close(); fs.rmSync(parent, { recursive: true, force: true });
  }
}
