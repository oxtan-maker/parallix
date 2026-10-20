import type { BoardCommandRequest } from '../../src/application/controller/board-command.js';
import type { ApplicationOutcome } from '../../src/application/contracts.js';
import { startAgent } from '../../src/adapters/agents/agents.js';
import { fakeLauncher } from '../lib/agent-mock.js';
import { resolveConfiguration } from '../../src/composition/config.js';
import { startReview, applyReviewerCommand, changeRevision, ConfiguredReviewerEligibility, revokeApprovedDecision } from '../../src/domain/review.js';
/** Disposable public workflow observation; run with npx tsx, never discovered as a test. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openMigratedMissionStore } from './mission-sqlite-store.js';
import { fixtureMission } from './mission-builders.js';
import { makeExecutePorts } from './execute-mission-ports.js';
import { fakeReviewLoopPorts } from '../helpers/review-loop-ports.js';
import { rebaseWorkflowFixture } from '../helpers/rebase-workflow-fixture.js';
import { SqliteWorkflowOperationStore } from '../../src/adapters/sqlite/workflow-operation-store.js';
import { WorkflowOperationService } from '../../src/application/workflow-operation-service.js';
import { ExecuteMissionService } from '../../src/application/execute-mission-service.js';
import { RebaseCommandUseCase } from '../../src/application/rebase-command-use-case.js';
import { runReviewLoop } from '../../src/application/review-loop/review-loop.js';
import { AgentExecutionAdapter, createDefaultExecuteMissionRuntime } from '../../src/adapters/mission/execute-mission-adapters.js';
import { createWebHost } from '../../src/interfaces/web/host.js';
import { loadWebAssets } from '../../src/adapters/web/asset-store.js';
import { repositoryId } from '../../src/domain/repository.js';
import { missionId } from '../../src/domain/mission.js';
import { agentFamily } from '../../src/domain/agents.js';
import { completed } from '../../src/application/contracts.js';
import { MissionLifecycleService } from '../../src/application/mission-lifecycle-service.js';

const slug = 'task-continuity-probe';
const repository = repositoryId('disposable-continuity');
const fixture = await openMigratedMissionStore([fixtureMission(slug, { repositoryId: repository, status: 'refined', assignee: agentFamily('claude') })]);
const configuration = resolveConfiguration({ PARALLIX_HOME: fixture.root, PARALLIX_NO_BUBBLEWRAP: '1' });
const operations = new SqliteWorkflowOperationStore(fixture.database, repository);
const launched: string[] = [];
let fallback = false;
let selections = 0;
let pool = ['codex', 'custom'];
const runtime = { ...createDefaultExecuteMissionRuntime(),
  readAgentConfig: () => ({ steps: { active: { eligible: pool, selection: 'first' } } }),
  resolveExecutionContext: async () => null,
  buildCheckpointContext: () => 'Disposable continuity observation',
  buildExecutePrompt: () => 'Disposable deterministic provider',
  selectLaunchAndRecord: async (request: Parameters<ReturnType<typeof createDefaultExecuteMissionRuntime>['selectLaunchAndRecord']>[0]) => {
    const result = await startAgent('active', {
      configuration, prompt: request.prompt, worktree: fixture.root, agent: request.preselectedAgent!, slug,
      isAgentBlockedFn: agent => fallback && agent === 'codex',
      selectAgentFn: () => 'custom', assertAgentSupportedFn: () => {},
      resolveAgentModelFn: () => 'stub', detectLimitHitFn: () => null, updateAgentBlockFn: () => ({}),
      launchAgentFn: fakeLauncher({ exitCode: 0 }), log: () => {},
      onLaunch: async event => { launched.push(event.agent); await request.onAgentLaunched?.(event.agent); },
    });
    return { ...result, rebaseDeferred: true };
  },
};
const execution = new AgentExecutionAdapter(runtime, null, null, configuration);
const { ports } = makeExecutePorts({ missionTransitions: fixture.store, agentExecution: execution,
  workspace: { resolveWorktree: async () => fixture.root },
  telemetry: { recordLaunchTelemetry: async () => {} },
});
// Class methods are not enumerable; use the real selection/launch adapter directly.
const execute = new ExecuteMissionService({ ...ports, agentExecution: execution });
const owner = async () => {
  const loaded = await fixture.store.load(missionId(slug));
  assert.equal(loaded.kind, 'found');
  if (loaded.kind !== 'found') { throw new Error('missing disposable mission'); }
  return loaded;
};
let service: WorkflowOperationService;
const dispatcher = {
  canExecute: () => true,
  async dispatch<T>(request: BoardCommandRequest): Promise<ApplicationOutcome<T>> {
    if (request.kind === 'active:execute') { return execute.execute({ operationId: request.operationId, slug, agent: request.agent, capabilities: request.capabilities }) as Promise<ApplicationOutcome<T>>; }
    const stored = (await owner()).mission.assignee!;
    if (request.kind === 'review:submit') {
      const fake = fakeReviewLoopPorts({ slug, worktree: fixture.root, missionStore: fixture.store, lifecycle: new MissionLifecycleService(fixture.store),
        task: { implementer: () => null }, handoff: { handoff: async () => ({ ok: true }) },
        provider: { pollReview: async () => 'CHANGES_REQUESTED', pollDisposition: async () => 'CHANGES_MADE' },
        routing: { eligibleFamilies: () => ['codex', 'claude', 'custom'] },
        agents: { launch: async r => { if (r.role === 'implementer') { launched.push(r.agent); } return { agent: r.agent, result: {} }; } },
        preReview: { head: () => null },
      });
      await runReviewLoop({ slug, maxAttempts: 1, implementer: request.agent ?? undefined }, fake.ports);
      assert.ok(fake.launches.some(r => r.role === 'implementer' && r.agent === (request.agent ?? stored)), JSON.stringify({ logs: fake.logs, errors: fake.errors, launches: fake.launches }));
    } else if (request.kind === 'integrate:merge') {
      const ok = { status: 0, signal: null, stdout: '', stderr: '' };
      const rebase = rebaseWorkflowFixture({
        git: args => args.includes('rebase') && args.includes('main')
          ? { ...ok, status: 1, stderr: 'CONFLICT (content): Merge conflict in shared.ts\n' } : ok,
        detectRebaseState: () => ({ inProgress: false, unmergedFiles: [] }),
        getCurrentBranch: () => `mission/${slug}`, cwd: () => fixture.root, inferSlug: () => slug,
        findMissionDir: () => fixture.root, findMissionArea: () => 'all', resolveWorktree: () => fixture.root,
        conventionalWorktreePath: () => fixture.root, missionBranchName: () => `mission/${slug}`,
        resolveMissionBaseBranch: () => 'main', missionConflictPathPrefix: () => 'unused/', resolvePromptBaseBranch: () => 'main',
        startAgent: async (_step, r) => { launched.push(String(r.agent)); return { agent: String(r.agent), result: { status: 0 } }; },
        selectAgent: () => { throw new Error('integration repair must retain its owner'); },
        workflowLauncherStatus: agent => ({ supported: true, agent }), applyAgentFallback: async () => stored,
        createPr: () => ({ ok: true }), readToken: () => 'disposable', resolveForgejoUser: user => user ?? 'fixture', fetchReviewBranch: () => ok,
        resolveTaskFile: () => ({ ok: false, matches: [] }), getTaskImplementer: () => null, transitionTask: async () => {},
        resolveReviewIdentity: () => ({ forgejoUser: 'fixture' }), readReviewState: async () => ({ implementer: stored, metadata: {} }),
        writeReviewState: async () => ({ outcome: 'committed' }), persistReviewState: async () => ({ outcome: 'committed' }),
        isForgejoReviewEnabled: () => false, formatVerificationCommand: () => 'git diff --check',
        resolveConflictsForMission: () => ({ ok: true, conflictFiles: ['shared.ts'], missionSpecificFiles: [], sharedFiles: ['shared.ts'] }),
        missionServices: null, exit: code => assert.equal(code, 0),
      });
      await new RebaseCommandUseCase(rebase).execute([slug]);
    }
    return completed({} as T);
  },
};
const work = { async running() {}, async ended() {}, async blocked() {} };
service = new WorkflowOperationService(operations, fixture.store, dispatcher,
  { identity: () => ({ pid: process.pid, identity: 'manual-observation' }), async launch() {}, async alive() { return true; }, async stop() { return true; } },
  work, repository, async () => { selections++; return (await execution.select(slug))!; }, async () => {}, undefined, undefined, undefined,
  agent => execution.eligible(agent));
const host = createWebHost({ assets: loadWebAssets(path.resolve('build/web')), commandDispatcher: () => service });
try {
  const { origin } = await host.start();
  const shell = await fetch(origin);
  const html = await shell.text();
  const csrf = /name="px-csrf" content="([^"]+)"/.exec(html)![1];
  const cookie = shell.headers.get('set-cookie')!.split(';')[0];
  const headers = { 'content-type': 'application/json', 'x-px-csrf': csrf, cookie, origin };
  const post = async (kind: string, status: string) => {
    const response = await fetch(`${origin}/api/commands`, { method: 'POST', headers,
      body: JSON.stringify({ kind, missionId: slug, missionStatusAtRequest: status, requestKey: randomUUID() }) });
    const result = await response.json() as { value: { operationId: string }; error?: unknown };
    assert.equal(response.status, kind === 'workflow:stop' ? 200 : 202, JSON.stringify(result));
    return result.value?.operationId;
  };
  const observe = async (scenario: string, id: string, expected: string) => {
    const operation = await service.operation(id);
    const priorLaunches = launched.length;
    await service.run(id);
    const settled = await service.operation(id);
    assert.equal(settled?.phase, 'completed', settled?.reason ?? 'workflow operation did not complete');
    const persisted = (await owner()).mission.assignee;
    const actual = launched.slice(priorLaunches);
    assert.deepEqual(actual, [expected]); assert.equal(persisted, expected);
    console.log(JSON.stringify({ scenario, selected: operation?.agent ?? persisted, persisted, launched: actual, selections }));
  };
  await observe('activation (draft assignee claude)', await post('active:execute', 'refined'), 'codex');
  const stopped = await post('active:execute', 'active');
  await post('workflow:stop', 'active');
  assert.equal((await service.operation(stopped))?.phase, 'stopped');
  // A fresh host instance would read the same SQLite assignee; no service state owns it.
  await observe('stop/restart', await post('active:execute', 'active'), 'codex');
  const active = await owner(); await fixture.store.save({ ...active.mission, status: 'review', closedAt: null }, active.version);
  await observe('review response', await post('review:submit', 'review'), 'codex');
  const reviewOverride = async (agent: string) => {
    const result = await service.admit({ operationId: randomUUID(), kind: 'review:submit', missionId: slug, agent, capabilities: new Set(['review:submit']) });
    if (result.status !== 'accepted') { throw new Error('review override not admitted'); }
    return result.operation.id;
  };
  await observe('review explicit override', await reviewOverride('custom'), 'custom');
  await observe('review override continuation', await post('review:submit', 'review'), 'custom');
  await observe('review explicit restore', await reviewOverride('codex'), 'codex');
  // Seed the integration lane in this disposable DB; providers and Git are deterministic boundaries.
  const loaded = await owner();
  const reviewer = agentFamily('claude');
  const review = applyReviewerCommand(startReview({ change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
    revision: changeRevision('disposable-revision') }, reviewer, agentFamily('codex'), new Date().toISOString(),
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' })),
    { type: 'approve', decidedAt: new Date().toISOString(), comment: null, source: { kind: 'local' } });
  await fixture.store.save({ ...loaded.mission, status: 'integration', closedAt: null, review }, loaded.version);
  await observe('integration repair', await post('integrate:merge', 'integration'), 'codex');
  const integration = await owner();
  // Changing the implementer requires revoking the approval, as in the real workflow.
  const reopened = revokeApprovedDecision(integration.mission.review!, 1, {
    revokedAt: new Date().toISOString(), revokedBy: 'operator', reason: 'Disposable override observation',
  });
  await fixture.store.save({ ...integration.mission, status: 'active', closedAt: null, review: reopened }, integration.version);
  const override = await service.admit({ operationId: randomUUID(), kind: 'active:execute', missionId: slug, agent: 'custom', capabilities: new Set(['active:execute']) });
  assert.equal(override.status, 'accepted');
  if (override.status !== 'accepted') { throw new Error('override not admitted'); }
  await observe('explicit override', override.operation.id, 'custom');
  await observe('override continuation', await post('active:execute', 'active'), 'custom');
  // Keep ownership eligible at admission; the provider reports a capacity fallback at launch.
  pool = ['codex', 'custom'];
  const reset = await service.admit({ operationId: randomUUID(), kind: 'active:execute', missionId: slug, agent: 'codex', capabilities: new Set(['active:execute']) });
  if (reset.status !== 'accepted') { throw new Error('fallback setup not admitted'); }
  fallback = true;
  await observe('blocked launch fallback', reset.operation.id, 'custom');
  fallback = false;
  await observe('fallback continuation', await post('active:execute', 'active'), 'custom');
  assert.equal(selections, 1);
  console.log('PASS: isolated HTTP workflow + public override admission; SQLite ownership; deterministic provider/Git boundaries; telemetry disabled. No operator state touched.');
} finally { await host.close(); await fixture.close(); }
