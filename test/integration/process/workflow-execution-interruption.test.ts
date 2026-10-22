// Foreground interruption must settle its owner before an immediate retry.
import { bundleWorkflowChild } from '../../fixtures/workflow-bundle.js';
import { processStartIdentity } from '../../../src/adapters/process/process-liveness.js';
import { WorkflowProcessAdapter } from '../../../src/adapters/process/workflow-process.js';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { workflowBoard, until } from '../../fixtures/workflow-board.js';

test('direct active Ctrl+C settles execution before retry (TASK-2792)', { timeout: 3500 }, async t => {
  const bundle = await bundleWorkflowChild(); t.after(() => bundle.close());
  const fixture = await workflowBoard(1, { cli: bundle.cli, providers: true }); t.after(() => fixture.close());
  const child = spawn(bundle.cli.command, [...bundle.cli.args, '--fixture-cli-execute', fixture.root, fixture.slugs[0]], {
    cwd: fixture.root, env: { ...fixture.configuration.forwardedEnvironment }, stdio: 'pipe',
  });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } });
  await until(() => fixture.entered(fixture.slugs[0]), 'active preparation', 1800);
  fixture.release(fixture.slugs[0]);
  const providerMarker = path.join(fixture.root, `${fixture.slugs[0]}.provider-1.entered`);
  await until(() => fs.existsSync(providerMarker), 'controlled provider execution', 1800);
  const provider = { pid: Number(fs.readFileSync(providerMarker, 'utf8')), identity: '' };
  provider.identity = processStartIdentity(provider.pid)!;
  assert.ok(provider.identity);
  const original = (await fixture.service.current(fixture.slugs[0]))!;
  assert.ok(original.owner);
  assert.notEqual((await fixture.service.admit({ operationId: 'conflicting-retry', missionId: fixture.slugs[0], kind: 'active:execute', capabilities: new Set(['active:execute']) })).status, 'accepted');
  child.kill('SIGINT');
  const [code] = await exited;
  assert.notEqual(code, 0);
  assert.equal((await fixture.service.operation(original.id))?.phase, 'stopped');
  assert.equal(await fixture.service.current(fixture.slugs[0]), null);
  assert.equal((await fixture.service.stop(fixture.slugs[0])).status, 'completed');
  assert.equal((await fixture.service.stop(fixture.slugs[0])).status, 'completed');
  const processes = new WorkflowProcessAdapter(bundle.cli, fixture.root, fixture.configuration);
  assert.equal(await processes.alive(original.owner!), false);
  assert.equal(await processes.alive(provider), false);
  assert.equal((await fixture.service.admit({ operationId: 'active-retry', missionId: fixture.slugs[0], kind: 'active:execute', capabilities: new Set(['active:execute']) })).status, 'accepted');
});
