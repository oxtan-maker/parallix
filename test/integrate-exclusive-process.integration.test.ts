import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createIntegrateWorkflow } from '../src/application/integrate-workflow.js';
import { createIntegratePorts } from '../src/adapters/cli/commands/integrate.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firstRun = `
  import { createIntegrateWorkflow } from './src/application/integrate-workflow.ts';
  import { createIntegratePorts } from './src/adapters/cli/commands/integrate.ts';
  const slug = process.env.PARALLIX_CLAIM_TEST_SLUG;
  const ports = createIntegratePorts();
  const workflow = createIntegrateWorkflow({
    ...ports,
    process: { ...ports.process, terminate: () => {} },
    missionPaths: { ...ports.missionPaths, inferSlug: () => slug },
  });
  process.stdin.resume();
  await workflow.integrate([slug], {
    missionServicesFn: async () => {
      process.stdout.write('CLAIMED');
      await new Promise(resolve => process.stdin.once('end', resolve));
      throw new Error('fixture complete');
    },
    exitFn: () => {},
  });
`;

test('two integrate processes cannot both read one Mission', async (t) => {
  const slug = `task-${Date.now()}-${process.pid}`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', firstRun], {
    cwd: repoRoot,
    env: { ...process.env, PARALLIX_CLAIM_TEST_SLUG: slug },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => { if (!child.killed) { child.kill(); } });

  await new Promise<void>((resolve, reject) => {
    let output = '';
    let errors = '';
    child.stderr.on('data', chunk => { errors += String(chunk); });
    const timeout = setTimeout(() => reject(new Error(`first integrate did not acquire its claim: stdout=${JSON.stringify(output)} stderr=${JSON.stringify(errors)}`)), 5000);
    child.stdout.on('data', chunk => {
      output += String(chunk);
      if (output.includes('CLAIMED')) { clearTimeout(timeout); resolve(); }
    });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`first integrate exited before claim: ${code}`)); });
  });

  const ports = createIntegratePorts();
  let missionReads = 0;
  const workflow = createIntegrateWorkflow({
    ...ports,
    process: { ...ports.process, terminate: () => {} },
    missionPaths: { ...ports.missionPaths, inferSlug: () => slug },
  });
  const result = await workflow.integrate([slug], {
    missionServicesFn: async () => { missionReads++; throw new Error('must not read Mission'); },
    exitFn: () => {},
  });
  assert.deepEqual(result, { exitCode: 1 });
  assert.equal(missionReads, 0);

  child.stdin.end();
  await new Promise<void>(resolve => child.once('exit', () => resolve()));
});
