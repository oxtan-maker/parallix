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
import { createDraftWorkflowAdapter, DRAFT_CONTRACT_REPAIR_ATTEMPTS } from '../src/adapters/cli/commands/draft-stats.js';
import { decideMission } from '../src/domain/mission-workflow.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { validateWorkflowConfig } from '../src/adapters/config/product-config.js';
import { runPreDraftHook } from '../src/adapters/process/pre-draft-hook.js';
import { buildWorkflowConfig } from '../src/adapters/review/setup-review-config.js';
import { HandoffCommandUseCase } from '../src/application/handoff-command-use-case.js';
import { createIntegrationGateStep } from '../src/application/integrate/gates.js';
import { setLogger } from '../src/application/presentation/cli-format.js';
import { getPrStatus } from '../src/adapters/forgejo/forgejo.js';
import { createStatusAgentAdapter } from '../src/adapters/cli/commands/status-adapter.js';
import type { DraftWorkflowContext } from '../src/application/ports/cli-workflows.js';
import type { IntegrateWorkflowPorts } from '../src/application/ports/integrate-workflow.js';
import type { AgentBlocklistRepository } from '../src/application/ports/agent-blocklist.js';
import { agentFamily } from '../src/domain/agents.js';
import { createGateCommand } from '../src/interfaces/cli/mission-writes.js';
import { SLUG, makePorts, makeRecorder, runOptions } from './helpers/handoff-ports.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function quietly<T>(run: () => Promise<T>): Promise<T> {
  const previous = setLogger({ log: () => {} });
  return run().finally(() => setLogger(previous));
}

// --- draft bounce-back budget -------------------------------------------------------

function draftContext(transition: () => Promise<unknown>, repair: () => Promise<boolean>) {
  return {
    exited: false, slug: 'task-x', mainRepo: '/repo', targetWorktree: '/repo-task-x',
    missionFile: '/repo-task-x/missions/task-x/MISSION.md', recordedBase: null, syntheticTask: null,
    agent: 'codex', actualAgent: 'codex', agentResult: null,
    exitFn: () => { throw new Error('unused'); }, logFn: () => {}, errorFn: () => {},
    missionServicesFn: async () => ({ lifecycle: { transition }, store: { async load() { return { kind: 'missing' }; } } }),
    options: {
      repairDraftContractFn: repair,
      enforceDraftCommitSafetyFn: () => true,
      transitionTaskFn: async () => { throw new Error('must not transition to ready'); },
      transitionVirtualFn: async () => { throw new Error('must not transition to ready'); },
    },
  } as unknown as DraftWorkflowContext;
}

function draftAdapter(record: { logs: string[]; errors: string[]; exits: number[] }) {
  return createDraftWorkflowAdapter({
    exitFn: ((code?: number) => { record.exits.push(code ?? 0); }) as never,
    logFn: (line: string) => record.logs.push(line),
    errorFn: (line: string) => record.errors.push(line),
  } as never);
}

test('a contract the agent never completes fails after the bounded budget, naming what is missing', async () => {
  const record = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
  let repairs = 0;
  const refusal = 'Cannot refine task-x: its mission contract is incomplete. Missing at least one verification gate (`px gate add`).';
  await quietly(async () => draftAdapter(record).finalTransition(draftContext(
    async () => ({ status: 'failed', error: { kind: 'validation', message: refusal } }),
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
    async () => ({ status: 'failed', error: { kind: 'execution', message: 'database is locked' } }),
    async () => { repairs += 1; return true; },
  )));

  assert.equal(repairs, 0);
  assert.deepEqual(record.exits, [1]);
  assert.ok(record.logs.some((line) => /operator-local database is reachable/.test(line)));
});

// --- the draft prompt states exactly what refine enforces ------------------------------

