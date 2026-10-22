// Foreground interruption must settle its owner before an immediate retry.
import { bundleWorkflowChild } from '../../fixtures/workflow-bundle.js';
import { WorkflowProcessAdapter } from '../../../src/adapters/process/workflow-process.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { workflowBoard, until } from '../../fixtures/workflow-board.js';

test('direct active Ctrl+C settles held children and ownership before immediate retry (TASK-2771, TASK-2792)', { timeout: 3500 }, async t => {
  const bundle = await bundleWorkflowChild(); t.after(() => bundle.close());
  const fixture = await workflowBoard(1, { cli: bundle.cli }); t.after(() => fixture.close());
  const child = spawn(bundle.cli.command, [...bundle.cli.args, '--fixture-cli-execute', fixture.root, fixture.slugs[0]], {
    cwd: fixture.root, env: { ...fixture.configuration.forwardedEnvironment, NODE_COMPILE_CACHE: path.join(fixture.root, 'compile-cache') }, stdio: 'pipe',
  });
  let output = ''; child.stdout.on('data', bytes => { output += String(bytes); }); child.stderr.on('data', bytes => { output += String(bytes); });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } });
  await until(() => fixture.entered(fixture.slugs[0]) || child.exitCode !== null || child.signalCode !== null, 'held foreground preparation', 1800)
    .catch(error => { throw new Error(`${error.message}: ${output}`); });
  assert.ok(fixture.entered(fixture.slugs[0]), output);
  const original = (await fixture.service.current(fixture.slugs[0]))!;
  assert.ok(original.owner);
  child.kill('SIGINT');
  await new Promise(resolve => setTimeout(resolve, 10));
  child.kill('SIGINT');
  const [code] = await exited;
  assert.notEqual(code, 0);
  assert.equal((await fixture.service.operation(original.id))?.phase, 'stopped');
  assert.equal(await fixture.service.current(fixture.slugs[0]), null);
  assert.match(output, /owned work stopped/);
  assert.equal(await new WorkflowProcessAdapter(bundle.cli, fixture.root, fixture.configuration).alive(original.owner!), false);
  assert.equal((await fixture.service.admit({ operationId: 'retry', missionId: fixture.slugs[0], kind: 'active:execute', capabilities: new Set(['active:execute']) })).status, 'accepted');
});
