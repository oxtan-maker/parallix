// ---------------------------------------------------------------------------
// task-2500.01 CP-4 / F1 — the `px integrate` entrypoint routes the real merge
// operations through the integration capability boundary (integration-dispatch),
// not a scattered `if (mode)` in integrate.ts.
//
// This entrypoint-level test drives the production `integrate.default`
// orchestration end to end over a doubled Git boundary only; no agent, LLM, or
// network is involved. The repository's `integration.mode` is the only thing
// that changes between the two scenarios:
//
//   local     owns the local primary merge -> the squash/merge git call runs.
//   github-pr never publishes to the primary -> `px integrate` fails closed on
//             the `publish` operation before any merge is issued, so the local
//             squash/merge path is unreachable in that mode.
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
import type { MissionVersion } from '../src/application/domain-ports.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const SLUG = 'task-2500-mode';
const LANDED_SHA = 'a11ced0000000000000000000000000000000001';

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
          intervention: null, netEngineeringLines: null,
        }
      : null,
    status,
    closedAt: null,
  } as unknown as Mission;
  let version = 7;
  return {
    load: async () => ({ kind: 'found', mission: current, version: version as MissionVersion }),
    save: async () => (version as MissionVersion),
    saveWithTransition: async () => (version as MissionVersion),
  };
}

function servicesFor() {
  const store = createFakeStore('review');
  return {
    store,
    lifecycle: new MissionLifecycleService(store as never),
    integration: new MissionIntegrationService(store as never),
    handoff: { recordNel: async () => ({ }) },
  };
}

const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });

interface RunResult {
  error: Error | undefined;
  exitCode: number | undefined;
  logs: string;
  gitCalls: string[][];
}

async function runIntegrate(mode: 'local' | 'github-pr'): Promise<RunResult> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-2500-mode-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  // The only thing the scenario changes: the repository's configured mode.
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    adapters: { verification: { command: 'true' } },
    integration: { mode },
  }));
  const taskFile = path.join(root, 'backlog', 'tasks', 'task.md');
  fs.writeFileSync(taskFile, 'status: approved\n');
  const services = servicesFor();
  const logs: string[] = [];
  const gitCalls: string[][] = [];

  // fmt.log writes through the default logger (console.log/console.error).
  mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
  mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });
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
  mock.method(git, 'git', (args: string[]) => {
    gitCalls.push(args);
    const joined = args.join(' ');
    if (joined.includes('branch --show-current')) { return ok('main\n'); }
    if (joined.includes('log --format=%H %s')) { return ok('other0 unrelated subject\n'); }
    if (args.includes('show')) { return ok(`${LANDED_SHA}\n`); }
    if (joined.includes('merge') && joined.includes('--no-commit')) { return ok(''); }
    if (joined.includes('merge') && joined.includes('--abort')) { return ok(''); }
    if (joined.includes('merge') && joined.includes('--squash')) { return ok(''); }
    if (args.includes('diff') && args.includes('--cached')) { return ok('fixture.ts\n'); }
    if (args.includes('commit')) { return ok(''); }
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

  try {
    await integrate.default([SLUG, '--no-integration-gates'], {
      missionServicesFn: async () => services,
    });
  } catch (e) {
    // fall through; assertions below inspect exitCode/logs/gitCalls
  } finally {
    mock.reset();
    fs.rmSync(root, { recursive: true, force: true });
  }
  return { error: undefined, exitCode, logs: logs.join('\n'), gitCalls };
}

const gitMerged = (calls: string[][]) => calls.some(c => c.join(' ').includes('merge'));

test('local mode dispatches through the capability boundary and reaches the local squash/merge', async () => {
  const result = await runIntegrate('local');
  // local owns the local primary merge, so it must NOT fail closed on publish
  // and must issue the local merge through the dispatcher.
  assert.doesNotMatch(result.logs, /"local" integration mode .*publish/, 'local mode does not refuse its own publish');
  assert.ok(gitMerged(result.gitCalls), 'local mode issues the local merge through the dispatcher');
});

test('github-pr mode fails closed on publish and never reaches the local squash/merge path', async () => {
  const result = await runIntegrate('github-pr');
  assert.equal(result.exitCode, 1, 'github-pr refuses the local primary merge');
  assert.match(result.logs, /"github-pr" integration mode .*publish/, 'the publish refusal names the mode and operation');
  assert.ok(!gitMerged(result.gitCalls), 'github-pr must not issue any merge once the capability boundary refuses publish');
});
