import { fixtureMission } from '../../../fixtures/mission-builders.js';
/**
 * TASK-2521.03 — discovery of the Mission read and write surface from `px --help`.
 *
 * AC #1/#2: the help a fresh agent reads must name the command that reports
 * complete Mission state and the typed commands that change it, and must not
 * point the agent at a mission document or a checkpoint file as the authority.
 * The discovery chain asserted here is the one an agent actually walks: read
 * `px --help`, extract a command name, confirm it dispatches.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN_COMMANDS, printUsage } from '../../../../src/interfaces/cli/runtime.js';
import {
  ASSIGN_HELP,
  CHECKPOINT_HELP,
  GATE_HELP,
  GOAL_HELP,
  SCOPE_HELP,
} from '../../../../src/interfaces/cli/mission-writes.js';

function captureUsage(): string {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  ((process.stdout)).write = (chunk: string) => {
    chunks.push(String(chunk));
    return true;
  };
  try { printUsage(); } finally {
    ((process.stdout)).write = original;
  }
  return chunks.join('');
}

/** The only inputs a fresh agent is given: a Mission slug and `px --help`. */
function discoverReadCommand(help: string): string | null {
  const line = help
    .split('\n')
    .find((candidate) => /\bstatus\b/.test(candidate) && /--json/.test(candidate));
  return line ? (line.trim().split(/\s+/)[0] ?? null) : null;
}

test('fresh agent discovers the Mission read command from px --help alone', () => {
  const help = captureUsage();
  const discovered = discoverReadCommand(help);
  assert.equal(discovered, 'status', 'px --help must name the command that reports Mission state');
  assert.ok(KNOWN_COMMANDS.includes(discovered!), 'the discovered name must be a dispatchable command');
  assert.match(help, /--json/, 'px --help must show the machine-readable form');
});

test('AC #2: px --help names a typed write command for every mutable domain part', () => {
  const help = captureUsage();
  for (const [command, pattern] of [
    ['goal', /goal set .*--goal/],
    ['scope', /scope set .*--scope/],
    ['gate', /gate add\|remove .*--command/],
    ['criterion', /criterion add\|remove .*--text/],
    ['checkpoint', /checkpoint plan\|unplan\|record .*--name/],
    ['nel', /nel set .*--predicted/],
    ['assign', /assign --agent/],
  ] as const) {
    assert.match(help, pattern, `px --help must describe the ${command} write`);
    assert.ok(KNOWN_COMMANDS.includes(command), `${command} must be dispatchable`);
  }
  // The version is resolved automatically, so the help states that and must not
  // ask a caller to thread --expected-version through on every write.
  assert.match(help, /resolve?s its own current version/, 'px --help must state that writes resolve their own version');
  assert.doesNotMatch(help, /takes a --expected-version|requires a --expected-version|--expected-version <n> is required/, 'px --help must not ask a caller to pass a version');
});

test('px --help never points an agent at MISSION.md or CP-N.md as authority', () => {
  const help = captureUsage();
  assert.ok(!/MISSION\.md/.test(help), 'px --help must not name the mission document');
  assert.ok(!/CP-[\dN]\.md|CP-\*\.md/.test(help), 'px --help must not name checkpoint documents');
});

test('AC #11/#13: every write help uses typed flags, never a JSON request blob', () => {
  for (const help of [GOAL_HELP, SCOPE_HELP, GATE_HELP, CHECKPOINT_HELP, ASSIGN_HELP]) {
    assert.doesNotMatch(help, /--expected-version/, 'no write documents a version flag; the version is resolved automatically');
    assert.doesNotMatch(help, /--data\b|--data-stdin|<json>/, 'no write takes a JSON request blob');
    assert.doesNotMatch(help, /MISSION\.md|CP-\d+\.md/, 'no write help names a workflow file');
  }
  // The slug is inferred, so the agent is never asked to thread it through.
  assert.match(GOAL_HELP, /\[--slug <slug>\]/);
});

