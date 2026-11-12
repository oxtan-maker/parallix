import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import type { CliCommandContext } from '../../../src/composition/cli-service-scope.js';
import type { ProductionApplicationServices } from '../../../src/composition/application-services.js';
import { statusMissionData } from '../../fixtures/status-result.js';
import { configureMissionWriteAuthorization } from '../../../src/application/ports/mission-write-authorization.js';
import type { BoardCommandDispatcher } from '../../../src/application/controller/board-command.js';

const boardComposition = mockModule<typeof import('../../../src/composition/status-board.js')>(
  '../../../src/composition/status-board.js', import.meta.url);
const adapters = mockModule<typeof import('../../../src/adapters/cli/commands/status-adapter.js')>(
  '../../../src/adapters/cli/commands/status-adapter.js', import.meta.url);
const web = mockModule<typeof import('../../../src/interfaces/cli/web.js')>(
  '../../../src/interfaces/cli/web.js', import.meta.url);
const assets = mockModule<typeof import('../../../src/adapters/web/asset-store.js')>(
  '../../../src/adapters/web/asset-store.js', import.meta.url);
const observation = mockModule<typeof import('../../../src/composition/workflow-observation.js')>(
  '../../../src/composition/workflow-observation.js', import.meta.url);
await installModuleMocks();
const { createReadCommands } = await import('../../../src/composition/cli-read-commands.js');
const { workflowAttachmentSystem } = await import('../../../src/composition/workflow-operations.js');
test.after(() => mock.restoreAll());

test('production web composition preserves bound durable admission and polling through the failure decorator (PX-0058.01)', async t => {
  configureMissionWriteAuthorization(null);
  t.after(() => configureMissionWriteAuthorization(null));
  const configuration = resolveConfiguration({ WORKFLOW_AGENT: 'codex' });
  const calls: string[] = [];
  const accepted = { kind: 'accepted', operationId: 'durable-operation' };
  const operation = { id: 'durable-operation' };
  const durable = {
    binding: 'durable',
    canExecute: () => ({ allowed: true }),
    dispatch: async () => assert.fail('admission must not execute foreground dispatch'),
    async admit() { assert.equal(this.binding, 'durable'); calls.push('admit'); return accepted; },
    async operation() { assert.equal(this.binding, 'durable'); calls.push('operation'); return operation; },
    async current() { assert.equal(this.binding, 'durable'); calls.push('current'); return operation; },
  };
  const raw = {} as BoardCommandDispatcher;
  const services = { presentationCapabilities: { commandController: raw, boardProjection: {}, tui: {} },
    operatorState: { db: { getPath: () => '/isolated-double.db' }, close: async () => { calls.push('graph-close'); } },
  } as unknown as ProductionApplicationServices;
  t.mock.method(workflowAttachmentSystem, 'composeWorkflowOperations', async (...args: Parameters<typeof workflowAttachmentSystem.composeWorkflowOperations>) => {
    assert.equal(args[0], process.cwd()); assert.equal(args[1], configuration); assert.equal(args[2], raw);
    assert.equal(args[3], '/isolated-double.db');
    return { service: durable, failureEvidence: async () => null, close: async () => { calls.push('owner-close'); } } as unknown as Awaited<ReturnType<typeof workflowAttachmentSystem.composeWorkflowOperations>>;
  });
  t.mock.method(workflowAttachmentSystem, 'startWorkflowRecovery', () => ({ close: async () => { calls.push('recovery-close'); } }));
  t.mock.method(assets, 'resolveWebAssetRoot', () => '/assets');
  t.mock.method(assets, 'loadWebAssets', () => ({}));
  t.mock.method(observation, 'workflowObservationCapabilities', () => ({
    board: async () => ({}), terminal: {}, close: async () => { calls.push('observer-close'); },
  }) as unknown as ReturnType<typeof observation.workflowObservationCapabilities>);
  t.mock.method(web, 'runWebCommand', async (_args: string[], options?: import('../../../src/interfaces/cli/web.js').WebCliOptions) => {
    const source = await options!.createBoardSource!(() => {});
    try {
      const controller = source.commandDispatcher!;
      assert.equal(typeof controller.admit, 'function');
      assert.equal(typeof controller.operation, 'function');
      assert.equal(typeof controller.current, 'function');
      assert.equal(await controller.admit!({ missionId: 'mission', kind: 'review:submit', operationId: 'request', capabilities: new Set() }), accepted);
      assert.equal(await controller.operation!('durable-operation'), operation);
      assert.equal(await controller.current!('mission'), operation);
    } finally { await source.close(); }
    return { host: '127.0.0.1' as const, port: 0, url: 'http://127.0.0.1:0' };
  });
  const scope = { openServices: async () => services } as unknown as CliCommandContext['scope'];
  const commands = createReadCommands({ rootDir: process.cwd(), packageDir: '/package', configuration, scope,
    active: async () => {}, commands: () => commands });
  await commands.web([]);
  assert.deepEqual(calls, ['admit', 'operation', 'current', 'observer-close', 'recovery-close', 'owner-close', 'graph-close']);
});

