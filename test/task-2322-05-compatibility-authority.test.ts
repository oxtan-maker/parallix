/**
 * TASK-2322.05 — the compatibility Mission authority and the shared UI
 * controller path that now runs through it.
 *
 * The fixture is a real (temporary) repository layout: a Backlog task document
 * and a mission directory with `CP-N.md` evidence. No Git process and no SQLite
 * database is involved, which is the point: this is the single authority
 * production keeps until TASK-2322.07.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { missionVersion } from '../src/application/domain-ports.js';
import { MissionCheckpointService } from '../src/application/mission-checkpoint-service.js';
import { MissionHandoffService } from '../src/application/mission-handoff-service.js';
import { MissionIntakeService } from '../src/application/mission-intake-service.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { BoardCommandController } from '../src/application/controller/board-controller.js';
import {
  INTEGRATED_CAPABILITIES,
  UNAVAILABLE_CAPABILITIES,
} from '../src/application/controller/board-command.js';
import { CompatibilityMissionStore } from '../src/adapters/backlog/compatibility-mission-store.js';
import { ConcreteMissionReadAdapter } from '../src/adapters/backlog/concrete-mission-read-adapter.js';
import {
  parseCheckpointDocument,
  renderCheckpointDocument,
} from '../src/adapters/backlog/checkpoint-document.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';
import { artifactReference } from '../src/domain/net-engineering-lines.js';
import { repositoryId } from '../src/domain/repository.js';

const SLUG = 'task-4242';
const MISSION = missionId(SLUG);
const REPOSITORY = repositoryId('parallix-fixture');
const CAPABILITIES = new Set([
  'mission:intake',
  'mission:transition',
  'checkpoint:record',
  'handoff:record',
] as const);

const CHECKPOINT_DOCUMENT = [
  '# CP-1: Call paths mapped',
  '',
  'Mapped the covered intake, checkpoint, and handoff call paths.',
  '',
  '## Goal Check',
  '',
  '| Criterion | Evidence | Status |',
  '|---|---|---|',
  '| Call paths mapped | src/platform/runtime/lib/commands/handoff.ts:1093 | PASS |',
  '| Gate ran | `./scripts/verify-local.sh all` | PASS |',
  '',
  'Next action: Define the checked Mission use cases.',
  '',
].join('\n');

interface Fixture {
  readonly rootDir: string;
  readonly missionDir: string;
  readonly taskFile: string;
  readonly store: CompatibilityMissionStore;
  readonly transitions: string[];
}

const fixtures: string[] = [];

function fixture(options: { status?: string; checkpoint?: string | null } = {}): Fixture {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-compat-authority-'));
  fixtures.push(rootDir);
  const missionDir = path.join(rootDir, 'missions', SLUG);
  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'backlog', 'tasks'), { recursive: true });
  const taskFile = path.join(rootDir, 'backlog', 'tasks', `${SLUG} - Fixture-mission.md`);
  fs.writeFileSync(taskFile, [
    '---',
    `id: ${SLUG.toUpperCase()}`,
    'title: Fixture mission',
    `status: ${options.status ?? 'active'}`,
    'assignee: [codex]',
    'labels:',
    '  - ai_sdlc',
    '---',
    '',
    '## Description',
    '',
    'Fixture task document.',
    '',
  ].join('\n'));
  if (options.checkpoint !== null) {
    fs.writeFileSync(path.join(missionDir, 'CP-1.md'), options.checkpoint ?? CHECKPOINT_DOCUMENT);
  }

  const transitions: string[] = [];
  const store = new CompatibilityMissionStore({
    rootDir,
    repositoryId: REPOSITORY,
    findMissionDir: () => missionDir,
    // The read side is the single Backlog materialization adapter; the worktree
    // probe is disabled so this stays a hermetic filesystem fixture.
    reader: new ConcreteMissionReadAdapter({
      rootDir,
      repositoryId: REPOSITORY,
      findMissionDir: () => missionDir,
      resolveWorktree: () => null,
    }),
    transitionTask: async (slug, status) => {
      transitions.push(`${slug}->${status}`);
      const content = fs.readFileSync(taskFile, 'utf8')
        .replace(/^status: .*$/m, `status: ${status}`);
      fs.writeFileSync(taskFile, content);
      return true;
    },
  });
  return { rootDir, missionDir, taskFile, store, transitions };
}

test.afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SC3 — checkpoint documents are the compatibility representation
// ---------------------------------------------------------------------------

test('SC3: the compatibility authority materializes CheckpointData from CP-N.md documents', async () => {
  const { store } = fixture();
  const read = await store.load(MISSION);
  assert.equal(read.kind, 'found');
  assert.deepEqual(read.mission.checkpoints, [{
    missionId: MISSION,
    name: 'CP-1',
    rawFilename: 'CP-1.md',
    firstLine: 'CP-1: Call paths mapped',
    goalCheck: [
      { criterion: 'Call paths mapped', evidence: 'src/platform/runtime/lib/commands/handoff.ts:1093' },
      { criterion: 'Gate ran', evidence: '`./scripts/verify-local.sh all`' },
    ],
    nextActionText: 'Define the checked Mission use cases.',
  }]);
  assert.equal(read.mission.status, 'active');
  assert.deepEqual(read.mission.externalTaskRef, {
    source: 'backlog',
    id: 'TASK-4242',
    url: path.join('backlog', 'tasks', `${SLUG} - Fixture-mission.md`),
  });
});

test('SC3: recording a checkpoint writes a document the same parser reads back', async () => {
  const { store, missionDir } = fixture();
  const read = await store.load(MISSION);
  assert.equal(read.kind, 'found');

  const outcome = await new MissionCheckpointService(store).record({
    operationId: 'op-cp2',
    missionId: MISSION,
    capabilities: CAPABILITIES,
    expectedVersion: read.version,
    checkpoint: {
      missionId: MISSION,
      name: 'CP-2',
      rawFilename: 'CP-2.md',
      firstLine: 'CP-2: Use cases defined',
      goalCheck: [
        { criterion: 'Use cases defined', evidence: 'src/application/mission-checkpoint-service.ts:60' },
      ],
      nextActionText: 'Reroute the CLI and controller.',
    },
  });
  assert.equal(outcome.status, 'completed');

  const written = fs.readFileSync(path.join(missionDir, 'CP-2.md'), 'utf8');
  assert.match(written, /^# CP-2: Use cases defined$/m);
  assert.match(written, /^## Goal Check$/m);
  assert.match(written, /^Next action: Reroute the CLI and controller\.$/m);

  const reloaded = await store.load(MISSION);
  assert.equal(reloaded.kind, 'found');
  assert.deepEqual(reloaded.mission.checkpoints.map((cp) => cp.name), ['CP-1', 'CP-2']);
  assert.deepEqual(
    reloaded.mission.checkpoints[1].goalCheck,
    [{ criterion: 'Use cases defined', evidence: 'src/application/mission-checkpoint-service.ts:60' }],
  );
});

test('SC3: the document translation is a faithful round trip in both directions', () => {
  const parsed = parseCheckpointDocument(MISSION, 'CP-1.md', CHECKPOINT_DOCUMENT);
  const reparsed = parseCheckpointDocument(MISSION, 'CP-1.md', renderCheckpointDocument(parsed));
  assert.deepEqual(reparsed.goalCheck, parsed.goalCheck);
  assert.equal(reparsed.nextActionText, parsed.nextActionText);
  assert.equal(reparsed.firstLine, parsed.firstLine);
  assert.throws(() => parseCheckpointDocument(MISSION, 'NOTES.md', CHECKPOINT_DOCUMENT), /not named CP-/);
});

// ---------------------------------------------------------------------------
// SC2/SC6 — one authority, exact revision, no second writer
// ---------------------------------------------------------------------------

test('SC2: activation through the compatibility authority uses the existing transition path', async () => {
  const { store, transitions } = fixture({ status: 'refined' });
  const read = await store.load(MISSION);
  assert.equal(read.kind, 'found');
  assert.equal(read.mission.status, 'refined');

  const outcome = await new MissionLifecycleService(store).activate({
    operationId: 'op-activate',
    missionId: MISSION,
    capabilities: CAPABILITIES,
    expectedVersion: read.version,
    agent: agentFamily('codex'),
    occurredAt: '2026-07-29T12:00:00Z',
  });
  assert.equal(outcome.status, 'completed');
  assert.deepEqual(transitions, [`${SLUG}->active`]);
  assert.match(fs.readFileSync(fixtureTaskFile(store), 'utf8'), /^status: active$/m);
});

test('SC2: a concurrent edit invalidates the caller revision and refuses the write', async () => {
  const { store, taskFile, transitions } = fixture({ status: 'refined' });
  const read = await store.load(MISSION);
  assert.equal(read.kind, 'found');

  // Another writer touches the compatibility document after the caller read it.
  const future = new Date(Date.now() + 5_000);
  fs.utimesSync(taskFile, future, future);

  const outcome = await new MissionLifecycleService(store).activate({
    operationId: 'op-stale',
    missionId: MISSION,
    capabilities: CAPABILITIES,
    expectedVersion: read.version,
    agent: agentFamily('codex'),
    occurredAt: '2026-07-29T12:00:00Z',
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error!.kind, 'conflict');
  assert.deepEqual(transitions, []);
  assert.match(fs.readFileSync(taskFile, 'utf8'), /^status: refined$/m);
});

test('SC6: the compatibility authority refuses to create a task record at intake', async () => {
  const { store } = fixture();
  const outcome = await new MissionIntakeService(store).execute({
    operationId: 'op-intake',
    missionId: missionId('task-9999'),
    repositoryId: REPOSITORY,
    title: 'Not created here',
    capabilities: CAPABILITIES,
  });
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.error!.message, /does not create task records/);
});

test('SC2: an unrecorded mission fails closed instead of writing an orphan record', async () => {
  const { store } = fixture();
  const read = await store.load(missionId('task-9999'));
  assert.equal(read.kind, 'missing');
});

// ---------------------------------------------------------------------------
// SC4 — the NEL document keeps references, not payloads
// ---------------------------------------------------------------------------

test('SC4: handoff writes the legacy NEL document shape with artifact references only', async () => {
  const { store, missionDir } = fixture();
  const read = await store.load(MISSION);
  assert.equal(read.kind, 'found');

  const outcome = await new MissionHandoffService(store, store).recordNel({
    operationId: 'op-handoff',
    missionId: MISSION,
    capabilities: CAPABILITIES,
    expectedVersion: read.version,
    netEngineeringLines: 300,
    predictedBucket: 'Large',
    reviewRounds: 2,
    capturedAt: '2026-07-29T13:00:00Z',
    artifacts: [artifactReference('file', 'proofs/task-4242/gate.log', 5_242_880)],
  });
  assert.equal(outcome.status, 'completed');

  const documentPath = path.join(missionDir, 'nel-record.json');
  const raw = fs.readFileSync(documentPath, 'utf8');
  const record = JSON.parse(raw);
  assert.deepEqual(Object.keys(record), [
    'slug', 'predictedBucket', 'actualNel', 'actualBucket', 'reviewRounds', 'capturedAt', 'artifacts',
  ]);
  assert.equal(record.slug, SLUG);
  assert.equal(record.predictedBucket, 'Large');
  assert.equal(record.actualNel, 300);
  assert.equal(record.actualBucket, 'Large');
  assert.equal(record.reviewRounds, 2);
  assert.deepEqual(record.artifacts, [
    { kind: 'file', location: 'proofs/task-4242/gate.log', byteSize: 5_242_880 },
  ]);
  assert.equal(raw.endsWith('\n'), true);
  // A 5 MB artifact is referenced; the durable record stays kilobyte-sized.
  assert.ok(fs.statSync(documentPath).size < 1024);

  const reloaded = await store.load(MISSION);
  assert.equal(reloaded.kind, 'found');
  assert.equal(reloaded.mission.netEngineeringLines, 300);
});

test('SC4: a document write failure is reported as a failed handoff, not a silent success', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-compat-authority-'));
  fixtures.push(rootDir);
  const base = fixture();
  const failing = new CompatibilityMissionStore({
    rootDir: base.rootDir,
    repositoryId: REPOSITORY,
    findMissionDir: () => base.missionDir,
    reader: new ConcreteMissionReadAdapter({
      rootDir: base.rootDir,
      repositoryId: REPOSITORY,
      findMissionDir: () => base.missionDir,
      resolveWorktree: () => null,
    }),
    transitionTask: async () => true,
    writeDocumentJson: () => { throw new Error('injected NEL persistence failure'); },
  });
  const read = await failing.load(MISSION);
  assert.equal(read.kind, 'found');
  const outcome = await new MissionHandoffService(failing, failing).recordNel({
    operationId: 'op-handoff',
    missionId: MISSION,
    capabilities: CAPABILITIES,
    expectedVersion: read.version,
    netEngineeringLines: 42,
    capturedAt: '2026-07-29T13:00:00Z',
  });
  assert.notEqual(outcome.status, 'completed');
  assert.match(outcome.error!.message, /injected NEL persistence failure/);
  assert.equal(fs.existsSync(path.join(base.missionDir, 'nel-record.json')), false);
});

// ---------------------------------------------------------------------------
// SC5 — shared UI command controller
// ---------------------------------------------------------------------------

function unconfiguredActivePort() {
  return {
    async validateSlug() { return 'not configured'; },
    async launch(): Promise<never> { throw new Error('unreachable'); },
    async recordLaunch(): Promise<never> { throw new Error('unreachable'); },
    async handoff() {},
  };
}

test('SC5: the controller dispatches checkpoint:record through the checkpoint use case', async () => {
  const { store, missionDir } = fixture();
  const read = await store.load(MISSION);
  assert.equal(read.kind, 'found');
  const events: string[] = [];
  const controller = new BoardCommandController(
    unconfiguredActivePort(),
    (event) => events.push(`${event.sequence}:${event.phase}`),
    { checkpoints: new MissionCheckpointService(store) },
  );

  const result = await controller.dispatchWithStatus({
    operationId: 'board-1',
    kind: 'checkpoint:record',
    missionId: SLUG,
    missionStatusAtRequest: 'active',
    capabilities: CAPABILITIES,
    payload: {
      kind: 'checkpoint:record',
      expectedVersion: read.version,
      checkpoint: {
        missionId: MISSION,
        name: 'CP-3',
        rawFilename: 'CP-3.md',
        firstLine: 'CP-3: Controller rerouted',
        goalCheck: [{ criterion: 'Controller rerouted', evidence: 'src/application/controller/board-controller.ts:80' }],
        nextActionText: 'Run the declared gate.',
      },
    },
  }, 'active');

  assert.equal(result.status, 'completed');
  assert.ok(fs.existsSync(path.join(missionDir, 'CP-3.md')));
  assert.deepEqual(events, ['0:dispatch', '1:checkpoint']);
});

test('SC5: the controller rejects a stale board request before the use case runs', async () => {
  const { store, missionDir } = fixture();
  const controller = new BoardCommandController(unconfiguredActivePort(), undefined, {
    checkpoints: new MissionCheckpointService(store),
  });
  const result = await controller.dispatchWithStatus({
    operationId: 'board-2',
    kind: 'checkpoint:record',
    missionId: SLUG,
    missionStatusAtRequest: 'refined',
    capabilities: CAPABILITIES,
    payload: {
      kind: 'checkpoint:record',
      checkpoint: {
        missionId: MISSION,
        name: 'CP-4',
        goalCheck: [{ criterion: 'x', evidence: 'src/domain/checkpoint.ts:45' }],
        nextActionText: 'y',
      },
    },
  }, 'active');
  assert.equal(result.status, 'failed');
  assert.equal(result.error!.kind, 'conflict');
  assert.equal(fs.existsSync(path.join(missionDir, 'CP-4.md')), false);
});

test('SC5: a Mission command without a payload or a configured authority is refused', async () => {
  const withoutServices = new BoardCommandController(unconfiguredActivePort());
  const missingPayload = await withoutServices.dispatch({
    operationId: 'board-3',
    kind: 'checkpoint:record',
    missionId: SLUG,
    missionStatusAtRequest: 'active',
    capabilities: CAPABILITIES,
  });
  assert.equal(missingPayload.status, 'rejected');
  assert.equal(missingPayload.error!.kind, 'validation');

  const unconfigured = await withoutServices.dispatch({
    operationId: 'board-4',
    kind: 'handoff:record',
    missionId: SLUG,
    missionStatusAtRequest: 'active',
    capabilities: CAPABILITIES,
    payload: {
      kind: 'handoff:record',
      netEngineeringLines: 10,
      capturedAt: '2026-07-29T13:00:00Z',
    },
  });
  assert.equal(unconfigured.status, 'rejected');
  assert.equal(unconfigured.error!.kind, 'capability');
  assert.match(unconfigured.error!.message, /no Mission authority is configured/);
});

test('SC5: the capability registry integrates the three Mission commands and keeps the rest unavailable', () => {
  assert.deepEqual([...INTEGRATED_CAPABILITIES].sort(), [
    'active:execute', 'checkpoint:record', 'handoff:record', 'mission:intake',
  ]);
  assert.deepEqual([...UNAVAILABLE_CAPABILITIES.keys()].sort(), [
    'approve:review', 'draft:create', 'integrate:merge', 'review:act-on-findings', 'review:submit',
  ]);
});

test('SC5: intake dispatched from the board reaches the intake use case with its trace', async () => {
  const recorded: string[] = [];
  const controller = new BoardCommandController(unconfiguredActivePort(), undefined, {
    intake: new MissionIntakeService({
      async load() { return { kind: 'missing' }; },
      async save(mission, expectedVersion) {
        recorded.push(`${mission.id}:${mission.repositoryId}:${mission.externalTaskRef?.id ?? 'none'}:${expectedVersion ?? 'insert'}`);
        return missionVersion(1);
      },
    }),
  });
  const result = await controller.dispatch({
    operationId: 'board-5',
    kind: 'mission:intake',
    missionId: SLUG,
    missionStatusAtRequest: 'backlog',
    capabilities: CAPABILITIES,
    payload: {
      kind: 'mission:intake',
      repositoryId: REPOSITORY,
      title: 'Board intake',
      externalTaskRef: { source: 'backlog', id: 'TASK-4242', url: null } as never,
    },
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(recorded, [`${SLUG}:${REPOSITORY}:TASK-4242:insert`]);
});

// ---------------------------------------------------------------------------
// SC7 — no direct filesystem persistence or SQL in the UI layer
// ---------------------------------------------------------------------------

test('SC7: the shared UI controller reaches the compatibility documents only through the port', () => {
  const controller = fs.readFileSync(
    path.join(process.cwd(), 'src/application/controller/board-controller.ts'),
    'utf8',
  );
  for (const token of ['node:fs', 'node:path', 'nel-record.json', 'CP-', 'INSERT INTO', 'missions/']) {
    assert.ok(!controller.includes(token), `board controller must not reference ${token}`);
  }
});

function fixtureTaskFile(store: CompatibilityMissionStore): string {
  // The store keeps its own root; recompute the fixture task path from it.
  const rootDir = (store as unknown as { rootDir: string }).rootDir;
  return path.join(rootDir, 'backlog', 'tasks', `${SLUG} - Fixture-mission.md`);
}