test('checkpoint history and round reads expose immutable evidence without writes (TASK-2742)', async () => {
  const { createCheckpointCommand } = await import('../../../../src/interfaces/cli/mission-writes.js');
  const { MissionCheckpointService } = await import('../../../../src/application/mission-checkpoint-service.js');
  const { missionId } = await import('../../../../src/domain/mission.js');
  const { missionVersion } = await import('../../../../src/application/domain-ports.js');
  const id = missionId('task-history-fixture');
  const checkpoint = { missionId: id, name: 'CP-1', goalCheck: [{ criterion: 'proof', evidence: 'original' }], nextActionText: 'continue' };
  const versions = [{ version: 1, checkpoint, recordedAt: null, recordedRound: null, missionRevision: null }];
  const boundary = { round: 1, versions: [1], checkpoints: [checkpoint] };
  let saves = 0;
  const service = new MissionCheckpointService({
    load: async () => ({ kind: 'found' as const, mission: fixtureMission(id, { checkpoints: [checkpoint] }), version: missionVersion(2) }),
    save: async () => { saves++; return missionVersion(3); },
    checkpointHistory: async () => versions,
    reviewCheckpointState: async (_id, round) => round === 1 ? boundary : round === 2 ? null : undefined,
  });
  const command = createCheckpointCommand(service, () => id);
  const chunks: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string) => { chunks.push(String(chunk)); return true; }) as typeof original;
  try {
    await command(['history']);
    assert.deepEqual(JSON.parse(chunks.join('')), versions);
    chunks.length = 0;
    await command(['round', '--round', '1']);
    assert.deepEqual(JSON.parse(chunks.join('')), boundary);
    chunks.length = 0;
    await command(['read', '--name', 'CP-1']);
    assert.deepEqual(JSON.parse(chunks.join('')).checkpoints, [checkpoint]);
    chunks.length = 0;
    await command(['history', '--name', 'CP-99']);
    assert.deepEqual(JSON.parse(chunks.join('')), []);
    await assert.rejects(command(['round', '--round', '2']), /unknown.*predates/);
    await assert.rejects(command(['round', '--round', '99']), /no checkpoint state.*99/);
    for (const round of ['0', '-1', '1.5', 'garbage', 'Infinity']) {
      await assert.rejects(command(['round', '--round', round]), /positive integer/);
    }
    assert.equal(saves, 0);
    assert.equal(versions[0]?.checkpoint.goalCheck[0]?.evidence, 'original');
  } finally { process.stdout.write = original; }
});

test('mission-bound recovery commands restore worktree after base-started console (TASK-2778)', async () => {
  const { missionCommandTarget } = await import('../../../../src/composition/mission-command-context.js');
  const { resolveConfiguration } = await import('../../../../src/composition/config.js');
  const configuration = resolveConfiguration({ PARALLIX_MISSION_TERMINAL: 'task-2778' });
  for (const command of ['active', 'review', 'recover', 'integrate', 'rebase', 'resolve-conflict', 'verify']) {
    assert.equal(missionCommandTarget(command, [], '/base', configuration, (slug, options) => {
      assert.equal(slug, 'task-2778'); assert.equal(options?.cwd, '/base'); return '/mission';
    }), '/mission');
  }
  assert.equal(missionCommandTarget('review', ['task-2', '--submit'], '/base', configuration,
    slug => { assert.equal(slug, 'task-2'); return '/other'; }), '/other');
  assert.equal(missionCommandTarget('review', ['--help'], '/base', configuration, () => assert.fail()), '/base');
});

test('checkpoint correction CLI requires operator decision and evidence and keeps public read history (TASK-2803)', async () => {
  const { createCheckpointCommand } = await import('../../../../src/interfaces/cli/mission-writes.js');
  const { MissionCheckpointService } = await import('../../../../src/application/mission-checkpoint-service.js');
  const { inMemoryTransitionStore } = await import('../../../fixtures/mission-builders.js');
  const { missionId } = await import('../../../../src/domain/mission.js');
  const id = missionId('correction-cli');
  const blocker = { command: 'npm test', diagnostic: 'false stop', authorityReason: 'operator owns decision', proposedCorrection: 'confirm decision' };
  const store = inMemoryTransitionStore(fixtureMission(id, { checkpoints: [{ missionId: id, name: 'CP-5', goalCheck: [], nextActionText: 'Resume CP-3',
    repair: { incidentId: 'false-stop', command: 'npm test', attempt: 1, authorizedCriteria: [], authorizedGates: [], evidenceRecorded: false, verified: false, blocker } }] }));
  const service = new MissionCheckpointService(store, { rootFor: () => '/repo', fileSystem: {
    existsSync: () => false, readText: () => '', listNames: () => [], listEntries: () => [],
  } });
  const command = createCheckpointCommand(service, () => id, undefined, true);
  const args = ['correct-invalid-contract', '--name', 'CP-5', '--operator', 'Magnus', '--decision', 'Decision is recorded', '--evidence', '`npm test`'];
  const before = structuredClone(await store.load());
  await assert.rejects(createCheckpointCommand(service, () => id)(args), /direct operator/);
  await assert.rejects(createCheckpointCommand(service, () => id)(['record', '--force', '--name', 'CP-5', '--criterion', 'proof', '--evidence', '`npm test`', '--next', 'continue']), /direct operator/);
  await assert.rejects(command(args.slice(0, 3)), /--operator/);
  await assert.rejects(command(args.slice(0, 5)), /--decision/);
  await assert.rejects(command(args.slice(0, 7)), /--evidence/);
  await assert.rejects(command([...args, '--expected-version', '99']), /version/i);
  assert.deepEqual(await store.load(), before);
  const chunks: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string) => { chunks.push(String(chunk)); return true; }) as typeof original;
  try {
    await command(args);
    assert.equal(JSON.parse(chunks.join('')).version, 2);
    chunks.length = 0;
    await command(['read', '--name', 'CP-5']);
    const cp = JSON.parse(chunks.join('')).checkpoints[0];
    assert.deepEqual(cp.repair.corrections[0].blocker, blocker);
    assert.equal(cp.repair.corrections[0].operator, 'Magnus');
    assert.equal(cp.repair.blocker, undefined);
    assert.deepEqual(cp.goalCheck, []);
    assert.equal(cp.repair.evidenceRecorded, false);
  } finally { process.stdout.write = original; }
});