// Real dispatch, use case and CLI; only effectful factory boundaries are doubled.
test('composed status dispatch injects configuration and focused ports for explicit and inferred slugs', async t => {
  const configuration = resolveConfiguration({ WORKFLOW_AGENT: 'codex' });
  const blocklist = {};
  const mission = { store: { load: async () => ({ kind: 'missing' as const }) }, repositoryId: 'selected-repository' };
  const services = { mission, operatorState: { repositories: { agentBlocklist: blocklist } } } as unknown as ProductionApplicationServices;
  const selected: string[] = [];
  const staleRequests: (string | null)[] = [];
  t.mock.method(boardComposition, 'createStatusReadBoard', async (...[graph, root, config]: Parameters<typeof boardComposition.createStatusReadBoard>): ReturnType<typeof boardComposition.createStatusReadBoard> => {
    assert.equal(graph, services); assert.equal(root, process.cwd()); assert.equal(config, configuration);
    return { inferSlug: () => 'task-inferred', getMissionData: async slug => {
      selected.push(slug);
      return statusMissionData({ missionStatus: 'active', checkpoint: 'CP-2', checkpointDescription: 'Stored checkpoint' });
    } };
  });
  t.mock.method(adapters, 'createStatusGitAdapter', (): ReturnType<typeof adapters.createStatusGitAdapter> => ({
    getCurrentBranch: () => 'mission/elsewhere', missionBranchName: slug => `custom/${slug}`,
    getRebaseInfo: () => null, getLastThreeCommits: () => ['c1', 'c2', 'c3'], getUncommittedCount: () => 2,
  }));
  t.mock.method(adapters, 'createStatusPrAdapter', (options: Parameters<typeof adapters.createStatusPrAdapter>[0]): ReturnType<typeof adapters.createStatusPrAdapter> => {
    assert.equal(options?.rootDir, process.cwd());
    return { getPrInfo: branch => {
      assert.equal(branch, `custom/${selected.at(-1)}`);
      return { exists: true, number: 83, state: 'open' };
    } };
  });
  t.mock.method(adapters, 'createStatusAgentAdapter', (options: Parameters<typeof adapters.createStatusAgentAdapter>[0]): ReturnType<typeof adapters.createStatusAgentAdapter> => {
    assert.equal(options.configuration, configuration); assert.equal(options.rootDir, process.cwd());
    assert.equal(options.blocklistRepo, blocklist);
    return { getAgents: async () => [{ agent: 'codex', block: { kind: 'none' } }], getAgentOverride: () => 'codex' };
  });
  t.mock.method(adapters, 'createStatusStaleWorktreesAdapter', (options: Parameters<typeof adapters.createStatusStaleWorktreesAdapter>[0]): ReturnType<typeof adapters.createStatusStaleWorktreesAdapter> => {
    assert.equal(options?.missionStore, mission.store);
    assert.equal(options?.repositoryId, mission.repositoryId);
    return { findStaleWorktrees: async explicit => { staleRequests.push(explicit); return []; }, getStaleWorktreeRebase: () => ({}) };
  });
  const scope = { withGraph: async (invoke, options) => {
    assert.deepEqual(options, { includePresentationCapabilities: false });
    return invoke(services);
  } } as CliCommandContext['scope'];
  const commands = createReadCommands({ rootDir: process.cwd(), packageDir: '/package', configuration, scope,
    active: async () => {}, commands: () => commands });
  for (const args of [['task-explicit'], [], ['task-explicit', '--json'], ['--json']]) {
    const lines: string[] = [];
    let exit: number | undefined;
    await commands.status(args, { logFn: (line: string) => lines.push(line), exitFn: (code: number) => { exit = code; } });
    assert.equal(exit, 0);
    if (args.includes('--json')) {
      const json = JSON.parse(lines.join('\n'));
      assert.equal(json.slug, args[0] === 'task-explicit' ? 'task-explicit' : 'task-inferred');
      assert.equal(json.missionStatus, 'active'); assert.equal(json.latestCheckpoint.name, 'CP-2');
      assert.equal(json.pullRequest.number, 83);
      assert.equal(json.agents, undefined);
    } else {
      const output = lines.join('\n');
      for (const section of ['--- Mission Status ---', 'Branch: mission/elsewhere', 'Worktree:',
        'Mission status: active', 'Last checkpoint: CP-2 - Stored checkpoint', 'Forgejo PR: #83 (open)',
        'Agents:', 'codex: available', 'WORKFLOW_AGENT override:', 'Last 3 commits:', 'Uncommitted files: 2', '----------------------']) {
        assert.ok(output.includes(section), section);
      }
    }
  }
  assert.deepEqual(selected, ['task-explicit', 'task-inferred', 'task-explicit', 'task-inferred']);
  assert.deepEqual(staleRequests, ['task-explicit', null, 'task-explicit', null]);
});
