import type { HandoffWorkflowPorts } from '../../../src/application/ports/handoff-workflow.js';
import { draftMissionServicesFixture } from '../../helpers/draft-mission-services.js';
import { stubIntegrateWorkflowPorts } from '../../helpers/stub-integrate-workflow-ports.js';
import { integrationContext } from '../../fixtures/integration-context.js';
import { integrationServices } from '../../helpers/stub-integration-services.js';
import { integrationBounceSeams } from '../../helpers/integration-bounce-seams.js';
import { phaseGateResult } from '../../helpers/phase-gate-result.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import type { GateStepRequest } from '../../../src/application/integrate/gates.js';
import type { IntegrationGateRoute } from '../../../src/application/ports/integrate-workflow.js';
import type { DraftMissionServices } from '../../../src/application/ports/cli-workflows.js';
import { forgejoApiFixture } from '../../fixtures/forgejo-api.js';
// Mission draft refine contract (TASK-2622.07 behavior-owned suite; was test/task-2561-lifecycle-unblock.test.ts).
// Legacy case names are unchanged; regression provenance TASK-2561.
//
// TASK-2561 regression coverage beyond the red-to-green repro: the bounded
// draft bounce-back, the draft prompt matching the enforced contract, the
// pre-draft worktree hook, the handoff PR area, the integration re-review
// routes, and the `px status` PR lookup and agent view.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDraftWorkflowAdapter, DRAFT_CONTRACT_REPAIR_ATTEMPTS } from '../../../src/adapters/cli/commands/draft-stats.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { normalizeDraftClassification, buildRestartPrompt } from '../../../src/adapters/cli/commands/draft-prompts.js';
import { decideMission } from '../../../src/domain/mission-workflow.js';
import { missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { validateWorkflowConfig } from '../../../src/adapters/config/product-config.js';
import { runPreDraftHook, storeStateFromOutput } from '../../../src/adapters/process/pre-draft-hook.js';
import { buildWorkflowConfig } from '../../../src/adapters/review/setup-review-config.js';
import { HandoffCommandUseCase } from '../../../src/application/handoff-command-use-case.js';
import { createIntegrationGateStep } from '../../../src/application/integrate/gates.js';
import { setLogger } from '../../../src/application/presentation/cli-format.js';
import { getPrStatus } from '../../../src/adapters/forgejo/forgejo.js';
import { createStatusAgentAdapter } from '../../../src/adapters/cli/commands/status-adapter.js';
import type { DraftWorkflowContext } from '../../../src/application/ports/cli-workflows.js';
import type { IntegrateWorkflowPorts } from '../../../src/application/ports/integrate-workflow.js';
import type { AgentBlocklistRepository } from '../../../src/application/ports/agent-blocklist.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { createGateCommand } from '../../../src/interfaces/cli/mission-writes.js';
import { SLUG, makePorts, makeRecorder, runOptions } from '../../helpers/handoff-ports.js';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function quietly<T>(run: () => Promise<T>): Promise<T> {
  const previous = setLogger({ log: () => {} });
  return run().finally(() => setLogger(previous));
}

// --- draft bounce-back budget -------------------------------------------------------

function draftContext(transition: DraftMissionServices['lifecycle']['transition'], repair: () => Promise<boolean>): DraftWorkflowContext {
  return {
    exited: false, slug: 'task-x', mainRepo: '/repo', targetWorktree: '/repo-task-x',
    missionFile: '/repo-task-x/missions/task-x/MISSION.md', recordedBase: null, syntheticTask: null,
    agent: 'codex', actualAgent: 'codex', agentResult: null,
    exitFn: () => { throw new Error('unused'); }, logFn: () => {}, errorFn: () => {},
    missionServicesFn: async () => draftMissionServicesFixture({ lifecycle: { transition }, store: { async load() { return { kind: 'missing' as const }; } } }),
    options: {
      repairDraftContractFn: repair,
      enforceDraftCommitSafetyFn: () => true,
      transitionTaskFn: async () => { throw new Error('must not transition to ready'); },
      transitionVirtualFn: async () => { throw new Error('must not transition to ready'); },
    },
  };
}

function draftAdapter(record: { logs: string[]; errors: string[]; exits: number[] }) {
  return createDraftWorkflowAdapter({
    exitFn: ((code?: number) => { record.exits.push(code ?? 0); }),
    logFn: (line: string) => record.logs.push(line),
    errorFn: (line: string) => record.errors.push(line),
  });
}

test('a contract the agent never completes fails after the bounded budget, naming what is missing', async () => {
  const record = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
  let repairs = 0;
  const refusal = 'Cannot refine task-x: its mission contract is incomplete. Missing at least one verification gate (`px gate add`).';
  await quietly(async () => draftAdapter(record).finalTransition(draftContext(
    async () => ({ status: 'failed', durableEvidence: [], error: { kind: 'validation', message: refusal } }),
    async () => { repairs += 1; return true; },
  )));

  assert.equal(repairs, DRAFT_CONTRACT_REPAIR_ATTEMPTS);
  assert.deepEqual(record.exits, [1]);
  assert.ok(record.errors.some((line) => line.includes('px gate add')), 'the failure names the missing part');
  const repair = record.logs.find((line) => line.startsWith('Repair:')) ?? '';
  assert.doesNotMatch(repair, /database/);
  assert.match(repair, /px status task-x/);
});

test('an infrastructure failure at refine is not sent to the agent and keeps the database repair', async () => {
  const record = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
  let repairs = 0;
  await quietly(async () => draftAdapter(record).finalTransition(draftContext(
    async () => ({ status: 'failed', durableEvidence: [], error: { kind: 'execution', message: 'database is locked' } }),
    async () => { repairs += 1; return true; },
  )));

  assert.equal(repairs, 0);
  assert.deepEqual(record.exits, [1]);
  assert.ok(record.logs.some((line) => /operator-local database is reachable/.test(line)));
});

// --- the draft prompt states exactly what refine enforces ------------------------------

test('the draft prompt marks as required exactly the parts refine refuses without', () => {
  const bare = fixtureMission('task-x', {
    id: missionId('task-x'), repositoryId: repositoryId('parallix'), title: 't',
    labels: missionLabels(['ai_sdlc', 'bug']), status: 'backlog', rawStatus: 'backlog', closedAt: null, assignee: null,
    checkpoints: [], brief: null, declaredGates: [], successCriteria: [], predictedNelBucket: null,
    reproductionTest: null, review: null, netEngineeringLines: null,
  });
  let refusal = '';
  try { decideMission(bare, { type: 'refine' }); } catch (error) { refusal = (error as Error).message; }
  const enforced = new Set([...refusal.matchAll(/`(px [a-z]+ [a-z]+)`/g)].map((match) => match[1]));

  const prompt = fs.readFileSync(path.join(REPO_ROOT, 'prompts', 'draft-core.md'), 'utf8');
  const rows = prompt.split('\n').filter((line) => /^\| [A-Z]/.test(line) && !line.startsWith('| Part'));
  const required = new Set<string>();
  const optional = new Set<string>();
  for (const row of rows) {
    const [, , command, requirement] = row.split(/(?<!\\)\|/).map((cell) => cell.trim());
    const verb = /^`(px [a-z]+ [a-z]+)/.exec(command)?.[1];
    if (!verb) { continue; }
    (requirement.startsWith('required') ? required : optional).add(verb);
  }

  assert.ok(enforced.size >= 6, `refine names the commands for what is missing: ${refusal}`);
  assert.deepEqual([...required].sort(), [...enforced].sort());
  assert.ok(!optional.has('px scope set') && optional.has('px depends add'));
  assert.match(prompt, /never end your turn while a `px` command is still running/);
  assert.doesNotMatch(prompt, /record a concrete, non-generic goal, rationale, scope, out-of-scope/);
});

// --- pre-draft hook ------------------------------------------------------------------

function withWorktree<T>(config: unknown, run: (_dir: string) => T): T {
  const dir = registeredMkdtemp('pre-draft-hook-');
  try {
    fs.writeFileSync(path.join(dir, 'workflow.config.json'), JSON.stringify(config));
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('adapters.draft.preDraftCommand is validated as a string', () => {
  assert.ok(validateWorkflowConfig({ adapters: { draft: { preDraftCommand: 7 } } })
    .includes('adapters.draft.preDraftCommand must be a string'));
  assert.deepEqual(validateWorkflowConfig({ adapters: { draft: { preDraftCommand: 'npm ci' } } }), []);
});

test('the pre-draft hook runs its command in the worktree with the mission slug, and is a no-op when unset', () => {
  withWorktree({ adapters: { draft: { preDraftCommand: 'npm ci' } } }, (dir) => {
    const runs: { cmd: string; args: string[]; options: Parameters<NonNullable<Parameters<typeof runPreDraftHook>[0]['runFn']>>[2] }[] = [];
    const ticks = [1000, 3450];
    const logs: string[] = [];
    const result = runPreDraftHook({
      slug: 'task-x', worktree: dir,
      runFn: (cmd, args, options) => { runs.push({ cmd, args, options }); return { signal: null,  status: 0, stdout: 'Progress: resolved 3, reused 3, downloaded 0, added 3, done', stderr: '' }; },
      nowFn: () => ticks.shift() as number, logFn: (line) => logs.push(line),
    });
    assert.deepEqual(result, { ran: true, ok: true, command: 'npm ci', output: 'Progress: resolved 3, reused 3, downloaded 0, added 3, done', exitCode: 0, durationMs: 2450, storeState: 'warm' });
    assert.deepEqual(logs, [
      'pre-draft hook start: slug=task-x command=`npm ci`',
      'pre-draft hook end: exit=0 duration=2450ms store=warm',
    ]);
    assert.deepEqual([runs[0].cmd, ...runs[0].args], ['bash', '-lc', 'npm ci']);
    assert.equal(runs[0].options.cwd, dir);
    const env = runs[0].options.env;
    assert.ok(env && typeof env === 'object' && 'PRE_DRAFT_HOOK_SLUG' in env);
    assert.equal(env.PRE_DRAFT_HOOK_SLUG, 'task-x');
  });
  withWorktree({ adapters: { draft: { preDraftCommand: '  ' } } }, (dir) => {
    assert.deepEqual(runPreDraftHook({ slug: 'task-x', worktree: dir }), { ran: false, ok: true });
  });
});

test('the hook times itself with a monotonic clock and probes the store by default (TASK-2707)', () => {
  withWorktree({ adapters: { draft: { preDraftCommand: 'true' } } }, (dir) => {
    const result = runPreDraftHook({ slug: 'task-x', worktree: dir, runFn: () => ({ signal: null,  status: 0, stdout: '', stderr: '' }) });
    assert.equal(result.ok, true);
    assert.ok(typeof result.durationMs === 'number' && result.durationMs >= 0);
    assert.equal(result.storeState, 'unknown');
  });
});

test('a failing pre-draft hook reports its exit code and a bounded output tail (TASK-2707)', () => {
  withWorktree({ adapters: { draft: { preDraftCommand: 'pnpm install' } } }, (dir) => {
    const logs: string[] = [];
    const big = `${'x'.repeat(10_000)}\nERR_PNPM_LOCKFILE_MISSING`;
    const result = runPreDraftHook({
      slug: 'task-x', worktree: dir, logFn: (line) => logs.push(line),
      runFn: () => ({ signal: null,  status: 1, stdout: 'Progress: resolved 3, reused 0, downloaded 3, added 1', stderr: big }),
      nowFn: (() => { let t = 0; return () => (t += 5); })(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.durationMs, 5);
    assert.equal(result.storeState, 'cold');
    assert.ok(result.failureTail && result.failureTail.length <= 2048 && result.failureTail.endsWith('ERR_PNPM_LOCKFILE_MISSING'));
    assert.equal(logs[1], 'pre-draft hook end: exit=1 duration=5ms store=cold');
  });
});

test('the hook reads cold or warm store state from the installer summary (TASK-2707)', () => {
  assert.equal(storeStateFromOutput('Progress: resolved 326, reused 0, downloaded 326, added 326, done'), 'cold');
  assert.equal(storeStateFromOutput('Progress: resolved 326, reused 326, downloaded 0, added 326, done'), 'warm');
  assert.equal(storeStateFromOutput('Progress: resolved 9, reused 1, downloaded 8, added 9\nProgress: resolved 9, reused 9, downloaded 0, added 9, done'), 'warm', 'the final summary decides');
  assert.equal(storeStateFromOutput('added 1 package'), 'unknown');
});

test('a successful pre-draft hook reports checkout and install timing in the default draft output (TASK-2707)', () => {
  const record = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
  const adapter = createDraftWorkflowAdapter({
    exitFn: ((code?: number) => { record.exits.push(code ?? 0); }),
    logFn: (line: string) => record.logs.push(line),
    errorFn: (line: string) => record.errors.push(line),
  });
  const ctx: DraftWorkflowContext = {
    ...draftContext(async () => { throw new Error('Unexpected transition'); }, async () => true),
    options: {
      ensureMissionBranchFn: () => undefined,
      ensureWorktreeFn: () => undefined,
      conventionalWorktreePathFn: () => '/repo-task-x',
      runPreDraftHookFn: () => ({ ran: true, ok: true as const, command: 'pnpm install', exitCode: 0, durationMs: 812, storeState: 'warm' }),
      ensureGraphifyWorkspaceFn: () => undefined,
      ensureGraphifyIgnoreFn: () => undefined,
    },
  };
  adapter.setup(ctx);
  assert.deepEqual(record.exits, []);
  assert.ok(record.logs.some((line) => /^Worktree checkout \d+ms; install hook 812ms \(store warm\)\.$/.test(line)), 'timing is visible with debug off');
});

test('a failing pre-draft hook stops the draft at setup as an environment failure', () => {
  const record = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
  const steps: string[] = [];
  const adapter = draftAdapter(record);
  const ctx: DraftWorkflowContext = {
    ...draftContext(async () => { throw new Error('Unexpected transition'); }, async () => true),
    options: {
      ensureMissionBranchFn: () => steps.push('branch'),
      ensureWorktreeFn: () => steps.push('worktree'),
      conventionalWorktreePathFn: () => '/repo-task-x',
      runPreDraftHookFn: () => { steps.push('hook'); return { ran: true, ok: false as const, command: 'npm ci', output: 'npm ERR! missing lockfile', exitCode: 1 }; },
      ensureGraphifyWorkspaceFn: () => steps.push('graphify'),
      ensureGraphifyIgnoreFn: () => steps.push('graphify-ignore'),
    },
  };

  const next = adapter.setup(ctx);

  assert.equal(next.exited, true);
  assert.deepEqual(steps, ['branch', 'worktree', 'hook'], 'the hook runs once the worktree exists and nothing runs after it');
  assert.deepEqual(record.exits, [1]);
  assert.ok(record.errors.some((line) => /Environment failure: the pre-draft hook `npm ci` exited with status 1/.test(line)));
  assert.ok(record.errors.includes('npm ERR! missing lockfile'));
});

test('generated config carries the pre-draft hook entry and Parallix installs dependencies through it', () => {
  const generated = buildWorkflowConfig({}) as { adapters: { draft?: { preDraftCommand?: unknown } } };
  assert.equal(generated.adapters.draft?.preDraftCommand, '');
  const own = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'workflow.config.json'), 'utf8'));
  // TASK-2714: the draft hook is the mission's one successful dependency install, so
  // it goes through the identity-aware wrapper that records it. ADR 0063 still owns
  // the command itself: pnpm, frozen lockfile, prefer-offline.
  assert.equal(own.adapters.draft.preDraftCommand, './scripts/px-install.sh');
  const wrapper = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'px-install.sh'), 'utf8');
  assert.match(wrapper, /dependency-identity\.mjs\" ensure/);
  const identity = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'dependency-identity.mjs'), 'utf8');
  assert.match(identity, /INSTALL_ARGS = \['install', '--frozen-lockfile', '--prefer-offline'\]/);
});

// --- handoff PR step area ----------------------------------------------------------------

test('the handoff Forgejo PR step gates the push on the mission area', async () => {
  const recorder = makeRecorder();
  const areas: unknown[] = [];
  const base = makePorts(recorder);
  const ports = makePorts(recorder, {
    productConfig: { isForgejoReviewEnabled: () => true },
    verification: { ...base.verification, resolveEffectiveArea: () => 'docs' },
    forgejo: { ...base.forgejo, createPr: (_b: string, _u: string, _t: string, options: Parameters<HandoffWorkflowPorts['forgejo']['createPr']>[3]) => { areas.push(options.verificationArea); return { ok: true as const }; } },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.deepEqual(areas, ['docs']);
});

test('a non-gate rebase failure before handoff keeps the rebase message', async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    rebase: { rebaseBeforeReviewRound: async () => ({ ok: false as const, sharedFileConflicts: false, hookFailure: false, failure: { kind: 'other', operation: 'rebase', output: 'exit 1' } }) },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.match(result.error ?? '', /Rebase failed before handoff/);
  assert.equal(result.gateFailure, undefined);
});

// --- integration re-review routes --------------------------------------------------------

function gateStep(route: IntegrationGateRoute, gateResult: NonNullable<Parameters<typeof phaseGateResult>[0]> = { ok: false, error: 'failed', failedGate: { key: 'quality-gate' } }) {
  return createIntegrationGateStep(stubIntegrateWorkflowPorts({
    gates: {
      resolveIntegrationVerificationWorktree: () => '/wt',
      captureFinalIntegrationTree: () => ({ ok: true as const, rootDir: '/wt', commit: 'c', tree: 't' }),
      loadPhaseGates: () => [{ key: 'quality-gate', command: 'npm run quality', order: 1 }],
      loadRequirePreIntegration: () => true,
      runPhaseGates: async () => phaseGateResult(gateResult),
      routeIntegrationGateFailure: async () => route,
    },
    landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }), isAbort: () => true },
    verification: { formatVerificationCommand: () => './scripts/verify-local.sh all' },
  }));
}

test('operator cancellation aborts integration without sending a gate failure to repair', async () => {
  const request = gateRequest({ route: 'unused' });
  request.seams.routeIntegrationGateFailureFn = async () => { throw new Error('must not route cancellation'); };
  await assert.rejects(quietly(() => gateStep({ route: 'unused' }, { ok: false, cancelled: true, error: 'cancelled', failedGate: { key: 'quality-gate' } }).runRequiredLocalGates(request)),
    { name: 'IntegrationAbort' });
});

function gateRequest(route: IntegrationGateRoute, reReviewFn?: () => Promise<boolean>): GateStepRequest {
  return {
    slug: 'task-x', context: integrationContext({ baseWorktree: '/repo', area: 'all', branch: 'mission/task-x' }),
    missionServices: integrationServices(),
    missionLoad: { kind: 'found', mission: fixtureMission('task-x', { repositoryId: repositoryId('parallix') }), version: missionVersion(1) },
    dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
    seams: {
      startAgentFn: async () => { throw new Error('Unexpected transition'); }, transitionTaskFn: () => true, applyAgentFallbackFn: async () => 'codex',
      routeIntegrationGateFailureFn: async () => route,
      ...(reReviewFn ? { reReviewFn } : {}),
    },
  };
}

test('a re-review that does not approve the repaired revision aborts before merge', async () => {
  const route = { route: 'revision-changed', repairedRevision: 't2', invalidation: { ok: true, dismissed: [], errors: [] } };
  await assert.rejects(quietly(() => gateStep(route).runRequiredLocalGates(gateRequest(route, async () => false))), { name: 'IntegrationAbort' });
});

test('an approval that could not be retracted is never re-reviewed automatically', async () => {
  const route = { route: 'revision-changed', repairedRevision: 't2', invalidation: { ok: false, dismissed: [], errors: [] } };
  let reviewed = false;
  await assert.rejects(quietly(() => gateStep(route).runRequiredLocalGates(gateRequest(route, async () => { reviewed = true; return true; }))), { name: 'IntegrationAbort' });
  assert.equal(reviewed, false);
});

// --- px status ------------------------------------------------------------------------

test('a PR lookup with a direct base/head hit reads no page of pull requests', () => {
  const calls: string[] = [];
  const pr = getPrStatus('mission/task-2547', '/tmp', {
    token: 't',
    apiCall: forgejoApiFixture((_method: string, apiPath: string) => {
      calls.push(apiPath);
      if (apiPath.endsWith('/mission/task-2547')) { return { ok: true as const, data: { number: 479, state: 'open' } }; }
      if (apiPath === '/pulls/479') { return { ok: true as const, data: { number: 479, title: 'x', state: 'open', html_url: 'u' } }; }
      return { ok: false as const, statusCode: 500 };
    }),
  });
  assert.equal(pr.number, 479);
  assert.ok(!calls.some((call) => call.startsWith('/pulls?')), calls.join(', '));
});

test('a branch with no PR scans only the open pull requests, never every closed one', () => {
  const calls: string[] = [];
  const pr = getPrStatus('mission/task-2561', '/tmp', {
    token: 't',
    apiCall: forgejoApiFixture((_method: string, apiPath: string) => {
      calls.push(apiPath);
      if (apiPath.startsWith('/pulls?state=open')) { return { ok: true as const, data: [] }; }
      return { ok: false as const, statusCode: 404 };
    }),
  });
  assert.equal(pr.exists, false);
  assert.ok(!calls.some((call) => call.includes('state=all')), calls.join(', '));
});

test('the status agent view reports configured families with their database blocks, and unknown without a database', async () => {
  const blocklist: AgentBlocklistRepository = {
    async findAll() { return [{ agent: 'qwen', blocked: true, reason: 'quota', until: undefined }]; },
    async findByAgent() { return undefined; },
    async save() {}, async deleteByAgent() {}, async clear() {},
  };
  const families = [agentFamily('codex'), agentFamily('qwen')];
  const agents = await createStatusAgentAdapter({ rootDir: REPO_ROOT, blocklistRepo: blocklist, knownAgentFamilies: families }).getAgents();
  assert.deepEqual(agents?.map((entry) => [entry.agent, entry.block.kind]), [['codex', 'none'], ['qwen', 'indefinite']]);
  assert.equal(await createStatusAgentAdapter({ rootDir: REPO_ROOT, blocklistRepo: null, knownAgentFamilies: families }).getAgents(), null);
});

// --- px gate add refuses what handoff would refuse ------------------------------------

test('px gate add refuses a gate the validator rejects and writes nothing', async () => {
  const writes: unknown[] = [];
  const services: Parameters<typeof createGateCommand>[0] = {
    resolveSlug: () => 'task-x',
    brief: {
      readGates: async () => ({ status: 'completed', durableEvidence: [], value: { declaredGates: [], version: missionVersion(1) } }),
      setGates: async (request: unknown) => { writes.push(request); return { status: 'completed', durableEvidence: [], value: { declaredGates: ['npm test'], version: missionVersion(2) } }; },
    },
  };
  const command = createGateCommand(services, (gate) => (gate.includes('#') ? 'Gate declaration must contain an exact runnable command only.' : null));

  await assert.rejects(command(['add', '--slug', 'task-x', '--command', 'npm test # all of it', '--expected-version', '1']), /exact runnable command only/);
  assert.deepEqual(writes, []);
  await quietly(async () => { await command(['add', '--slug', 'task-x', '--command', 'npm test', '--expected-version', '1']); });
  assert.equal(writes.length, 1);
});


test('draft completion refuses unknown until the agent classifies the mission (TASK-2731)', () => {
  const mission = fixtureMission('task-classify', {
    status: 'backlog', labels: missionLabels(['unknown']),
    brief: { goal: 'Fix greeting', why: 'Typo', scope: 'hello.sh', outOfScope: [] },
    successCriteria: ['hello.sh prints hello'], declaredGates: ['npm test'], predictedNelBucket: 'Small',
  });
  assert.throws(() => decideMission(mission, { type: 'refine' }), /Cannot refine with unknown classification/);
  assert.equal(mission.status, 'backlog');
  for (const classification of ['ai_sdlc', 'user_value']) {
    assert.equal(decideMission({ ...mission, labels: missionLabels([classification]) }, { type: 'refine' }).status, 'refined');
    assert.equal(normalizeDraftClassification('task-classify', '/unused', {
      resolveMissionClassificationFn: () => ({ classification, taskFile: null, source: 'mission' }),
    }).ok, true);
  }
  assert.equal(normalizeDraftClassification('task-classify', '/unused', {
    resolveMissionClassificationFn: () => ({ classification: 'unknown', taskFile: null, source: 'mission' }),
  }).ok, false);
  assert.match(buildRestartPrompt('task-classify'), /unknown must be resolved before draft completion/);
});


test('post-draft stored unknown triggers agent repair and is checked again (TASK-2731)', async () => {
  for (const repaired of [false, true]) {
    let classification = 'unknown'; let restarts = 0;
    const record = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
    const base = draftContext(async () => { throw new Error('Unexpected transition'); }, async () => true);
    const ctx: DraftWorkflowContext = {
      ...base,
      missionServicesFn: async () => draftMissionServicesFixture({ store: { load: async () => ({ kind: 'found', mission: fixtureMission('task-x', { labels: missionLabels([classification]) }), version: missionVersion(1) }) } }),
      options: { ...base.options, restartDraftAgentFn: async () => { restarts++; if (repaired) classification = 'user_value'; return true; } },
    };
    const result = await quietly(async () => draftAdapter(record).postProcess(ctx));
    assert.equal(restarts, 1);
    assert.equal(Boolean(result.exited), !repaired);
    assert.deepEqual(record.exits, repaired ? [] : [1]);
  }
});
