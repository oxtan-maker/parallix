/** Manual real-px probe: isolated Git repository, state and deterministic executable. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-footer-'));
const root = path.join(temp, 'arbitrary-project');
const bin = path.join(temp, 'bin');
const env = { ...process.env, PARALLIX_HOME: path.join(temp, 'state'), PRIMARY_WORKTREE: root,
  PARALLIX_NO_BUBBLEWRAP: '1', PARALLIX_NO_TUI: '1', FORCE_COLOR: '0', PATH: `${bin}:${process.env.PATH}` };
for (const key of ['PARALLIX_WORKFLOW_OPERATION', 'PARALLIX_WORKFLOW_GENERATION', 'PARALLIX_MISSION_TERMINAL', 'PARALLIX_MISSION_SOCKET', 'PARALLIX_OPERATION_CAPTURE']) { delete env[key as keyof typeof env]; }
const entry = path.resolve('build/px.mjs');
const slug = 'task-example';
fs.mkdirSync(path.join(root, 'backlog/tasks'), { recursive: true });
fs.mkdirSync(path.join(root, 'config'), { recursive: true });
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'opencode'), `#!/usr/bin/env node
if (process.argv.includes('--help')) { console.log('stub help'); process.exit(0); }
console.error('scratch command diagnostic: deliberate nonzero exit');
for (let i = 0; i < 500; i++) console.log('verbose trailing row ' + i);
process.exitCode = 23;
`, { mode: 0o755 });
fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ product: { name: 'arbitrary-project' }, adapters: {
  terminal: { host: 'pipe', whenUnavailable: 'fallback' }, review: { provider: 'none' },
  missions: { branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' }, agents: { models: { custom: 'stub/model' } },
} }));
fs.writeFileSync(path.join(root, 'config/agents.json'), JSON.stringify({ steps: { draft: { eligible: ['custom'], selection: 'random' } } }));
fs.writeFileSync(path.join(root, 'backlog/tasks/task-example - Example.md'), '---\nid: TASK-EXAMPLE\ntitle: Example\nstatus: backlog\nlabels: []\n---\n\nExercise verbose command failure.\n');
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { env, stdio: 'pipe' });
let child: ReturnType<typeof spawn> | undefined;
try {
  git('init', '-b', 'main'); git('config', 'user.name', 'Scratch'); git('config', 'user.email', 'scratch@example.test');
  git('add', '.'); git('commit', '-m', 'scratch repository');
  const chunks: string[] = [];
  child = spawn(process.execPath, [entry, 'draft', slug, '--agent', 'custom'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.on('data', chunk => chunks.push(String(chunk)));
  child.stderr!.on('data', chunk => chunks.push(String(chunk)));
  const timer = setTimeout(() => child?.kill('SIGTERM'), 45000);
  const code = await new Promise<number | null>((resolve, reject) => { child!.once('exit', resolve); child!.once('error', reject); }).finally(() => clearTimeout(timer));
  const output = chunks.join('');
  console.log(`Real px exit: ${code}\n${output.slice(-12000)}`);
  assert.notEqual(code, 0);
  assert.ok(output.includes('verbose trailing row 499'), 'command must actually run');
  assert.ok(output.lastIndexOf('Workflow failure summary') > output.lastIndexOf('verbose trailing row 499'));
  assert.match(output, /Command: px draft task-example --agent custom \(exit \d+\)/);
  const ref = /run:workflow-[a-f0-9-]+:stdout@\d+\+\d+/.exec(output)?.[0];
  assert.ok(ref, 'footer must cite retained bytes');
  const retained = execFileSync(process.execPath, [entry, 'history', slug, 'show', ref], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
  assert.match(retained, /verbose trailing row 499/);
  console.log(`Retained output verified: ${ref}`);
} finally {
  if (child?.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); }
  fs.rmSync(temp, { recursive: true, force: true });
}
