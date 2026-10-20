/** Disposable public CLI/tmux observation. Run: npx tsx test/fixtures/rebase-recovery-manual.ts */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { resolveCanonicalRepositoryId } from '../../src/adapters/git/repository-identity.js';
import { fixtureMission } from './mission-builders.js';
import { agentFamily } from '../../src/domain/agents.js';
import { resolveConfiguration } from '../../src/composition/config.js';
import { prepareTmuxLaunch } from '../../src/adapters/process/tmux-host.js';
import { missionTerminalIdentity } from '../../src/adapters/process/mission-terminal-identity.js';
import { missionCommandTarget } from '../../src/composition/mission-command-context.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-rebase-manual-'));
const base = path.join(root, 'repo');
const slug = 'task-97780';
const worktree = `${base}-${slug}`;
const home = path.join(root, 'home');
const bin = path.join(root, 'bin');
const cli = path.resolve('build/px.mjs');
const database = new SqliteDatabaseAdapter();
const env = { HOME: root, PARALLIX_HOME: home, PRIMARY_WORKTREE: base,
  PATH: `${bin}:${process.env.PATH}`, PARALLIX_NO_TUI: '1', SHELL: '/bin/bash', PARALLIX_MISSION_TERMINAL: slug };
const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const write = (cwd: string, file: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), body);
};
const invoke = (...args: string[]) => {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: base, env, encoding: 'utf8', timeout: 30_000 });
  console.log(JSON.stringify({ command: args, status: result.status, stdout: result.stdout, stderr: result.stderr }));
  return result;
};
let terminal: ReturnType<typeof prepareTmuxLaunch> | undefined;
try {
  fs.mkdirSync(base); fs.mkdirSync(home); fs.mkdirSync(bin);
  git(base, 'init', '-qb', 'main'); git(base, 'config', 'user.email', 'manual@example.invalid'); git(base, 'config', 'user.name', 'Manual');
  write(base, 'shared.txt', 'base\n');
  write(base, 'workflow.config.json', JSON.stringify({ adapters: { terminal: { host: 'pipe' }, verification: { command: 'pwd; test -f repaired' } } }));
  git(base, 'add', '.'); git(base, 'commit', '-qm', 'base');
  git(base, 'worktree', 'add', '-qb', `mission/${slug}`, worktree);
  write(worktree, 'shared.txt', 'mission one\n'); git(worktree, 'commit', '-qam', 'first mission intent');
  write(worktree, 'shared.txt', 'mission two\n'); git(worktree, 'commit', '-qam', 'second mission intent');
  write(base, 'shared.txt', 'new main\n'); git(base, 'commit', '-qam', 'new main behavior');
  const baseHead = git(base, 'rev-parse', 'HEAD');
  const baseStatus = git(base, 'status', '--porcelain');
  const previousCwd = process.cwd();
  process.chdir(base);
  try { assert.equal(missionCommandTarget('verify', [], base, resolveConfiguration(env)), worktree); }
  finally { process.chdir(previousCwd); }
  await database.open({ path: path.join(home, 'parallix.db') });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  await new SqliteMissionStore(database).save(fixtureMission(slug, {
    repositoryId: resolveCanonicalRepositoryId(base), assignee: agentFamily('codex'), review: null,
    checkpoints: [], brief: { goal: 'Manual recovery', why: 'Observe public interfaces', scope: 'disposable files', outOfScope: ['real state'] },
  }), null);
  await database.close();
  // Controlled implementer boundary: preserve both intents after semantic inspection
  // of this known fixture. Finish successive pauses within a finite budget.
  write(bin, 'codex', `#!/bin/sh
while [ $# -gt 0 ] && [ "$1" != "--cd" ]; do shift; done
[ $# -gt 0 ] || exit 0
cd "$2" || exit 1
echo launched >> '${root}/launches'
for pause in 1 2 3 4 5; do
  git diff --name-only --diff-filter=U >> '${root}/conflicts'
  printf 'new main\\nmission one\\nmission two\\n' > shared.txt
  touch repaired
  git add shared.txt repaired
  GIT_EDITOR=true git rebase --continue && exit 0
  [ -n "$(git diff --name-only --diff-filter=U)" ] || exit 1
done
exit 1
`);
  fs.chmodSync(path.join(bin, 'codex'), 0o755);
  write(bin, 'px', `#!/bin/sh\nexec '${process.execPath}' '${cli}' "$@"\n`); fs.chmodSync(path.join(bin, 'px'), 0o755);
  const failed = invoke('verify', worktree);
  assert.notEqual(failed.status, 0, 'unrepaired fixture gate must fail');
  const result = invoke('rebase', slug);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(git(worktree, 'diff', '--name-only', '--diff-filter=U'), '');
  assert.equal(fs.existsSync(git(worktree, 'rev-parse', '--path-format=absolute', '--git-path', 'rebase-merge')), false);
  assert.equal(git(worktree, 'status', '--porcelain'), '');
  assert.equal(fs.readFileSync(path.join(worktree, 'shared.txt'), 'utf8'), 'new main\nmission one\nmission two\n');
  assert.ok(fs.readFileSync(path.join(root, 'conflicts'), 'utf8').trim().split('\n').length >= 2);
  assert.equal(fs.readFileSync(path.join(root, 'launches'), 'utf8').trim().split('\n').length, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /infrastructure|attempt 2\/2/i);
  assert.equal(invoke('verify', worktree).status, 0, 'repaired fixture gate must pass');
  // Make interactive rc reproduce the incident's base checkout cwd.
  write(root, '.bashrc', `cd '${base}'\n`);
  const configuration = resolveConfiguration(env);
  terminal = prepareTmuxLaunch({ identity: missionTerminalIdentity({ repositoryKey: 'manual', missionId: slug }),
    runId: 'workflow-00000000-0000-4000-8000-000000097780', spawnIndex: 0, command: '/bin/true', args: [], cwd: base, env }, { configuration });
  const host = spawnSync(terminal.command, terminal.args, { env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(host.status, 0, host.stderr);
  const report = path.join(root, 'console-result');
  const wrapper = path.join(path.dirname(terminal.socketPath), terminal.sessionName, 'console-bin/px');
  const command = `${wrapper} rebase ${slug} > '${report}' 2>&1; echo $? > '${report}.exit'`;
  const tmux = (...args: string[]) => spawnSync('tmux', ['-S', terminal!.socketPath, ...args], { encoding: 'utf8', timeout: 5000 });
  assert.equal(tmux('send-keys', '-t', `=${terminal.sessionName}:console`, '-l', command).status, 0);
  tmux('send-keys', '-t', `=${terminal.sessionName}:console`, 'Enter');
  for (let i = 0; i < 100 && !fs.existsSync(`${report}.exit`); i++) { await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(fs.readFileSync(`${report}.exit`, 'utf8').trim(), '0', fs.readFileSync(report, 'utf8'));
  console.log('TMUX', fs.readFileSync(report, 'utf8'));
  for (const [index, args] of [ ['active', slug, '--execute'], ['review', slug, '--submit'], ['review', slug, '--continue'] ].entries()) {
    const output = `${report}-${index}`;
    const invocation = `${wrapper} ${args.join(' ')} > '${output}' 2>&1; echo $? > '${output}.exit'`;
    tmux('send-keys', '-t', `=${terminal.sessionName}:console`, '-l', invocation);
    tmux('send-keys', '-t', `=${terminal.sessionName}:console`, 'Enter');
    for (let i = 0; i < 200 && !fs.existsSync(`${output}.exit`); i++) { await new Promise(resolve => setTimeout(resolve, 100)); }
    const text = fs.readFileSync(output, 'utf8');
    console.log('TMUX PREFLIGHT', JSON.stringify({ args, status: fs.readFileSync(`${output}.exit`, 'utf8'), output: text }));
    assert.equal(fs.readFileSync(`${output}.exit`, 'utf8').trim(), '1', 'fixture admission blockers remain enforced');
    assert.doesNotMatch(text, /current branch.*main|Backlog context: does not resolve|Inherited workflow does not own/);
    assert.match(text, /preflight|checkpoint|criterion|criteria|gate|review/i);
  }
  assert.equal(git(base, 'rev-parse', 'HEAD'), baseHead); assert.equal(git(base, 'status', '--porcelain'), baseStatus);
  assert.equal(git(base, 'branch', '--show-current'), 'main');
  assert.equal(fs.existsSync(path.join(worktree, 'backlog')), false);
  console.log('PASS: database-only CLI rebase, successive pauses, repaired fixture gate, generated px wrapper in real tmux, clean completion, unchanged base');
} finally {
  if (terminal) { spawnSync('tmux', ['-S', terminal.socketPath, 'kill-server'], { timeout: 5000 }); terminal.cleanup(); }
  await database.close(); fs.rmSync(root, { recursive: true, force: true });
}