test('the draft prompt marks as required exactly the parts refine refuses without', () => {
  const bare = {
    id: missionId('task-x'), repositoryId: repositoryId('parallix'), title: 't',
    labels: missionLabels(['ai_sdlc', 'bug']), status: 'backlog', rawStatus: 'backlog', closedAt: null, assignee: null,
    checkpoints: [], brief: null, declaredGates: [], successCriteria: [], predictedNelBucket: null,
    reproductionTest: null, review: null, netEngineeringLines: null,
  } as unknown as Mission;
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
    const runs: { cmd: string; args: string[]; options: Record<string, any> }[] = [];
    const result = runPreDraftHook({
      slug: 'task-x', worktree: dir,
      runFn: (cmd, args, options) => { runs.push({ cmd, args, options }); return { status: 0, stdout: 'added 1 package', stderr: '' }; },
    });
    assert.deepEqual(result, { ran: true, ok: true, command: 'npm ci', output: 'added 1 package', exitCode: 0 });
    assert.deepEqual([runs[0].cmd, ...runs[0].args], ['bash', '-lc', 'npm ci']);
    assert.equal(runs[0].options.cwd, dir);
    assert.equal(runs[0].options.env.PRE_DRAFT_HOOK_SLUG, 'task-x');
  });
  withWorktree({ adapters: { draft: { preDraftCommand: '  ' } } }, (dir) => {
    assert.deepEqual(runPreDraftHook({ slug: 'task-x', worktree: dir }), { ran: false, ok: true });
  });
});

test('a failing pre-draft hook stops the draft at setup as an environment failure', () => {
  const record = { logs: [] as string[], errors: [] as string[], exits: [] as number[] };
  const steps: string[] = [];
  const adapter = draftAdapter(record);
  const ctx = {
    ...draftContext(async () => ({}), async () => true),
    options: {
      ensureMissionBranchFn: () => steps.push('branch'),
      ensureWorktreeFn: () => steps.push('worktree'),
      conventionalWorktreePathFn: () => '/repo-task-x',
      runPreDraftHookFn: () => { steps.push('hook'); return { ran: true, ok: false, command: 'npm ci', output: 'npm ERR! missing lockfile', exitCode: 1 }; },
      ensureGraphifyWorkspaceFn: () => steps.push('graphify'),
      ensureGraphifyIgnoreFn: () => steps.push('graphify-ignore'),
    },
  } as unknown as DraftWorkflowContext;

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
  assert.match(own.adapters.draft.preDraftCommand, /^npm ci\b/);
});

// --- handoff PR step area ----------------------------------------------------------------

test('the handoff Forgejo PR step gates the push on the mission area', async () => {
  const recorder = makeRecorder();
  const areas: unknown[] = [];
  const base = makePorts(recorder);
  const ports = makePorts(recorder, {
    productConfig: { isForgejoReviewEnabled: () => true },
    missionUtils: { ...base.missionUtils, findMissionArea: () => 'docs' },
    forgejo: { ...base.forgejo, createPr: (_b: string, _u: string, _t: string, options: Record<string, unknown>) => { areas.push(options.verificationArea); return { ok: true }; } },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.deepEqual(areas, ['docs']);
});

test('a non-gate rebase failure before handoff keeps the rebase message', async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    rebase: { rebaseBeforeReviewRound: async () => ({ ok: false, sharedFileConflicts: false, hookFailure: false, failure: { kind: 'other', operation: 'rebase', output: 'exit 1' } }) },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.match(result.error ?? '', /Rebase failed before handoff/);
  assert.equal(result.gateFailure, undefined);
});

// --- integration re-review routes --------------------------------------------------------

function gateStep(route: Record<string, unknown>, gateResult: { ok: boolean; error: string; failedGate: { key: string }; cancelled?: boolean } = { ok: false, error: 'failed', failedGate: { key: 'quality-gate' } }) {
  return createIntegrationGateStep({
    gates: {
      resolveIntegrationVerificationWorktree: () => '/wt',
      captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/wt', commit: 'c', tree: 't' }),
      loadPhaseGates: () => [{ key: 'quality-gate', command: 'npm run quality', order: 1 }],
      loadRequirePreIntegration: () => true,
      runPhaseGates: async () => gateResult,
      routeIntegrationGateFailure: async () => route,
    },
    landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }), isAbort: () => true },
    verification: { formatVerificationCommand: () => './scripts/verify-local.sh all' },
  } as unknown as IntegrateWorkflowPorts);
}

test('operator cancellation aborts integration without sending a gate failure to repair', async () => {
  const request = gateRequest({}) as unknown as { seams: { routeIntegrationGateFailureFn: () => Promise<never> } };
  request.seams.routeIntegrationGateFailureFn = async () => { throw new Error('must not route cancellation'); };
  await assert.rejects(quietly(() => gateStep({}, { ok: false, cancelled: true, error: 'cancelled', failedGate: { key: 'quality-gate' } }).runRequiredLocalGates(request as never)),
    { name: 'IntegrationAbort' });
});

