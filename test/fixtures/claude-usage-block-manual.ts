/** Manual public CLI/browser exercise; no live provider or operator state.
 * Run: node --import tsx test/fixtures/claude-usage-block-manual.ts [--overload]
 * Default: Claude usage quota (hour-rounded reset block). --overload: structured 529
 * overloaded_error (exact five-minute ISO provider-unavailable block).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { SqliteBlocklistRepository } from '../../src/adapters/sqlite/blocklist-repository.js';
import { fixtureMission } from './mission-builders.js';
import { resolveCanonicalRepositoryId } from '../../src/adapters/git/repository-identity.js';
import { agentFamily } from '../../src/domain/agents.js';
import { changeRevision, ConfiguredReviewerEligibility, startReview } from '../../src/domain/review.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-manual-'));
const repo = path.join(root, 'repo');
const home = path.join(root, 'operator');
const bin = path.join(root, 'bin');
const clock = path.join(root, 'clock');
const preload = path.join(root, 'clock.mjs');
const cli = path.resolve('build/px.mjs');
const overload = process.argv.includes('--overload');
const slug = 'px-98026';
const worktree = path.join(root, slug);
const db = new SqliteDatabaseAdapter();
let web: ReturnType<typeof spawn> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const env = { PATH: `${bin}:${process.env.PATH}`, HOME: root, PARALLIX_HOME: home, PRIMARY_WORKTREE: repo,
  PARALLIX_NO_TUI: '1', PARALLIX_NO_BUBBLEWRAP: '1', TZ: 'Europe/Stockholm',
  NODE_OPTIONS: `--import=${preload}`, NO_COLOR: '1' };
function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
async function command(args: string[]) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout!.on('data', chunk => { output += chunk; }); child.stderr!.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    console.log(JSON.stringify({ args, code, output })); return { code, output };
  } finally { clearTimeout(timer); }
}
try {
  for (const dir of [repo, home, bin]) { fs.mkdirSync(dir); }
  fs.writeFileSync(clock, '2026-11-02T09:00:00+01:00');
  fs.writeFileSync(preload, `import fs from 'node:fs';
const NativeDate = Date;
const now = () => NativeDate.parse(fs.readFileSync(${JSON.stringify(clock)}, 'utf8'));
globalThis.Date = class extends NativeDate {
  constructor(...args) { if (args.length) { super(...args); } else { super(now()); } }
  static now() { return now(); }
};`);
  fs.writeFileSync(path.join(root, '.bashrc'), `export PATH='${bin}':$PATH\n`);
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
if [ "$1" = --help ]; then echo 'installed Claude stub'; exit 0; fi
echo claude >> '${root}/launches'
${overload
    ? `echo '{"type":"result","is_error":true,"api_error_status":529,"api_error":"overloaded_error"}'
echo 'API Error: 529 overloaded_error' >&2`
    : `echo '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1793613000},"api_error_status":429,"api_error":"usage_limit_reached"}'
echo 'You’ve hit your 5-hour limit · resets 10:50am (Europe/Stockholm)' >&2`}
exit 1
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'opencode'), `#!/bin/sh
if [ "$1" != run ]; then echo 'installed fallback stub'; exit 0; fi
echo custom >> '${root}/launches'
echo 'Manual fallback reviewer reached'
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(repo, 'payload.txt'), 'disposable\n');
  fs.writeFileSync(path.join(repo, 'check.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({ adapters: {
    terminal: { host: 'pipe' }, review: { provider: 'none' }, verification: { command: './check.sh' },
    agents: { models: { custom: 'fixture/model' } },
  } }));
  fs.mkdirSync(path.join(repo, 'config'));
  fs.writeFileSync(path.join(repo, 'config/agents.json'), JSON.stringify({ families: ['claude', 'custom'], steps: {
    review: { eligible: ['claude', 'custom'], selection: 'random' }, active: { eligible: ['custom'], selection: 'random' },
  } }));
  git(repo, 'init', '-qb', 'main'); git(repo, 'config', 'user.name', 'Manual'); git(repo, 'config', 'user.email', 'manual@example.invalid');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'disposable base');
  git(repo, 'worktree', 'add', '-qb', `mission/${slug}`, worktree);
  fs.writeFileSync(path.join(worktree, 'implementation.txt'), 'disposable implementation\n');
  git(worktree, 'add', '.'); git(worktree, 'commit', '-qm', 'implementation');
  const review = startReview({ change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
    revision: changeRevision(git(worktree, 'rev-parse', 'HEAD')) }, agentFamily('claude'), agentFamily('codex'),
    '2026-11-02T08:00:00Z', ConfiguredReviewerEligibility.fromReviewStep({ eligible: ['claude', 'custom'].map(agentFamily), strategy: 'random' }));
  await db.open({ path: path.join(home, 'parallix.db') });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  await new SqliteMissionStore(db).save(fixtureMission(slug, { repositoryId: resolveCanonicalRepositoryId(repo), status: 'review', review,
    assignee: agentFamily('codex'), brief: { goal: 'Retain payload', why: 'manual exercise', scope: 'temporary only', outOfScope: ['real data'] },
    successCriteria: ['Retain payload'], completedSuccessCriteria: [0], declaredGates: ['./check.sh'], predictedNelBucket: 'Small',
    checkpoints: [{ missionId: fixtureMission(slug).id, name: 'CP-1', goalCheck: [{ criterion: 'Retain payload', evidence: 'payload.txt' }], nextActionText: 'review' }],
  }), null);
  await command(['review', slug]);
  const actionRows = await db.query<{ event_data: string }>(
    "SELECT event_data FROM operational_history WHERE event_type = 'review.action-started' ORDER BY id",
  );
  const reviewActions = actionRows.map(row => JSON.parse(row.event_data) as { action: string; actionSequence: number });
  assert.deepEqual(reviewActions.map(action => [action.actionSequence, action.action]),
    [[1, 'agent'], [2, 'agent'], [3, 'repair'], [4, 'repair']],
    'reviewer starts and the peer reviewer recovery launches share the lifetime durable counter');
  const launches = fs.readFileSync(path.join(root, 'launches'), 'utf8').trim().split('\n');
  assert.deepEqual(launches.slice(0, 2), ['claude', 'custom']);
  assert.equal(launches.filter(family => family === 'claude').length, 1);
  const blocks = new SqliteBlocklistRepository(db);
  const block = await blocks.findByAgent('claude');
  // The frozen clock makes the overload expiry exact: 09:00+01:00 plus five minutes.
  assert.equal(block?.until, overload ? '2026-11-02T08:05:00.000Z' : '2026-11-02 11');
  assert.equal(block.reason, overload ? 'typed: provider-unavailable' : 'typed: agent-quota');
  if (overload) {
    const status = await command(['status', slug]);
    assert.match(status.output, /claude: blocked until 2026-11-02T08:05:00\.000Z \(typed: provider-unavailable\)/);
  }
  console.log(JSON.stringify({ launches, reviewActions, block }));
  web = spawn(process.execPath, [cli, 'web', '--port', '0'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const origin = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`web startup: ${output}`)), 15_000);
    const read = (chunk: Buffer) => {
      output += chunk; const match = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    web!.stdout!.on('data', read); web!.stderr!.on('data', read);
    web!.once('exit', () => { clearTimeout(timer); reject(new Error(output)); });
  });
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--disable-extensions'] });
  const page = await browser.newPage(); await page.goto(origin);
  const snapshot = async () => await (await fetch(`${origin}/api/board`)).json() as { agentAvailability: { family: string; available: boolean; reason: string | null; blockedFor: { ms?: number } }[] };
  const active = (await snapshot()).agentAvailability.find(item => item.family === 'claude')!;
  assert.equal(active.available, false); assert.equal(active.reason, block.reason); assert.equal(active.blockedFor.ms, overload ? 300_000 : 7_200_000);
  await page.getByTitle(block.reason!, { exact: true }).waitFor();
  assert.match(await page.getByTitle(block.reason!, { exact: true }).innerText(), overload ? /blocked · 5m/ : /blocked · 2h/);
  const openPicker = async () => {
    const button = page.locator(`article[data-board-card="${slug}"] button[aria-haspopup="menu"]`).first();
    await button.focus(); await button.press('ArrowDown');
  };
  await openPicker();
  const item = page.getByRole('menuitem').filter({ hasText: 'claude —' });
  assert.equal(await item.isDisabled(), true); assert.match(await item.innerText(), overload ? /provider-unavailable.*5m/ : /agent-quota.*2h/);
  console.log(JSON.stringify({ active, picker: await item.innerText() }));
  await page.keyboard.press('Escape');
  fs.writeFileSync(clock, overload ? '2026-11-02T09:05:00+01:00' : '2026-11-02T11:00:00+01:00');
  await page.reload();
  // The subscription refreshes its existing projection on its normal poll.
  await page.waitForFunction(async () => {
    const board = await (await fetch('/api/board')).json();
    const item = board.agentAvailability.find((candidate: { family: string }) => candidate.family === 'claude');
    return item?.available === true && item.reason === null && item.blockedFor.ms === 0;
  }, { timeout: 15_000 });
  assert.deepEqual(await blocks.findByAgent('claude'), block, 'expiry is interpreted without rewriting the stored row');
  if (overload) { assert.match((await command(['status', slug])).output, /claude: available/); }
  console.log(JSON.stringify({ expiry: 'available with no reason and zero blocked duration', result: 'PASS' }));
} finally {
  await browser?.close();
  if (web && web.exitCode === null && web.signalCode === null) {
    const exited = new Promise(resolve => web!.once('exit', resolve)); web.kill('SIGTERM');
    const timer = setTimeout(() => web!.kill('SIGKILL'), 3000); await exited; clearTimeout(timer);
  }
  await db.close(); fs.rmSync(root, { recursive: true, force: true });
  console.log('Cleanup: removed disposable repository, stub launchers, clock and SQLite state; browser and web stopped.');
}
