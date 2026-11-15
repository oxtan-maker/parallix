import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { validateWebBoardSnapshot, type WebMissionCard, type WebStage } from '../../../src/interfaces/web/transport.js';
// Synchronous terminal work must stay in its own persistent observation process.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { workflowBoard, until } from '../../fixtures/workflow-board.js';
import { bundleWorkflowChild } from '../../fixtures/workflow-bundle.js';
import { workflowHttp } from '../../fixtures/workflow-http.js';
// Both cases share one board fixture and host process to stay inside the integration time cap;
// each case drives its own slug and the provider case switches provider fixtures on only when it starts.
let bundle: Awaited<ReturnType<typeof bundleWorkflowChild>>;
let fixture: Awaited<ReturnType<typeof workflowBoard>>;
let host: Awaited<ReturnType<typeof fixture.start>>;
before(async () => {
  bundle = await bundleWorkflowChild();
  fixture = await workflowBoard(2, { cli: bundle.cli, historicalHold: true });
  fs.mkdirSync(path.join(fixture.root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(fixture.root, 'config/agents.json'), JSON.stringify({ families: ['codex', 'claude'] }));
  host = await fixture.start();
  // Each read-only observer process builds its own graph on its first request. Warm both
  // here so the timed cases measure isolation, not cold observer startup.
  await fixture.observation.board();
  await fixture.observation.terminal.overview(fixture.slugs[0]);
  await until(() => fs.existsSync(path.join(fixture.root, 'historical-reconstruction.entered')), 'historical reconstruction handoff');
});
after(async () => { try { await fixture?.close(); } finally { bundle?.close(); } });

async function within<T>(promise: Promise<T>, milliseconds = 500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Observation exceeded ${milliseconds}ms`)), milliseconds);
    })]);
  } finally { if (timer) { clearTimeout(timer); } }
}

function observationBuilds(): number {
  const filename = path.join(fixture.root, 'observation-builds.log');
  if (!fs.existsSync(filename)) { return 0; }
  return fs.readFileSync(filename, 'utf8').trim().split('\n').filter(Boolean).length;
}

async function waitForObservationBuild(target: number): Promise<void> {
  await within(new Promise<void>(resolve => {
    const check = () => {
      if (observationBuilds() >= target) { resolve(); return; }
      setTimeout(check, 5);
    };
    check();
  }));
}

test('held historical reconstruction cannot delay current board or terminal reads (TASK-2854.01)', async () => {
  const release = path.join(fixture.root, 'historical-reconstruction.release');
  try {
    assert.equal(fs.existsSync(release), false, 'historical reconstruction remains held during the reads');
    const [board, overview] = await within(Promise.all([
      fixture.observation.board(),
      fixture.observation.terminal.overview(fixture.slugs[0]),
    ]));
    assert.ok(overview);
    assert.ok(['unavailable', 'stale'].includes(board.metrics.analytics?.freshness ?? ''));
    assert.match(board.metrics.analytics?.reason ?? '', /Historical analytics/);

    // A held historical refresh is the analytics family's alone: it never demotes the workflow
    // snapshot (TASK-2854.04), and the analytics read reports its own unobserved state.
    const http = await workflowHttp(host);
    const snapshot = await within(http.snapshot());
    assert.equal(snapshot.freshness.state, 'fresh');
    const analytics = await within(http.analytics());
    assert.ok(['unavailable', 'stale'].includes(analytics.freshness.state));
    assert.match(analytics.freshness.reason, /Historical analytics/);
  } finally { fs.writeFileSync(release, 'release'); }

  await within(new Promise<void>(resolve => {
    const check = async () => {
      const board = await fixture.observation.board();
      if (board.metrics.analytics?.freshness === 'fresh') { resolve(); return; }
      setTimeout(() => { void check(); }, 5);
    };
    void check();
  }));
});

test('running host keeps repeated unchanged and changed observations inside fresh-read bounds (TASK-2854.01)', async () => {
  const http = await workflowHttp(host);
  const latencies: number[] = [];
  let target = observationBuilds();
  for (let index = 0; index < 2; index += 1) {
    await waitForObservationBuild(++target);
    const startedAt = performance.now();
    const snapshot = await within(http.snapshot());
    latencies.push(performance.now() - startedAt);
    assert.ok(snapshot.stages.length > 0);
  }

  const loaded = await fixture.store.load(fixture.slugs[0] as never);
  assert.equal(loaded.kind, 'found');
  if (loaded.kind !== 'found') { return; }
  const changedTitle = 'Changed during bounded host observation';
  await fixture.store.save({ ...loaded.mission, title: changedTitle }, loaded.version);
  const changedAt = performance.now();
  const changed = await within(new Promise<Awaited<ReturnType<typeof http.snapshot>>>(resolve => {
    const check = async () => {
      const snapshot = await http.snapshot();
      const card = snapshot.stages.flatMap((stage: WebStage) => stage.cards).find((item: WebMissionCard) => item.id === fixture.slugs[0]);
      if (card?.title === changedTitle) { resolve(snapshot); return; }
      setTimeout(() => { void check(); }, 5);
    };
    void check();
  }));
  latencies.push(performance.now() - changedAt);
  assert.equal(changed.stages.flatMap((stage: WebStage) => stage.cards).find((card: WebMissionCard) => card.id === fixture.slugs[0])?.title, changedTitle);
  assert.ok(latencies.every(milliseconds => milliseconds < 500), `fresh observation latencies: ${latencies.join(', ')}`);
});

test('held synchronous terminal probe cannot block board snapshots or independent admission (TASK-2750)', async () => {
  const http = await workflowHttp(host);
  let settled = false;
  const probe = fetch(`${host.origin}/api/terminal/${fixture.slugs[0]}/live`).then(response => { settled = true; return response; });
  await until(fixture.probeEntered, 'synchronous terminal probe');
  const snapshot = await http.snapshot(); assert.ok(snapshot.stages.length);
  assert.equal(settled, false);
  assert.equal((await http.post(fixture.slugs[1], 'independent')).status, 202);
  await until(() => fixture.entered(fixture.slugs[1]), 'synchronous worker preflight');
  assert.equal(settled, false, 'admission and worker entry finish while terminal remains held');
  assert.equal((await fetch(`${host.origin}/api/board`)).status, 200, 'snapshot also completes while synchronous worker preflight remains held');
  fixture.releaseProbe(); assert.equal((await probe).status, 200);
  fixture.release(fixture.slugs[1]);
  await until(async () => (await fixture.service.current(fixture.slugs[1])) === null, 'worker completes');
});

test('board observes provider execution separately from held workflow preparation and gates (TASK-2769)', async () => {
  fs.writeFileSync(path.join(fixture.root, 'provider-fixture'), 'enabled');
  const http = await workflowHttp(host);
  const slug = fixture.slugs[0];
  assert.equal((await http.post(slug, 'provider')).status, 202);
  await until(() => fixture.entered(slug), 'synchronous worker preflight');
  const preparation = await fixture.observation.board();
  assert.equal(preparation.metrics.agentAvailability.find(agent => agent.family === 'codex')?.runningSessions, 0);
  fixture.release(slug);
  await until(() => fs.existsSync(path.join(fixture.root, `${slug}.provider-1.entered`)), 'provider barrier');
  await until(async () => {
    const snapshot = await http.snapshot();
    return snapshot.agentAvailability.find((agent: { family: string }) => agent.family === 'codex').runningSessions === 1;
  }, 'shared board detects provider execution');
  const active = await http.snapshot();
  assert.equal(validateWebBoardSnapshot(active).ok, true);
  assert.equal(active.agentAvailability.find((agent: { family: string }) => agent.family === 'codex').runningSessions, 1);
  const card = active.stages.flatMap((stage: { cards: unknown[] }) => stage.cards).find((card: { id: string }) => card.id === slug);
  assert.equal(card.execution.invocations.length, 1);
  assert.equal(card.execution.invocations[0].operationId, (await fixture.service.current(slug))?.id);
  fs.writeFileSync(path.join(fixture.root, `${slug}.provider-1.release`), 'release');
  await until(() => fs.existsSync(path.join(fixture.root, 'post-agent-gate.entered')), 'post-agent gate');
  const ended = await fixture.observation.board();
  assert.equal(ended.metrics.agentAvailability.find(agent => agent.family === 'codex')?.runningSessions, 0);
  assert.equal(ended.stages.flatMap(stage => stage.cards).find(card => card.id === slug)?.execution?.invocations.length, 0);
  assert.ok(await fixture.service.current(slug), 'workflow still owns held gate');
  fs.writeFileSync(path.join(fixture.root, 'post-agent-gate.release'), 'release');

  await until(async () => (await fixture.service.current(slug)) === null, 'worker completes');
});
