// ---------------------------------------------------------------------------
// TASK-2377.05 — the `px integrate` squash-commit hook bounce runs through the
// rebound kernel (SC2).
//
// The production `integrate.default` orchestration runs over a real Mission
// store; only the Git/Forgejo/worktree boundaries are doubled and the kernel's
// launch/transition/fallback seams are injected as mocks. No agent, LLM, or
// network is involved. Two scenarios are exercised at the commit site:
//
//  S1  a pre-commit hook failure bounces once, the re-run commit passes, and
//      the integration lands.
//  S2  two failed re-run commits exhaust the kernel budget and the CLI throws
//      IntegrationAbort with the existing operator hint.
//  S3  an already-landed payload short-circuits before any bounce.
//  S4  a non-hook commit failure takes the abort branch without bouncing.
// ---------------------------------------------------------------------------
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const verification = mockModule<typeof import('../src/adapters/verification/verification.js')>('../src/adapters/verification/verification.js', import.meta.url);
const integrate = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();

import { MissionIntegrationService } from '../src/application/mission-integration-service.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import type { Mission, MissionStatus } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import type { MissionVersion } from '../src/application/domain-ports.js';

const SLUG = 'task-2377.05-squash';
const LANDED_SHA = 'a11ced0000000000000000000000000000000001';
const LANDED_AT = '2026-08-04T23:30:00+02:00';

function createFakeStore(status: MissionStatus) {
  const current = {
    id: missionId(SLUG),
    repositoryId: repositoryId('parallix'),
    title: 'fixture',
    labels: [],
    assignee: 'codex',
    checkpoints: [],
    review: status === 'review'
      ? {
          rounds: [{
            number: 1,
            subject: {
              change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' },
              revision: 'fixture-revision',
            },
            reviewer: 'claude', implementer: 'codex', startedAt: '2026-08-04T10:00:00Z',
            decision: { kind: 'approved', decidedAt: '2026-08-04T10:30:00Z', comment: null, source: { kind: 'local' } },
            response: null, phase: 'approved', disposition: 'APPROVED', reviewerRetryCount: 0, implementerRetryCount: 0,
          }],
          intervention: null, stageLaunches: [], reviewEvents: [],
        }
      : null,
    netEngineeringLines: null,
    status,
    closedAt: null,
  } as unknown as Mission;
  let version = 1;
  return {
    mission: () => current,
    load: async () => ({ kind: 'found', mission: current, version: version as MissionVersion }),
    save: async () => (version as MissionVersion),
    saveWithTransition: async () => (version as MissionVersion),
  };
}

function servicesFor() {
  const store = createFakeStore('done');
  return {
    store,
    lifecycle: new MissionLifecycleService(store as never),
    integration: new MissionIntegrationService(store as never),
    handoff: { recordNel: async () => ({}) },
  };
}

const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });

interface Scenario {
  /** commit --only results per attempt; each entry is { status, stderr }. */
  commitResults: Array<{ status: number; stderr: string }>;
  /** payload already at HEAD on the first probe (SC3 short-circuit). */
  alreadyAtHead?: boolean;
}

