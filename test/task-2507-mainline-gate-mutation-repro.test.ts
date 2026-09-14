// ---------------------------------------------------------------------------
// TASK-2507 — a gate failure that also reproduces in the primary checkout must
// leave that checkout untouched. TASK-2492 routed such a failure into a
// hand-rendered `TASK-MAINGATE-*` backlog file written and committed on main;
// this reproduction runs the real routing module against a throwaway Git
// repository standing in for the base worktree and proves the failure is only
// reported: no file, no staged change, no commit.
//
// The base-branch probe is injected (it would otherwise execute the real gate);
// everything that could write to the base worktree runs unmocked.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  INTEGRATION_GATE_REBOUND_LIMIT,
  routeIntegrationGateFailure,
  type IntegrationGateRouteOptions,
} from '../src/adapters/cli/commands/integrate-gate-rebound.js';

const HANDLER_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'adapters', 'cli', 'commands', 'integrate-gate-rebound.ts');

function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) { throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`); }
  return String(result.stdout ?? '').trim();
}

function makeBaseWorktree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2507-base-'));
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@parallix.test'], dir);
  git(['config', 'user.name', 'Test'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  fs.mkdirSync(path.join(dir, 'backlog', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backlog', 'tasks', 'task-1 - Existing.md'), '---\nid: TASK-1\ntitle: Existing\nstatus: backlog\n---\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# base\n');
  git(['add', '.'], dir);
  git(['commit', '-m', 'base'], dir);
  return dir;
}

/** Relative path → sha256 of every file outside `.git`. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    const full = path.join(entry.parentPath, entry.name);
    const rel = path.relative(root, full);
    if (rel === '.git' || rel.startsWith(`.git${path.sep}`) || !entry.isFile()) { continue; }
    out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  }
  return out;
}

/**
 * Route arguments for one failed integration gate. Only the base-branch probe,
 * the gate re-run, and the agent launcher are injected: every seam that could
 * touch the base worktree runs for real against the fixture repository.
 */
function routeArgs(base: string, over: Partial<IntegrationGateRouteOptions> & { spent?: number } = {}): IntegrationGateRouteOptions {
  const { spent = 0, ...rest } = over;
  return {
    slug: 'task-2507-fixture',
    missionWorktree: '/tmp/task-2507-mission',
    baseWorktree: base,
    baseBranch: 'main',
    verificationCommand: './scripts/verify-local.sh all',
    failedGate: { key: 'integration-suite', command: 'npm run test:integration', exitCode: 1, stdout: '', stderr: 'test/example.test.ts failed' },
    gateError: 'Repository gate "integration-suite" exited with code 1 for integration.',
    gates: [{ key: 'integration-suite', command: 'npm run test:integration', order: 3 }],
    implementer: 'codex',
    repositoryId: 'parallix',
    startAgentFn: (async () => ({ agent: 'codex', result: { status: 0 } })) as never,
    transitionTaskFn: async () => true,
    readReboundsFn: async () => spent,
    recordReboundFn: (async () => true) as never,
    probeBaseBranchReproductionFn: (async () => ({ checked: true, reproduced: false, detail: 'integration gate integration-suite passes on main; the failure is a mission regression', baseCommit: 'abc123' })) as never,
    captureFinalTreeFn: (() => ({ ok: true, rootDir: '/tmp/task-2507-mission', commit: 'c', tree: 't' })) as never,
    runPhaseGatesFn: (async (_p: string, o: any) => ({ ok: true, phase: 'integration', gates: o.gates, executed: 1, skipped: false, dryRun: false, failedGate: null, error: null })) as never,
    log: () => {},
    error: () => {},
    gateRunLog: () => {},
    gateRunError: () => {},
    ...rest,
  } as IntegrationGateRouteOptions;
}

test('TASK-2507: a gate failure reproduced in the primary checkout leaves the base worktree byte-for-byte unchanged and uncommitted', async () => {
  const base = makeBaseWorktree();
  try {
    const before = snapshot(base);
    const headBefore = git(['rev-parse', 'HEAD'], base);
    const launches: string[] = [];
    const transitions: string[] = [];
    const recorded: string[] = [];
    const messages: string[] = [];

    const route = await routeIntegrationGateFailure(routeArgs(base, {
      probeBaseBranchReproductionFn: (async () => ({ checked: true, reproduced: true, detail: 'integration gate integration-suite also fails on main: non-zero exit', baseCommit: headBefore })) as never,
      startAgentFn: (async () => { launches.push('codex'); return { agent: 'codex', result: { status: 0 } }; }) as never,
      transitionTaskFn: async (slug: string) => { transitions.push(slug); return true; },
      recordReboundFn: (async (slug: string) => { recorded.push(slug); return true; }) as never,
      log: (m: string) => messages.push(m),
      error: (m: string) => messages.push(m),
      gateRunLog: (m: string) => messages.push(m),
      gateRunError: (m: string) => messages.push(m),
    }));

    assert.equal(route.route, 'mainline', 'the failure is classified as a mainline problem and terminates the attempt');
    assert.deepEqual(snapshot(base), before, 'no file in the base worktree is created, changed, or removed');
    assert.equal(git(['status', '--porcelain'], base), '', 'git status --porcelain stays empty');
    assert.equal(git(['rev-parse', 'HEAD'], base), headBefore, 'no commit is created on main');
    assert.deepEqual(fs.readdirSync(path.join(base, 'backlog', 'tasks')).filter((f) => /MAINGATE/.test(f)), [], 'no TASK-MAINGATE-* file exists');
    assert.deepEqual(launches, [], 'the implementer is not bounced');
    assert.deepEqual(transitions, [], 'the mission is not transitioned');
    assert.deepEqual(recorded, [], 'no rebound budget is spent');
    const report = messages.join('\n');
    assert.match(report, /also fails on main/, 'the reproduction evidence is reported');
    assert.match(report, /npm run test:integration/, 'the failing gate command is reported');
    assert.match(report, /Human action required/);
    assert.doesNotMatch(report, /MAINGATE/, 'no fabricated backlog identifier is reported');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('TASK-2507: a gate failure that reproduces only in the mission worktree still bounces once within its retry bound and leaves the base worktree clean', async () => {
  const base = makeBaseWorktree();
  try {
    const before = snapshot(base);
    const launches: string[] = [];
    const transitions: string[] = [];
    const recorded: string[] = [];

    // Inside budget: the mission-only failure bounces exactly once and re-runs
    // the identical gate set.
    const fixed = await routeIntegrationGateFailure(routeArgs(base, {
      spent: 0,
      startAgentFn: (async () => { launches.push('codex'); return { agent: 'codex', result: { status: 0 } }; }) as never,
      transitionTaskFn: async (slug: string) => { transitions.push(slug); return true; },
      recordReboundFn: (async (slug: string) => { recorded.push(slug); return true; }) as never,
    }));
    assert.equal(fixed.route, 'fixed', 'a mission-only regression still takes the bounded rebound path');
    assert.deepEqual(launches, ['codex'], 'exactly one implementer relaunch per invocation');
    assert.deepEqual(transitions, ['task-2507-fixture'], 'the mission is transitioned back to its implementer');
    assert.deepEqual(recorded, ['task-2507-fixture'], 'the spent rebound is persisted before the launch');

    // At the bound: no further launch, no transition, no further spend.
    const limited = await routeIntegrationGateFailure(routeArgs(base, {
      spent: INTEGRATION_GATE_REBOUND_LIMIT,
      startAgentFn: (async () => { throw new Error('must not launch at the retry bound'); }) as never,
      transitionTaskFn: async () => { throw new Error('must not transition at the retry bound'); },
      recordReboundFn: (async () => { throw new Error('must not spend budget at the retry bound'); }) as never,
    }));
    assert.equal(limited.route, 'limit-reached', 'the configured retry bound still stops the bounce');

    assert.deepEqual(snapshot(base), before, 'the mission-only path writes nothing to the base worktree either');
    assert.equal(git(['status', '--porcelain'], base), '', 'git status --porcelain stays empty');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('TASK-2507: the integration-failure handler constructs no TASK-MAINGATE identifier and renders no backlog Markdown', () => {
  const source = fs.readFileSync(HANDLER_SOURCE, 'utf8');
  assert.doesNotMatch(source, /TASK-MAINGATE/);
  assert.doesNotMatch(source, /status: backlog/);
  assert.doesNotMatch(source, /getTaskStorage|writeFileSync|'commit'/, 'the handler neither writes backlog files nor commits');
});
