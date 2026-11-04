// Lead borrows active's owner; interruption must settle that forwarded workflow.
// The fixture modules are imported statically, like the sibling suites in this
// directory, so the case measures lead supervision and not the first tsx
// transpile of the fixture graph.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleWorkflowChild } from '../../fixtures/workflow-bundle.js';
import { workflowBoard, until } from '../../fixtures/workflow-board.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';


test('lead SIGINT settles borrowed active work and stops supervision (TASK-2792)', async t => {
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
  const activity = await fixture.database.query<{ event_data: string }>(
    "SELECT event_data FROM operational_history WHERE event_type = 'mission.current-work' ORDER BY id",
  );
  const lead = activity.map(row => JSON.parse(row.event_data) as { actor?: string; timeState?: string; state?: string })
    .filter(row => row.actor === 'lead');
  assert.deepEqual(lead.map(row => [row.state, row.timeState]), [['running', 'working'], ['ended', 'working']],
    'lead start and stop preserve explicit responsibility instead of inferring it from agent absence');
});