async function runIntegrate(scenario: Scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-2377-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { verification: { command: 'true' } } }));
  const taskFile = path.join(root, 'backlog', 'tasks', 'task.md');
  fs.writeFileSync(taskFile, 'status: approved\n');
  const services = servicesFor();
  const launches: string[] = [];
  const logs: string[] = [];

  // Capture the CLI's operator-facing output so the stranded branch's hint can
  // be asserted (fmt.log writes through stdout).
  mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => {
    logs.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  });

  mock.method(missionUtils, 'inferSlug', () => SLUG);
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtils, 'getPrimaryWorktree', () => root);
  mock.method(missionUtils, 'findMissionDir', () => path.join(root, 'missions', SLUG));
  mock.method(missionUtils, 'findMissionArea', () => 'all');
  mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(root, '..', SLUG));
  mock.method(missionUtils, 'resolveMainRepo', () => root);
  mock.method(missionUtils, 'missionTitle', () => 'fixture');
  mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
  mock.method(missionUtils, 'softResetTrailingBacklogNoise', () => false);
  mock.method(git, 'getCurrentBranch', () => `mission/${SLUG}`);
  let commitAttempt = 0;
  mock.method(git, 'git', (args: string[]) => {
    const joined = args.join(' ');
    if (joined.includes('branch --show-current')) { return ok('main\n'); }
    if (joined.includes('log --format=%H %s')) { return ok('other0 unrelated subject\n'); }
    if (args.includes('show')) { return ok(`${LANDED_AT}\n`); }
    if (joined.includes('merge') && joined.includes('--no-commit')) { return ok(''); }
    if (joined.includes('merge') && joined.includes('--abort')) { return ok(''); }
    if (joined.includes('merge') && joined.includes('--squash')) { return ok(''); }
    if (args.includes('diff') && args.includes('--quiet')) { return { status: scenario.alreadyAtHead ? 0 : 1, stdout: '', stderr: '' }; }
    if (args.includes('diff') && args.includes('--cached')) { return ok('fixture.ts\n'); }
    if (args.includes('commit')) {
      const r = scenario.commitResults[Math.min(commitAttempt, scenario.commitResults.length - 1)];
      commitAttempt += 1;
      return { status: r.status, stdout: '', stderr: r.stderr };
    }
    if (args.includes('rev-parse')) { return ok(`${LANDED_SHA}\n`); }
    return ok('');
  });
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
  mock.method(backlog, 'getTaskStatus', () => 'approved');
  mock.method(backlog, 'getTaskAssignee', () => 'codex');
  mock.method(backlog, 'completeTask', () => true);
  mock.method(backlog, 'setTaskStatus', () => true);
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 1 }));
  mock.method(verification, 'captureVerifiedTreeProof', () => ({ ok: true, proof: { rootDir: root } }));
  mock.method(verification, 'assertVerifiedTreeProof', () => ({ ok: true }));
  mock.method(process, 'cwd', () => root);
  let exitCode: number | undefined;
  mock.method(process, 'exit', (code?: number) => { exitCode = code; });

  let error: Error | undefined;
  try {
    await integrate.default([SLUG, '--no-integration-gates'], {
      missionServicesFn: async () => services,
      startAgentFn: async () => { launches.push('launched'); return { agent: 'codex', result: { status: 0 } } as never; },
      transitionTaskFn: async () => true,
      applyAgentFallbackFn: async ({ original }: { original: string }) => original,
    });
  } catch (e) {
    error = e as Error;
  } finally {
    mock.reset();
    fs.rmSync(root, { recursive: true, force: true });
  }
  // The stranded (exhausted) path maps IntegrationAbort to exit 1 internally;
  // callers assert on the operator hint the CLI emits on that branch.
  return { error, exitCode, launches, logs };
}

// S1 — a pre-commit hook failure bounces once, the re-run commit passes, lands.
test('SC2 S1: hook failure bounces through the kernel and lands when the re-run commit passes', async () => {
  const result = await runIntegrate({
    commitResults: [
      { status: 1, stderr: 'pre-commit: lint errors found' },
      { status: 0, stderr: '' },
    ],
  });
  assert.equal(result.launches.length, 1, 'exactly one implementer launch');
  assert.notEqual(result.exitCode, 1, 'integration lands with a success exit');
});

// S2 — two failed re-run commits exhaust the kernel budget → IntegrationAbort.
test('SC2 S2: two failed re-run commits exhaust the budget and throw IntegrationAbort', async () => {
  const result = await runIntegrate({
    commitResults: [
      { status: 1, stderr: 'pre-commit: lint errors found' },
      { status: 1, stderr: 'pre-commit: lint errors found' },
    ],
  });
  assert.equal(result.launches.length, 2, 'the kernel spends its per-occurrence budget of two');
  assert.equal(result.exitCode, 1, 'the CLI strands the mission (IntegrationAbort maps to exit 1)');
  assert.match(
    result.logs.join('\n'),
    /Fix the reported hook failure in .* and retry integrate/,
    'the existing operator hint survives the migration',
  );
});

// S3 — payload already at HEAD short-circuits before any bounce.
test('SC2 S3: an already-landed payload short-circuits without bouncing', async () => {
  const result = await runIntegrate({ alreadyAtHead: true, commitResults: [{ status: 1, stderr: 'pre-commit: x' }] });
  assert.equal(result.launches.length, 0, 'no bounce when the payload is already at HEAD');
  assert.equal(result.exitCode, 0, 'integration lands without bouncing');
});

// S4 — a non-hook commit failure takes the abort branch without bouncing.
test('SC2 S4: a non-hook commit failure aborts without bouncing', async () => {
  const result = await runIntegrate({ commitResults: [{ status: 1, stderr: 'fatal: could not write the index' }] });
  assert.equal(result.launches.length, 0, 'a non-hook failure never launches an implementer');
  assert.equal(result.exitCode, 1);
});
