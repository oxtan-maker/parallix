import { bundleWorkflowChild } from '../../fixtures/workflow-bundle.js';
import { randomUUID } from 'node:crypto';
import { WorkflowProcessAdapter } from '../../../src/adapters/process/workflow-process.js';
// Native stop tree + retained Run attribution and the real CLI wiring, without provider startup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { workflowBoard, until } from '../../fixtures/workflow-board.js';
import { resolvePxEntryLoader, pxNodeArgs } from '../../lib/px-entry.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { openRunCapture } from '../../../src/adapters/filesystem/run-history-store.js';
import { resolveCanonicalRepositoryId } from '../../../src/adapters/git/repository-identity.js';
import { processStartIdentity, probeProcessLiveness } from '../../../src/adapters/process/process-liveness.js';
import { completed } from '../../../src/application/contracts.js';

test('CLI stop settles only its owner tree and attributed detached run before replacement, preserving both attempts and one lane event (TASK-2750)', { timeout: 15_000 }, async t => {
  // Admission persists real intent but its cheap launcher does not execute it;
  // native owners below isolate the process-stop contract from agent composition.
  const fixture = await workflowBoard(2, { cli: { command: process.execPath, args: ['-e', ''] } });
  t.after(() => fixture.close());
  const children: ChildProcess[] = [];
  const identities = new Map<number, string>();
  const emergencyCleanup = () => {
    for (const [pid, identity] of identities) {
      if (processStartIdentity(pid) !== identity) { continue; }
      try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* exited */ } }
    }
  };
  process.prependListener('exit', emergencyCleanup);
  t.after(async () => {
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) { return; }
      const exited = once(child, 'exit');
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      await exited;
    }));
    emergencyCleanup(); process.removeListener('exit', emergencyCleanup);
  });
  const idle = async (script = 'setInterval(() => {}, 1000)') => {
    const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    children.push(child); await once(child, 'spawn'); identities.set(child.pid!, processStartIdentity(child.pid!)!); return child;
  };
  const owner = await idle(`const {spawn}=require('child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); process.send(child.pid); setInterval(()=>{},1000);`);
  const [descendantPid] = await once(owner, 'message') as [number];
  const descendantIdentity = processStartIdentity(descendantPid)!;
  identities.set(descendantPid, descendantIdentity);
  const detached = await idle();
  const unrelated = await idle();
  const operations = ['original', 'other'];
  for (const [index, slug] of fixture.slugs.entries()) {
    assert.equal((await fixture.service.admit({ operationId: operations[index], kind: 'active:execute', missionId: slug, capabilities: new Set(['active:execute']) })).status, 'accepted');
    const operation = (await fixture.service.operation(operations[index]))!;
    const child = index === 0 ? owner : unrelated;
    await fixture.operations.replace({ ...operation, phase: 'preparing', generation: 1,
      owner: { pid: child.pid!, identity: processStartIdentity(child.pid!)! } }, 0);
  }
  const coordinator = openRunCapture({ worktree: fixture.root, runId: `workflow-${randomUUID()}`, captureKind: 'coordinator', terminalHost: 'pipe',
    identity: { repositoryId: resolveCanonicalRepositoryId(fixture.root), missionId: fixture.slugs[0], role: 'active', family: null, attempt: null } });
  coordinator.correlateOperation('original');
  t.after(() => coordinator.finish({ exitCode: null, signal: 'SIGTERM' }));
  const capture = openRunCapture({ worktree: fixture.root, runId: 'execute-codex-a1-detached', terminalHost: 'pipe',
    identity: { repositoryId: resolveCanonicalRepositoryId(fixture.root), missionId: fixture.slugs[0], role: 'execute', family: agentFamily('codex'), attempt: 1 } });
  capture.correlateOperation('original'); capture.observeExecution(detached.pid!, processStartIdentity(detached.pid!));
  t.after(() => capture.finish({ exitCode: detached.exitCode, signal: detached.signalCode }));
  await promisify(execFile)(process.execPath, pxNodeArgs(resolvePxEntryLoader(), ['stop', fixture.slugs[0]]), {
    cwd: fixture.root, env: { ...fixture.configuration.forwardedEnvironment }, timeout: 10_000,
  });
  await until(() => detached.signalCode !== null && owner.signalCode !== null, 'owned processes stopped');
  assert.equal(owner.signalCode, 'SIGTERM'); assert.equal(detached.signalCode, 'SIGTERM');
  const processes = new WorkflowProcessAdapter({ command: process.execPath, args: [] }, fixture.root, fixture.configuration);
  await until(async () => await processes.alive({ pid: descendantPid, identity: descendantIdentity }) === false, 'owned descendant stopped');
  assert.equal(probeProcessLiveness(unrelated.pid!, processStartIdentity(unrelated.pid!)!), true);
  assert.equal((await fixture.service.operation('original'))?.phase, 'stopped');
  assert.equal((await fixture.service.operation('other'))?.phase, 'preparing');
  const loaded = await fixture.store.load(fixture.slugs[0] as never);
  assert.equal(loaded.kind === 'found' && loaded.mission.status, 'active');
  coordinator.finish({ exitCode: null, signal: 'SIGTERM' });
  capture.finish({ exitCode: detached.exitCode, signal: detached.signalCode });
  const replacement = await fixture.service.admit({ operationId: 'replacement', kind: 'active:execute', missionId: fixture.slugs[0], capabilities: new Set(['active:execute']) });
  assert.equal(replacement.status, 'accepted');
  const replacementCapture = openRunCapture({ worktree: fixture.root, runId: `workflow-${randomUUID()}`, captureKind: 'coordinator', terminalHost: 'pipe',
    identity: { repositoryId: resolveCanonicalRepositoryId(fixture.root), missionId: fixture.slugs[0], role: 'active', family: null, attempt: null } });
  replacementCapture.correlateOperation('replacement');
  t.after(() => replacementCapture.finish({ exitCode: 0, signal: null }));
  await fixture.service.run('replacement', async () => completed({}));
  replacementCapture.finish({ exitCode: 0, signal: null });
  assert.equal((await fixture.service.operation('replacement'))?.phase, 'completed');
  assert.equal((await fixture.service.operation('original'))?.phase, 'stopped');
  const history = fixture.terminal.history(fixture.slugs[0]); assert.ok(history.ok);
  assert.ok(history.runs.some(run => run.record.operationId === 'original'));
  assert.equal(history.runs.find(run => run.record.operationId === 'original' && run.record.captureKind === 'coordinator')?.record.signal, 'SIGTERM');
  assert.equal(history.runs.find(run => run.record.operationId === 'replacement')?.record.exitCode, 0);
  const lanes = await fixture.database.query('SELECT * FROM board_lane_events WHERE mission_id = ?', [fixture.slugs[0]]);
  assert.equal(lanes.length, 1, 'replacement cannot fabricate another activation');
});


