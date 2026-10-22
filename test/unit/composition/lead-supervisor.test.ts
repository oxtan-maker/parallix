// Borrowed active forwarding owns cancellation and scope cleanup. Real CLI,
// process and persistence boundaries are covered by the process integration suite.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import type { ProductionApplicationServices } from '../../../src/composition/application-services.js';
import * as fmt from '../../../src/application/presentation/cli-format.js';

const worktrees = mockModule<typeof import('../../../src/adapters/git/worktree.js')>(
  '../../../src/adapters/git/worktree.js', import.meta.url);
await installModuleMocks();
const { createLeadSupervisorPort } = await import('../../../src/composition/lead-supervisor.js');
type Context = Parameters<typeof createLeadSupervisorPort>[2];

for (const outcome of ['success', 'cancelled', 'missing-controller', 'exit'] as const) {
  test(`borrowed active ${outcome} releases only its scope and ends publication (TASK-2792)`, async t => {
    t.after(() => mock.restoreAll());
    mock.method(worktrees, 'resolveWorktree', () => '/target');
    const diagnostics: string[] = [];
    mock.method(fmt.log, 'info', () => {});
    mock.method(fmt.log, 'fail', (message: string) => { diagnostics.push(message); });
    const events: string[] = [];
    let finishActive!: () => void;
    const activeCompletion = new Promise<void>(resolve => { finishActive = resolve; });
    t.after(() => finishActive());
    const controller = {};
    const borrowed = {
      operatorState: { close: async () => { events.push('closed'); } },
      presentationCapabilities: outcome === 'missing-controller' ? {} : { commandController: controller },
    } as unknown as ProductionApplicationServices;
    const services = {
      presentationCapabilities: { boardProjection: {} },
      currentWork: {
        running: async () => { events.push('running'); },
        ended: async () => { events.push('ended'); },
      },
      operatorState: { close: async () => { assert.fail('shared scope must remain open'); } },
    } as unknown as ProductionApplicationServices;
    const signal = new AbortController();
    if (outcome === 'cancelled') { signal.abort(); }
    const active: Context['active'] = async (args, options) => {
      events.push('active');
      assert.deepEqual(args, ['task-borrowed']);
      assert.equal(options?.controller, controller);
      assert.equal(options?.rootDir, '/target');
      assert.equal(typeof options?.missionTitleFn, 'function');
      if (outcome === 'exit') {
        assert.equal(typeof options?.exitFn, 'function');
        (options!.exitFn as (_code: number) => never)(130);
      }
      if (outcome === 'success') { await activeCompletion; }
    };
    const forwards = new Set<Promise<unknown>>();
    const port = createLeadSupervisorPort(services, forwards, {
      rootDir: '/lead', active, registry: {},
      runPublicCli: async () => { assert.fail('active must use the borrowed controller'); },
      scope: { openWorkflowServices: async root => {
        assert.equal(root, '/target'); events.push('opened'); return borrowed;
      } } as Context['scope'],
      launchRecovery: async () => { assert.fail('forwarding must not launch recovery'); },
    });
    await port.runAction('task-borrowed', { kind: 'active:execute', display: 'px active task-borrowed' }, undefined, signal.signal);
    if (outcome === 'success') {
      assert.equal(forwards.size, 1, 'lead resumes polling while active is running');
      assert.deepEqual(events, ['opened', 'running', 'active']);
      finishActive();
    }
    await Promise.all(forwards);
    assert.equal(forwards.size, 0, 'settled forwards cannot remain in fleet shutdown');
    assert.deepEqual(events, ['opened', 'running',
      ...(['success', 'exit'].includes(outcome) ? ['active'] : []), 'closed', 'ended']);
    assert.deepEqual(diagnostics, outcome === 'missing-controller'
      ? ['[lead] px active task-borrowed stopped: No active controller available for task-borrowed']
      : outcome === 'exit' ? ['[lead] px active task-borrowed stopped: command exited with status 130'] : []);
  });
}
