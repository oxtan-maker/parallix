import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const handoffModule = mockModule<typeof import('../src/adapters/cli/commands/handoff.js')>('../src/adapters/cli/commands/handoff.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());

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
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-nel-characterization-'));
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