test('foreground Ctrl+C settles held children and ownership before immediate retry (TASK-2771)', { timeout: 3500 }, async t => {
  const bundle = await bundleWorkflowChild(); t.after(() => bundle.close());
  const fixture = await workflowBoard(1, { cli: bundle.cli }); t.after(() => fixture.close());
  const child = spawn(bundle.cli.command, [...bundle.cli.args, '--workflow-foreground', fixture.root, fixture.slugs[0]], {
    cwd: fixture.root, env: { ...fixture.configuration.forwardedEnvironment }, stdio: 'pipe',
  });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } });
  await until(() => fixture.entered(fixture.slugs[0]), 'held foreground preparation', 1800);
  const original = (await fixture.service.current(fixture.slugs[0]))!;
  assert.ok(original.owner);
  child.kill('SIGINT');
  await new Promise(resolve => setTimeout(resolve, 10));
  child.kill('SIGINT');
  const [code] = await exited;
  assert.notEqual(code, 0);
  assert.equal((await fixture.service.operation(original.id))?.phase, 'stopped');
  assert.equal(await fixture.service.current(fixture.slugs[0]), null);
  assert.equal(await new WorkflowProcessAdapter(bundle.cli, fixture.root, fixture.configuration).alive(original.owner!), false);
  assert.equal((await fixture.service.admit({ operationId: 'retry', missionId: fixture.slugs[0], kind: 'active:execute', capabilities: new Set(['active:execute']) })).status, 'accepted');
});
