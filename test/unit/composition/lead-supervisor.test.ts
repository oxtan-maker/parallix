// Borrowed active forwarding owns cancellation and scope cleanup. Real CLI,
// process and persistence boundaries are covered by the process integration suite.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import type { ProductionApplicationServices } from '../../../src/composition/application-services.js';
import * as fmt from '../../../src/application/presentation/cli-format.js';
import { buildBoardProjection } from '../../../src/application/projections/board.js';
import { makeCard, emptyMetrics } from '../../fixtures/board-projection.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { resolveConfiguration } from '../../../src/composition/config.js';

const worktrees = mockModule<typeof import('../../../src/adapters/git/worktree.js')>(
  '../../../src/adapters/git/worktree.js', import.meta.url);
const gitModule = mockModule<typeof import('../../../src/adapters/git/git.js')>(
  '../../../src/adapters/git/git.js', import.meta.url);
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
      rootDir: '/lead', active, registry: {}, configuration: resolveConfiguration({}),
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

test('lead refuses liveness when the activity authority is unavailable (TASK-2822)', async () => {
  let cardReads = 0;
  const services = {
    operatorState: { repositories: null, db: null },
    presentationCapabilities: { boardProjection: { async buildMissionCard() { cardReads++; return { currentWork: null }; } } },
  } as unknown as ProductionApplicationServices;
  const port = createLeadSupervisorPort(services, new Set(), {
    rootDir: '/lead', configuration: resolveConfiguration({}), scope: {} as Context['scope'],
  } as Context);
  await assert.rejects(() => port.liveness('task-unreadable'), /operator database is unavailable/);
  assert.equal(cardReads, 0, 'missing authority cannot become a successful idle observation');
});
for (const diagnostic of ['blocking', 'gate-failed', 'stale-work'] as const) {
  test(`board ${diagnostic} review recovery forwards public review without deciding (TASK-2814)`, async t => {
    t.after(() => mock.restoreAll());
    mock.method(worktrees, 'resolveWorktree', () => '/target');
    mock.method(fmt.log, 'info', () => {});
    mock.method(gitModule, 'git', () => ({ status: 0, stdout: 'fixture-sha', stderr: '' }));
    const card = makeCard({ lane: 'review', status: 'review', rawStatus: 'review',
      blockingReason: diagnostic === 'blocking' ? 'Workflow exited with status 1' : null,
      gate: diagnostic === 'gate-failed' ? 'failed' : 'passed',
      currentWork: diagnostic === 'stale-work' ? {
        operationId: 'old-review', phase: 'review', summary: 'stopped', agent: agentFamily('codex'),
        updatedAt: '2026-08-30T00:00:00Z', freshness: 'stale',
      } : null,
      commands: [{ command: 'active', enabled: false, reason: 'review lane' }, { command: 'review', enabled: true, reason: null }],
    });
    const projection = buildBoardProjection(card.repositoryId, [card], [], [], emptyMetrics, []);
    const item = projection.attentionQueue[0]!;
    assert.equal(item.action?.display, `px review ${card.id}`);
    const publications: string[] = [];
    const services = {
      presentationCapabilities: { boardProjection: { build: async () => projection } },
      currentWork: {
        running: async (publication: { phase: string }) => { publications.push(publication.phase); },
        ended: async () => { publications.push('ended'); },
      },
    } as unknown as ProductionApplicationServices;
    const forwards = new Set<Promise<unknown>>();
    const invocations: unknown[] = [];
    const port = createLeadSupervisorPort(services, forwards, {
      rootDir: '/lead', configuration: resolveConfiguration({}), registry: { review: async () => {} },
      active: async () => { assert.fail('review recovery must not invoke active'); },
      runPublicCli: async (args, options) => { invocations.push({ args, cwd: options?.baseCwd, operatorInvocation: options?.operatorInvocation }); return 0; },
      scope: { openWorkflowServices: async () => { assert.fail('review owns its public workflow'); } } as unknown as Context['scope'],
      launchRecovery: async () => { assert.fail('forwarding must not launch recovery'); },
    });
    const observed = (await port.attention())[0]!;
    assert.equal(observed.missionId, card.id);
    assert.deepEqual(observed.reason, item.reason);
    assert.deepEqual(observed.action, item.action);
    assert.equal(observed.working, false);
    assert.ok(observed.action);
    await port.runAction(observed.missionId, observed.action, observed);
    await Promise.all(forwards);
    assert.deepEqual(invocations, [{ args: ['review', card.id], cwd: '/target', operatorInvocation: false }]);
    assert.deepEqual(publications, ['review', 'ended']);
    assert.equal(card.reviewApproved, false);
  });
}
