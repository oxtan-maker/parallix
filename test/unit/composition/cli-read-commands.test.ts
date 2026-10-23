import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import type { CliCommandContext } from '../../../src/composition/cli-service-scope.js';
import type { ProductionApplicationServices } from '../../../src/composition/application-services.js';
import { statusMissionData } from '../../fixtures/status-result.js';

const boardComposition = mockModule<typeof import('../../../src/composition/status-board.js')>(
  '../../../src/composition/status-board.js', import.meta.url);
const adapters = mockModule<typeof import('../../../src/adapters/cli/commands/status-adapter.js')>(
  '../../../src/adapters/cli/commands/status-adapter.js', import.meta.url);
await installModuleMocks();
const { createReadCommands } = await import('../../../src/composition/cli-read-commands.js');
test.afterEach(() => mock.restoreAll());

// Real dispatch, use case and CLI; only effectful factory boundaries are doubled.
test('composed status dispatch injects configuration and focused ports for explicit and inferred slugs', async () => {
  const configuration = resolveConfiguration({ WORKFLOW_AGENT: 'codex' });
  const blocklist = {};
  const mission = { store: { load: async () => ({ kind: 'missing' as const }) }, repositoryId: 'selected-repository' };
  const services = { mission, operatorState: { repositories: { agentBlocklist: blocklist } } } as unknown as ProductionApplicationServices;
  const selected: string[] = [];
  const staleRequests: (string | null)[] = [];
  mock.method(boardComposition, 'createStatusReadBoard', async (...[graph, root, config]: Parameters<typeof boardComposition.createStatusReadBoard>): ReturnType<typeof boardComposition.createStatusReadBoard> => {
    assert.equal(graph, services); assert.equal(root, process.cwd()); assert.equal(config, configuration);
    return { inferSlug: () => 'task-inferred', getMissionData: async slug => {
      selected.push(slug);
      return statusMissionData({ missionStatus: 'active', checkpoint: 'CP-2', checkpointDescription: 'Stored checkpoint' });
    } };
  });
  mock.method(adapters, 'createStatusGitAdapter', (): ReturnType<typeof adapters.createStatusGitAdapter> => ({
    getCurrentBranch: () => 'mission/elsewhere', missionBranchName: slug => `custom/${slug}`,
    getRebaseInfo: () => null, getLastThreeCommits: () => ['c1', 'c2', 'c3'], getUncommittedCount: () => 2,
  }));
  mock.method(adapters, 'createStatusPrAdapter', (options: Parameters<typeof adapters.createStatusPrAdapter>[0]): ReturnType<typeof adapters.createStatusPrAdapter> => {
    assert.equal(options?.rootDir, process.cwd());
    return { getPrInfo: branch => {
      assert.equal(branch, `custom/${selected.at(-1)}`);
      return { exists: true, number: 83, state: 'open' };
    } };
  });
  mock.method(adapters, 'createStatusAgentAdapter', (options: Parameters<typeof adapters.createStatusAgentAdapter>[0]): ReturnType<typeof adapters.createStatusAgentAdapter> => {
    assert.equal(options.configuration, configuration); assert.equal(options.rootDir, process.cwd());
    assert.equal(options.blocklistRepo, blocklist);
    return { getAgents: async () => [{ agent: 'codex', block: { kind: 'none' } }], getAgentOverride: () => 'codex' };
  });
  mock.method(adapters, 'createStatusStaleWorktreesAdapter', (options: Parameters<typeof adapters.createStatusStaleWorktreesAdapter>[0]): ReturnType<typeof adapters.createStatusStaleWorktreesAdapter> => {
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
