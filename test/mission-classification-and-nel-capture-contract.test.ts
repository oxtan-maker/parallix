// Mission classification and NEL capture contract: classification lookup cwd and primary-branch NEL
// capture.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Classification lookup: TASK-2200
//   NEL capture characterization: TASK-2322.05

import test, { describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';

const missionStart = mockModule<typeof import('../src/adapters/cli/startup-preflight.js')>('../src/adapters/cli/startup-preflight.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const handoffModule = mockModule<typeof import('../src/adapters/cli/commands/handoff.js')>('../src/adapters/cli/commands/handoff.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());

// TASK-2200 (was test/task-2200-classification-bug-label.test.ts)
describe('Classification lookup', () => {
  // Reproduces task-2200: mission-start's primary classification lookup
  // (mission-start.ts:148) calls resolveMissionClassificationFn(slug) without
  // passing the resolved worktree cwd, so the underlying resolver falls back to
  // process.cwd() instead of the mission's actual worktree. When the process is
  // not physically cwd'd into the worktree (e.g. driven from the primary
  // checkout), classification resolution silently looks in the wrong root.

  test('missionStart resolves classification using the mission worktree cwd, not process.cwd()', () => {
    const lines = [];
    const errors = [];
    const seenRootDirs = [];

    const result = missionStart.default(['task-2200'], {
      returnResult: true,
      cwdFn: () => '/tmp/project-task-2200',
      getCurrentBranchFn: () => 'mission/task-2200',
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/project-task-2200/task-2200.md' }),
      resolveMissionClassificationFn: (slug, rootDir) => {
        seenRootDirs.push(rootDir);
        // Simulate a task file with labels [ai_sdlc, bug] that only exists
        // under the mission worktree, not under process.cwd().
        if (rootDir === '/tmp/project-task-2200') {
          return { classification: 'ai_sdlc', taskFile: '/tmp/project-task-2200/task-2200.md' };
        }
        return {
          classification: null,
          taskFile: null,
          error: `Could not resolve backlog task for ${slug}.`,
        };
      },
      getTaskStatusFn: () => 'active',
      toVirtualFn: (s) => s,
      findMissionDirFn: () => '/tmp/docs/missions/2026/task-2200',
      fsExistsSync: () => true,
      findCheckpointsFn: () => [],
      getMissionYearFn: () => '2026',
      conventionalWorktreePathFn: () => '/tmp/project-task-2200',
      getLastCommitFn: () => ({ sha: 'abcdef123456', subject: 'Initial', date: '2026-04-30' }),
      getPrStatusFn: () => ({ exists: false }),
      log: line => lines.push(line),
      error: line => errors.push(line)
    });

    const output = lines.join('\n').replace(/\x1B\[\d+m/g, '');

    // The primary classification lookup must receive the mission worktree
    // cwd as rootDir so it can find the task file, mirroring the fix already
    // applied to the fallback lookup at mission-start.ts:161.
    assert.ok(
      seenRootDirs.includes('/tmp/project-task-2200'),
      `expected resolveMissionClassificationFn to be called with the mission worktree cwd; got rootDirs: ${JSON.stringify(seenRootDirs)}`
    );
    assert.deepEqual(result, { pass: true });
    assert.ok(output.includes('[PASS] Mission classification: ai_sdlc'));
  });
});

// TASK-2322.05 (was test/task-2322-05-cli-characterization.test.ts)
describe('NEL capture characterization', () => {
  // ---------------------------------------------------------------------------
  // handoff NEL capture — observe Git, then record through the Mission boundary
  // ---------------------------------------------------------------------------

  const fixtures: string[] = [];

  test.afterEach(() => {
    for (const directory of fixtures.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function missionFixture(slug: string, predicted = 'Large'): { rootDir: string; missionDir: string } {
    const rootDir = registeredMkdtemp('parallix-nel-characterization-');
    fixtures.push(rootDir);
    const missionDir = path.join(rootDir, 'missions', slug);
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), [
      `# Mission: ${slug}`,
      '',
      '## Refinement Signals',
      '',
      `- Predicted NEL bucket: ${predicted} (235+)`,
      '',
    ].join('\n'));
    fs.writeFileSync(
      path.join(missionDir, 'review-state.json'),
      JSON.stringify({ round: 4, phase: 'reviewing' }, null, 2),
    );
    return { rootDir, missionDir };
  }

  test('SC5 characterization: NEL capture observes the primary branch first, then records the mission', async (t) => {
    const { mock } = t;
    const slug = 'task-4243';
    const { rootDir, missionDir } = missionFixture(slug);
    const effects: string[] = [];
    mock.method(missionUtils, 'getPrimaryBranch', () => {
      effects.push('primary-branch');
      return 'main';
    });

    const result = await handoffModule.captureNelAtHandoff(slug, {
      rootDir,
      missionDir,
      log: () => {},
      error: () => {},
      missionServicesFn: () => ({
        store: {
          async load() {
            return {
              kind: 'found' as const,
              mission: {
                predictedNelBucket: 'Large',
                review: {
                  rounds: [{ decision: 'APPROVE' }, { decision: 'REQUEST_CHANGES' }, { decision: 'APPROVE' }, { decision: 'APPROVE' }],
                },
              },
              version: 1 as const,
            };
          },
        },
        handoff: {
          async recordNel(request: Record<string, unknown>) {
            effects.push(`record:${request.netEngineeringLines}:${request.predictedBucket}:${request.reviewRounds}`);
            return { status: 'completed', value: {}, durableEvidence: [] };
          },
        },
      }),
    });

    // The measurement is observational: a clean fixture computes 0 NEL.
    assert.deepEqual(result, { ok: true, nel: 0, bucket: 'Small' });
    assert.deepEqual(effects, ['primary-branch', 'record:0:Large:4']);
  });

  test('SC5 characterization: a refused Mission write makes NEL capture fail closed', async (t) => {
    const { mock } = t;
    const slug = 'task-4244';
    const { rootDir, missionDir } = missionFixture(slug);
    const errors: string[] = [];
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

    const result = await handoffModule.captureNelAtHandoff(slug, {
      rootDir,
      missionDir,
      log: () => {},
      error: (message: string) => errors.push(message),
      missionServicesFn: () => ({
        store: {
          async load() {
            return { ok: false, mission: null };
          },
        },
        handoff: {
          async recordNel() {
            return {
              status: 'failed',
              error: { kind: 'unavailable', message: `mission ${slug} is not recorded` },
              durableEvidence: [],
            };
          },
        },
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.persistenceFailed, true);
    assert.match(result.error, /is not recorded/);
    assert.equal(errors.length, 1);
    assert.equal(fs.existsSync(path.join(missionDir, 'nel-record.json')), false);
  });

  test('SC5 characterization: an undetectable primary branch is a skipped capture, not a failure', async (t) => {
    const { mock } = t;
    const { rootDir, missionDir } = missionFixture('task-4245');
    mock.method(missionUtils, 'getPrimaryBranch', () => { throw new Error('no branch'); });
    const result = await handoffModule.captureNelAtHandoff('task-4245', {
      rootDir,
      missionDir,
      log: () => {},
      error: () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.persistenceFailed, undefined);
    assert.match(result.error, /primary branch/);
  });
});