function gateRequest(route: Record<string, unknown>, reReviewFn?: () => Promise<boolean>) {
  return {
    slug: 'task-x', context: { baseWorktree: '/repo', area: 'all', branch: 'mission/task-x' },
    missionLoad: { kind: 'found', mission: { repositoryId: 'parallix' } },
    dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
    seams: {
      startAgentFn: async () => ({}), transitionTaskFn: () => true, applyAgentFallbackFn: async () => 'codex',
      routeIntegrationGateFailureFn: async () => route,
      ...(reReviewFn ? { reReviewFn } : {}),
    },
  } as never;
}

test('a re-review that does not approve the repaired revision aborts before merge', async () => {
  const route = { route: 'revision-changed', repairedRevision: 't2', invalidation: { ok: true } };
  await assert.rejects(quietly(() => gateStep(route).runRequiredLocalGates(gateRequest(route, async () => false))), { name: 'IntegrationAbort' });
});

test('an approval that could not be retracted is never re-reviewed automatically', async () => {
  const route = { route: 'revision-changed', repairedRevision: 't2', invalidation: { ok: false } };
  let reviewed = false;
  await assert.rejects(quietly(() => gateStep(route).runRequiredLocalGates(gateRequest(route, async () => { reviewed = true; return true; }))), { name: 'IntegrationAbort' });
  assert.equal(reviewed, false);
});

// --- px status ------------------------------------------------------------------------

test('a PR lookup with a direct base/head hit reads no page of pull requests', () => {
  const calls: string[] = [];
  const pr = getPrStatus('mission/task-2547', '/tmp', {
    token: 't',
    apiCall: (_method: string, apiPath: string) => {
      calls.push(apiPath);
      if (apiPath.endsWith('/mission/task-2547')) { return { ok: true, data: { number: 479, state: 'open' } }; }
      if (apiPath === '/pulls/479') { return { ok: true, data: { number: 479, title: 'x', state: 'open', html_url: 'u' } }; }
      return { ok: false, statusCode: 500 };
    },
  });
  assert.equal(pr.number, 479);
  assert.ok(!calls.some((call) => call.startsWith('/pulls?')), calls.join(', '));
});

test('a branch with no PR scans only the open pull requests, never every closed one', () => {
  const calls: string[] = [];
  const pr = getPrStatus('mission/task-2561', '/tmp', {
    token: 't',
    apiCall: (_method: string, apiPath: string) => {
      calls.push(apiPath);
      if (apiPath.startsWith('/pulls?state=open')) { return { ok: true, data: [] }; }
      return { ok: false, statusCode: 404 };
    },
  });
  assert.equal(pr.exists, false);
  assert.ok(!calls.some((call) => call.includes('state=all')), calls.join(', '));
});

test('the status agent view reports configured families with their database blocks, and unknown without a database', async () => {
  const blocklist = {
    async findAll() { return [{ agent: 'qwen', blocked: true, reason: 'quota', until: null }]; },
    async findByAgent() { return undefined; },
    async save() {}, async deleteByAgent() {}, async clear() {},
  } as unknown as AgentBlocklistRepository;
  const families = [agentFamily('codex'), agentFamily('qwen')];
  const agents = await createStatusAgentAdapter({ rootDir: REPO_ROOT, blocklistRepo: blocklist, knownAgentFamilies: families }).getAgents();
  assert.deepEqual(agents?.map((entry) => [entry.agent, entry.block.kind]), [['codex', 'none'], ['qwen', 'indefinite']]);
  assert.equal(await createStatusAgentAdapter({ rootDir: REPO_ROOT, blocklistRepo: null, knownAgentFamilies: families }).getAgents(), null);
});

// --- px gate add refuses what handoff would refuse ------------------------------------

test('px gate add refuses a gate the validator rejects and writes nothing', async () => {
  const writes: unknown[] = [];
  const services = {
    resolveSlug: () => 'task-x',
    brief: {
      readGates: async () => ({ status: 'completed', value: { declaredGates: [] } }),
      setGates: async (request: unknown) => { writes.push(request); return { status: 'completed', value: { version: 2 } }; },
    },
  } as never;
  const command = createGateCommand(services, (gate) => (gate.includes('#') ? 'Gate declaration must contain an exact runnable command only.' : null));

  await assert.rejects(command(['add', '--slug', 'task-x', '--command', 'npm test # all of it', '--expected-version', '1']), /exact runnable command only/);
  assert.deepEqual(writes, []);
  await quietly(async () => { await command(['add', '--slug', 'task-x', '--command', 'npm test', '--expected-version', '1']); });
  assert.equal(writes.length, 1);
});
