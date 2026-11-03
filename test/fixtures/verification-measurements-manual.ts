/** Manual public-command exercise; disposable Git/operator state, no model or E2E suite. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { run } from '../../src/composition/create-cli.js';
import { configureMissionWriteAuthorization } from '../../src/application/ports/mission-write-authorization.js';
import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../src/adapters/agents/agents.js';
import { clearOperatorStateCache } from '../../src/adapters/sqlite/adapter-factory.js';
import { createVerificationStatisticsReader } from '../../src/composition/verification-statistics.js';
import { resolveProcessConfiguration } from '../../src/composition/config.js';

const source = process.cwd();
const output = path.resolve(process.argv[2] ?? 'tmp/verification-lifecycle');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'px-verification-manual-'));
const base = path.join(temporary, 'repo');
const slug = 'px-0001';
const worktree = path.join(temporary, `repo-${slug}`);
const previous = { ...process.env };
const logs: { root: string; args: string[]; status: number; stdout: string; stderr: string }[] = [];
fs.mkdirSync(base);
fs.mkdirSync(output, { recursive: true });
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const criterion = 'The disposable change survives verification and review';
let fakeRepairs = 0;
function jsonOutput(output: string): unknown { return JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1)); }

async function command(root: string, args: string[]) {
  const oldCwd = process.cwd();
  const stdout = process.stdout.write, stderr = process.stderr.write;
  const entry = { root, args, status: -1, stdout: '', stderr: '' };
  logs.push(entry);
  process.chdir(root);
  process.stdout.write = ((chunk: string | Uint8Array) => { entry.stdout += String(chunk); return true; }) as typeof stdout;
  process.stderr.write = ((chunk: string | Uint8Array) => { entry.stderr += String(chunk); return true; }) as typeof stderr;
  try {
    entry.status = await run(args, { baseCwd: root,
      log: line => { entry.stdout += `${line}\n`; return ''; }, error: line => { entry.stderr += `${line}\n`; return ''; } });
  } finally { process.stdout.write = stdout; process.stderr.write = stderr; process.chdir(oldCwd); }
  fs.writeFileSync(path.join(output, 'commands.json'), JSON.stringify(logs, null, 2));
  return entry;
}
async function requireCommand(root: string, args: string[]) {
  const result = await command(root, args);
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}

try {
  for (const key of Object.keys(process.env).filter(key => /^PARALLIX_/.test(key))) delete process.env[key];
  Object.assign(process.env, { PARALLIX_HOME: path.join(temporary, 'operator'),
    PARALLIX_CUSTOM_ADMISSION_HOME: path.join(temporary, 'admission'), PRIMARY_WORKTREE: base,
    PARALLIX_NO_BUBBLEWRAP: '1', PARALLIX_NO_TUI: '1', PARALLIX_TEST_NO_FORGEJO: '1',
    PARALLIX_VERIFICATION_PROFILE_REPORT: path.join(source, 'evidence/verification-profile/report.json'), FORCE_COLOR: '0' });
  fs.mkdirSync(path.join(base, 'config'));
  fs.writeFileSync(path.join(base, 'config/agents.json'), JSON.stringify({ families: ['custom'],
    steps: { draft: { eligible: ['custom'], selection: 'random' }, execute: { eligible: ['custom'], selection: 'random' },
      review: { eligible: ['custom'], selection: 'random' }, fix: { eligible: ['custom'], selection: 'random' } } }));
  fs.writeFileSync(path.join(base, 'workflow.config.json'), JSON.stringify({ product: { name: 'disposable-verification' }, adapters: {
    terminal: { host: 'pipe', whenUnavailable: 'fallback' }, review: { provider: 'none' },
    agents: { models: { custom: 'stub/custom' } }, missions: { branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
    verification: { command: 'node --version', defaultArea: 'all' },
    gates: { maxConcurrent: 1, parallel: { preIntegration: 2 }, preIntegration: [
      { key: 'contract', command: 'node check.mjs', order: 0 },
      { key: 'parallel', command: 'node -e "setTimeout(() => {}, 40)"', order: 1 },
      { key: 'dependent', command: 'node --version', order: 2, after: ['contract', 'parallel'] },
    ] },
  } }));
  fs.writeFileSync(path.join(base, 'check.mjs'), 'import fs from "node:fs"; if(fs.readFileSync("answer.txt","utf8").trim() !== "fixed") { console.error("AssertionError: expected fixed answer"); process.exitCode=1; }\n');
  fs.writeFileSync(path.join(base, 'README.md'), '# Disposable verification exercise\n');
  git(base, 'init', '-b', 'main'); git(base, 'config', 'user.name', 'Disposable'); git(base, 'config', 'user.email', 'disposable@example.invalid');
  git(base, 'add', '.'); git(base, 'commit', '-m', 'fixture base');
  setCommandPathProbe(() => '/manual-fake-agent');
  setLauncherHealthProbe(() => ({ ok: true }));
  setWorkflowLaunchPort(({ prompt, worktree: checkout }) => {
    const root = checkout ?? process.cwd();
    const resultPromise = (async () => {
      if (/^Mode: draft\./m.test(prompt)) {
        await requireCommand(root, ['mission', 'author', '--slug', slug, '--goal', criterion, '--why', 'Measure verification recovery',
          '--scope', 'Disposable lifecycle', '--out-of-scope', 'Real operator state', '--criterion', criterion,
          '--checkpoint', 'CP-1', '--checkpoint-text', 'Exercise the contract', '--gate', 'node --version',
          '--predicted', 'Small', '--classification', 'ai_sdlc']);
      } else if (/^Mode: review\./m.test(prompt)) {
        await requireCommand(root, ['verdict', 'approve', '--slug', slug, '--actor', 'custom']);
      } else {
        const repair = !/^Mode: execute after lock\./m.test(prompt);
        if (repair) fakeRepairs++;
        fs.writeFileSync(path.join(root, 'answer.txt'), repair ? 'fixed\n' : 'broken\n');
        git(root, 'add', 'answer.txt');
        if (git(root, 'diff', '--cached', '--name-only')) { git(root, 'commit', '-m', repair ? 'repair contract' : 'initial implementation'); }
        const state = jsonOutput((await requireCommand(root, ['status', slug, '--json'])).stdout) as {
          checkpoints: { name: string; recorded: boolean; repair?: { evidenceRecorded: boolean } }[];
        };
        for (const checkpoint of state.checkpoints.filter(cp => !cp.recorded || cp.repair?.evidenceRecorded === false)) {
          await requireCommand(root, ['checkpoint', 'record', '--slug', slug, '--name', checkpoint.name, '--criterion', criterion,
            '--evidence', 'answer.txt', '--next', 'Verify the repaired contract and review the revision']);
        }
        await requireCommand(root, ['mission', 'mark-complete', '--slug', slug, '--all']);
      }
      return { status: 0, stdout: '{"sessionID":"manual"}\n', stderr: '' };
    })();
    return { invocation: { command: 'manual-fake-agent', args: [], options: { cwd: root } }, resultPromise };
  });
  configureMissionWriteAuthorization({ operationId: 'manual-lifecycle', async assert(id) { assert.equal(id, slug); } });
  await requireCommand(base, ['draft', 'exercise disposable verification', '--agent', 'custom']);
  await requireCommand(worktree, ['active', slug, '--implementer', 'custom', '--reviewer', 'custom']);
  const first = await command(worktree, ['integrate', slug]);
  console.log(`First integration exit ${first.status}; repair launches ${fakeRepairs}`);
  assert.ok(fakeRepairs > 0, `repair must run\n${first.stdout}\n${first.stderr}`);
  const afterRepair = await requireCommand(worktree, ['status', slug, '--json']);
  fs.writeFileSync(path.join(output, 'after-repair.json'), afterRepair.stdout);
  const recovery = path.join(worktree, '.workflow/recovery-evidence');
  if (fs.existsSync(recovery)) { fs.cpSync(recovery, path.join(output, 'recovery-evidence'), { recursive: true }); }
  const second = await command(worktree, ['integrate', slug]);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  const status = await requireCommand(base, ['status', slug, '--json']);
  assert.equal((jsonOutput(status.stdout) as { missionStatus: string }).missionStatus, 'done');
  const stats = await requireCommand(base, ['stats', '--mission', slug]);
  fs.writeFileSync(path.join(output, 'stats.txt'), stats.stdout);
  const config = resolveProcessConfiguration();
  const report = await createVerificationStatisticsReader(base, config).read(new Set([slug]));
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  for (const [index, revision] of [...new Set(report.attempts.flatMap(a => a.revision ? [a.revision] : []))].entries()) {
    git(base, 'update-ref', `refs/evidence/observation-${index}`, revision);
  }
  git(base, 'bundle', 'create', path.join(output, 'repository.bundle'), '--all');
  fs.writeFileSync(path.join(output, 'experiment.json'), JSON.stringify({
    sourceRevision: git(source, 'rev-parse', 'HEAD'),
    sourceDirty: Boolean(git(source, 'status', '--porcelain', '--', 'src', 'scripts', 'test')),
    node: process.version, script: 'test/fixtures/verification-measurements-manual.ts',
    boundary: 'Public in-process CLI commands with a deterministic fake agent and an explicit worker authorization; no durable workflow operation row is fabricated. Missing workflow joins remain unknown.',
    operatorIsolation: 'Temporary PARALLIX_HOME and PARALLIX_CUSTOM_ADMISSION_HOME; disposable Git repository removed after raw evidence and bundle retention.',
  }, null, 2));
  const db = new DatabaseSync(path.join(process.env.PARALLIX_HOME!, 'parallix.db'), { readOnly: true });
  try {
    for (const [name, table] of [['history', 'operational_history'], ['lifecycle', 'board_lane_events'], ['operations', 'workflow_operations']]) {
      fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all(), null, 2));
    }
  } finally { db.close(); }
  assert.ok(report.failureCount > 0);
  assert.ok(report.rerunCount > 0);
  assert.ok(report.cpuObservations > 0);
  assert.equal(report.completedMissions, 1);
  assert.match(stats.stdout, /Verification measurements/);
  console.log(JSON.stringify({ output, attemptCount: report.attemptCount, failures: report.failureCount,
    reruns: report.rerunCount, executionMs: report.executionMs, cpuUs: report.cpuUs, overlapMs: report.overlapMs }));
} finally {
  configureMissionWriteAuthorization(null);
  await clearOperatorStateCache();
  process.chdir(source);
  for (const key of Object.keys(process.env)) { if (!(key in previous)) delete process.env[key]; }
  Object.assign(process.env, previous);
  fs.rmSync(temporary, { recursive: true, force: true });
}
