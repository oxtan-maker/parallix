// Synchronous terminal work must stay in its own persistent observation process.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { workflowBoard, until } from '../../fixtures/workflow-board.js';
import { bundleWorkflowChild } from '../../fixtures/workflow-bundle.js';
import { workflowHttp } from '../../fixtures/workflow-http.js';
let bundle: Awaited<ReturnType<typeof bundleWorkflowChild>>;
before(async () => { bundle = await bundleWorkflowChild(); });
after(() => bundle?.close());

test('held synchronous terminal probe cannot block board snapshots or independent admission (TASK-2750)', { timeout: 15_000 }, async t => {
  const fixture = await workflowBoard(2, { cli: bundle.cli }); t.after(() => fixture.close());
  const host = await fixture.start();
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
