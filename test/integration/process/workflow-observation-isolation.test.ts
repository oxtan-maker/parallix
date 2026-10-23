import fs from 'node:fs';
import path from 'node:path';
import { validateWebBoardSnapshot } from '../../../src/interfaces/web/transport.js';
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
  fixture = await workflowBoard(2, { cli: bundle.cli });
  fs.mkdirSync(path.join(fixture.root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(fixture.root, 'config/agents.json'), JSON.stringify({ families: ['codex', 'claude'] }));
  host = await fixture.start();
  // Each read-only observer process builds its own graph on its first request. Warm both
  // here so the timed cases measure isolation, not cold observer startup.
  await fixture.observation.board();
  await fixture.observation.terminal.overview(fixture.slugs[0]);
});
after(async () => { try { await fixture?.close(); } finally { bundle?.close(); } });

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
