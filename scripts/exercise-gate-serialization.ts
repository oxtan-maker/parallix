/** Disposable public CLI exercise. Requires the current npm run build artifact. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const repository = process.cwd();
const cli = path.join(repository, 'build/px.mjs');
assert.ok(fs.existsSync(cli), 'Run npm run build first');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-public-gate-exercise-'));
const base = path.join(root, 'base');
const worktree = path.join(root, 'mission');
const shared = path.join(root, 'leases');
const trace = path.join(root, 'trace');
const release = path.join(root, 'release');
const children: { child: ReturnType<typeof spawn>; exit: Promise<number | null> }[] = [];
const abort = new AbortController();
const stop = () => abort.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

async function until(check: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!check()) {
    abort.signal.throwIfAborted();
    assert.ok(Date.now() < deadline, `Timed out: ${description}`);
    await pause(10);
  }
}
function git(args: string[]): void {
  const result = spawnSync('git', ['-C', base, ...args], { encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(result.status, 0, result.stderr);
}
function launch(checkout: string, name: string) {
  const home = path.join(root, `operator-${name}`);
  fs.mkdirSync(home);
  let output = '';
  const child = spawn(process.execPath, [cli, 'verify', 'all'], { cwd: checkout, stdio: 'pipe', env: {
    ...process.env, PARALLIX_HOME: home, FORGEJO_HOME: path.join(home, 'forgejo'),
    PARALLIX_CUSTOM_ADMISSION_HOME: shared, PARALLIX_CUSTOM_ADMISSION_REPOSITORY: undefined,
    PARALLIX_GATE_OWNER: undefined, PARALLIX_WORKFLOW_OPERATION: undefined, PARALLIX_WORKFLOW_GENERATION: undefined,
    EXERCISE_NAME: name, EXERCISE_TRACE: trace, EXERCISE_RELEASE: release,
  } });
  child.stdout!.on('data', data => { output += String(data); });
  child.stderr!.on('data', data => { output += String(data); });
  const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
  children.push({ child, exit });
  return { child, exit, output: () => output };
}
try {
  fs.mkdirSync(base);
  const policy = JSON.parse(fs.readFileSync(path.join(repository, 'workflow.config.json'), 'utf8')) as { adapters: { gates: { maxConcurrent: number } } };
  assert.equal(policy.adapters.gates.maxConcurrent, 1, 'repository opt-in');
  fs.writeFileSync(path.join(base, 'workflow.config.json'), JSON.stringify({ adapters: {
    gates: { maxConcurrent: policy.adapters.gates.maxConcurrent }, verification: { command: 'node gate.mjs', defaultArea: 'all' },
  } }));
  fs.writeFileSync(path.join(base, 'gate.mjs'), `import fs from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
const { EXERCISE_NAME: name, EXERCISE_TRACE: trace, EXERCISE_RELEASE: release } = process.env;
fs.appendFileSync(trace, name + ' start ' + Date.now() + '\\n');
if (name === 'a') { while (!fs.existsSync(release)) { await pause(10); } }
fs.appendFileSync(trace, name + ' end ' + Date.now() + '\\n');
`);
  git(['init', '-qb', 'main']); git(['add', '.']);
  git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  git(['worktree', 'add', '-qb', 'mission/exercise', worktree]);
  const inherited = JSON.parse(fs.readFileSync(path.join(worktree, 'workflow.config.json'), 'utf8')) as typeof policy;
  assert.equal(inherited.adapters.gates.maxConcurrent, 1);
  const first = launch(base, 'a');
  await until(() => fs.existsSync(trace), 'first public gate starts');
  const second = launch(worktree, 'b');
  // Confirm independent non-gate work can run while verification owns its lease.
  const config = spawnSync(process.execPath, [cli, 'config'], { cwd: worktree, encoding: 'utf8',
    env: { ...process.env, PARALLIX_HOME: path.join(root, 'config-home'), PARALLIX_CUSTOM_ADMISSION_HOME: shared, PARALLIX_GATE_OWNER: undefined } });
  assert.equal(config.status, 0, config.stderr);
  assert.match(config.stdout, /"maxConcurrent": 1/);
  await pause(150);
  assert.deepEqual(fs.readFileSync(trace, 'utf8').trim().split('\n').map(row => row.split(' ').slice(0, 2).join(' ')), ['a start']);
  fs.writeFileSync(release, '');
  await until(() => children.every(item => item.child.exitCode !== null), 'both public gates finish');
  assert.equal(await first.exit, 0, first.output());
  assert.equal(await second.exit, 0, second.output());
  const rows = fs.readFileSync(trace, 'utf8').trim().split('\n');
  assert.deepEqual(rows.map(row => row.split(' ').slice(0, 2).join(' ')), ['a start', 'a end', 'b start', 'b end']);
  const db = new DatabaseSync(path.join(shared, 'custom-admission.db'));
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM custom_agent_leases').get()!.count, 0); }
  finally { db.close(); }
  console.log('Inherited maxConcurrent=1; independent px config completed while gate a held ownership.');
  console.log(rows.join('\n'));
  console.log('Both public CLI runs exited 0; remaining leases=0.');
} finally {
  fs.writeFileSync(release, '');
  for (const { child } of children) { if (child.exitCode === null) { child.kill('SIGTERM'); } }
  await Promise.all(children.map(item => item.exit));
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`Cleaned disposable fixtures: ${!fs.existsSync(root)}; child processes settled.`);
}
