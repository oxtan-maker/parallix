// Lead borrows active's owner; interruption must settle that forwarded workflow.
import test from 'node:test';
import assert from 'node:assert/strict';


test('lead SIGINT settles borrowed active work and stops supervision (TASK-2792)', async t => {
  const { bundleWorkflowChild } = await import('../../fixtures/workflow-bundle.js');
  const { workflowBoard, until } = await import('../../fixtures/workflow-board.js');
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const bundle = await bundleWorkflowChild(); t.after(() => bundle.close());
  const fixture = await workflowBoard(1, { cli: bundle.cli }); t.after(() => fixture.close());
  const child = spawn(bundle.cli.command, [...bundle.cli.args, '--fixture-cli-lead', fixture.root, fixture.slugs[0]], {
    cwd: fixture.root, env: { ...fixture.configuration.forwardedEnvironment }, stdio: 'pipe',
  });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } });
  let output = ''; child.stdout.on('data', bytes => { output += String(bytes); });
  child.stderr.on('data', bytes => { output += String(bytes); });
  await until(() => fixture.entered(fixture.slugs[0]), 'lead borrowed active preparation').catch(error => { throw new Error(`${error.message}: ${output}`); });
  const original = (await fixture.service.current(fixture.slugs[0]))!;
  child.kill('SIGINT');
  const [code] = await exited;
  assert.equal(code, 130, output);
  assert.match(output, /Lead supervision interrupted/);
  assert.match(output, /owned work stopped/);
  assert.equal((await fixture.service.operation(original.id))?.phase, 'stopped', output);
  assert.equal(await fixture.service.current(fixture.slugs[0]), null);
});
