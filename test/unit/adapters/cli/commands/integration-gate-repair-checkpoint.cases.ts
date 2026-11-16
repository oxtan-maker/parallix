import assert from 'node:assert/strict';
import test from 'node:test';
import { rebound } from '../../../../../src/application/rebound-kernel.js';
import type { routeIntegrationGateFailure } from '../../../../../src/adapters/cli/commands/integrate-gate-rebound.js';
import { fixtureMission, approvedReview, inMemoryTransitionStore } from '../../../../fixtures/mission-builders.js';
import { integrationContext } from '../../../../fixtures/integration-context.js';
import { integrationServices } from '../../../../helpers/stub-integration-services.js';
import { stubIntegrateWorkflowPorts } from '../../../../helpers/stub-integrate-workflow-ports.js';
import { phaseGateResult } from '../../../../helpers/phase-gate-result.js';
import { MissionLifecycleService } from '../../../../../src/application/mission-lifecycle-service.js';
import { RepairCheckpointService } from '../../../../../src/application/repair-checkpoint-service.js';
import { agentFamily } from '../../../../../src/domain/agents.js';
import { missionVersion } from '../../../../../src/application/domain-ports.js';
import fs from 'node:fs';
import { mkdtemp } from '../../../../helpers/temp-dir.js';

/** Cases executed by the integration gate rebound contract; all boundaries doubled. */
export function integrationGateCheckpointCases(route: typeof routeIntegrationGateFailure): void {
  for (const taskAssignee of [null, 'custom']) {
    test(`integration gate repair retains the recorded implementer with ${taskAssignee ? 'a stale' : 'no'} Backlog assignee (px-0021)`, async () => {
      const { createIntegrationGateStep } = await import('../../../../../src/application/integrate/gates.js');
      const slug = 'px-0099';
      const store = inMemoryTransitionStore(fixtureMission(slug, {
        status: 'integration', assignee: agentFamily('codex'), review: approvedReview(slug),
      }));
      const tree = { ok: true as const, rootDir: '/fixture/mission', commit: 'approved', tree: 'approved' };
      const launches: string[] = [];
      let selections = 0;
      const { runRequiredLocalGates } = createIntegrationGateStep(stubIntegrateWorkflowPorts({
        gates: {
          resolveIntegrationVerificationWorktree: () => tree.rootDir,
          captureFinalIntegrationTree: () => tree,
          loadPhaseGates: () => [{ key: 'verification', command: 'false', order: 1 }],
          loadRequirePreIntegration: () => true,
          runPhaseGates: async () => phaseGateResult({ failedGate: { key: 'verification' }, error: 'fixture gate failed' }),
        },
        landing: { createAbort: () => new Error('fixture abort') },
        verification: { formatVerificationCommand: () => 'false' },
      }));
      await assert.rejects(() => runRequiredLocalGates({
        slug, context: integrationContext({ slug, taskAssignee, approval: { ok: true, providerDisabled: true } }),
        missionLoad: { kind: 'found', mission: fixtureMission(slug, { assignee: agentFamily('custom') }), version: missionVersion(1) },
        missionServices: integrationServices({ store, lifecycle: new MissionLifecycleService(store) }),
        dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
        seams: {
          selectAgentFn: () => { selections++; return 'custom'; },
          transitionTaskFn: () => true,
          applyAgentFallbackFn: async ({ original }) => original,
          startAgentFn: async (_step, options) => {
            launches.push(options.agent!);
            return { agent: options.agent, result: { status: 1 } };
          },
          routeIntegrationGateFailureFn: options => route({ ...options,
            captureFinalTreeFn: () => tree,
            reboundFn: (reason, context) => rebound(reason, { ...context, maxAttempts: 1, repairCheckpoints: {
              open: async () => ({ name: 'CP-2', version: 1 }),
              readBlocker: async () => undefined, verify: async () => {},
            } }), log() {}, error() {},
          }),
        },
      }), /fixture abort/);
      assert.deepEqual(launches, ['codex']);
      assert.equal(store.mission().assignee, 'codex', 'reactivation must not overwrite the chosen implementer');
      assert.equal(store.mission().review!.rounds.at(-1)!.implementer, 'codex');
      assert.equal(selections, 0, 'a recorded implementer does not need a new agent selection');
    });
  }

  test('squash-hook repair retains the database-only Mission implementer (px-0021)', async () => {
    const { createSquashLanding } = await import('../../../../../src/application/integrate/squash.js');
    const slug = 'px-0099';
    const store = inMemoryTransitionStore(fixtureMission(slug, {
      status: 'integration', assignee: agentFamily('codex'), review: approvedReview(slug),
    }));
    const launches: string[] = [];
    let selections = 0;
    const { squashAndLand } = createSquashLanding(stubIntegrateWorkflowPorts({
      git: { git: args => {
        if (args.includes('commit')) { return { status: 1, stdout: '', stderr: 'pre-commit: failed' }; }
        if (args.includes('diff')) { return { status: 0, stdout: args.includes('--cached') ? 'fixture.ts\0' : '', stderr: '' }; }
        if (args.includes('ls-files')) { return { status: 0, stdout: '', stderr: '' }; }
        return { status: 0, stdout: 'commit\n', stderr: '' };
      } },
      backlog: { checkBacklogIntegrity: () => [] }, fileSystem: { existsSync: () => false },
      missionPaths: { softResetTrailingBacklogNoise: () => false },
      gates: { isIntendedPayloadAtHead: () => false },
      landing: { classifyHookFailure: () => ({ isHookFailure: true, hookType: 'pre-commit' }), createAbort: () => new Error('fixture abort') },
    }), { promoteTaskForIntegrationIfNeeded: async () => {} });
    await assert.rejects(() => squashAndLand({
      slug, context: integrationContext({ slug }), missionServices: integrationServices({ store }),
      baseWorktree: '/base', baseBranch: 'main', state: { temporaryStash: null, nextActionMessage: null },
      seams: {
        selectAgentFn: () => { selections++; return 'custom'; },
        startAgentFn: async (_step, options) => {
          launches.push(options.agent!);
          return { agent: options.agent, result: { status: 1 } };
        },
        transitionTaskFn: () => true, applyAgentFallbackFn: async ({ original }) => original,
      },
    }, { branch: `mission/${slug}`, summary: 'fixture', landedFromSha: 'before', mainTaskFile: '' }), /fixture abort/);
    assert.ok(launches.length > 0);
    assert.ok(launches.every(agent => agent === 'codex'), JSON.stringify(launches));
    assert.equal(selections, 0);
    assert.equal(store.mission().assignee, 'codex');
  });

  test('integration repair uses recorded review identity when unassigned and preserves explicit replacement (px-0021)', async () => {
    const { resolveBounceImplementer } = await import('../../../../../src/application/integrate/support.js');
    const context = integrationContext({ taskAssignee: 'custom', reviewState: { implementer: 'custom' } });
    for (const assignee of [null, agentFamily('claude')]) {
      const store = inMemoryTransitionStore(fixtureMission('px-0099', { assignee, review: approvedReview('px-0099') }));
      assert.equal(await resolveBounceImplementer('px-0099', store, context, '/fixture', {
        selectAgentFn: () => { throw new Error('must retain recorded identity'); },
      }), assignee ?? 'codex');
    }
  });

  test('integration repair does not select a new family after an unreadable Mission with no known identity (px-0021)', async () => {
    const { resolveBounceImplementer } = await import('../../../../../src/application/integrate/support.js');
    await assert.rejects(() => resolveBounceImplementer('px-0099', {
      load: async () => { throw new Error('fixture database unavailable'); },
    }, integrationContext(), '/fixture', {
      selectAgentFn: () => { throw new Error('must not reselect'); },
    }), /fixture database unavailable/);
  });

  test('integration repair certifies the current failed command after unit becomes green (TASK-2750)', async () => {
    const unit = { key: 'unit', command: 'npm test', exitCode: 1, stdout: 'unit failed', stderr: '' };
    const integration = { ...unit, key: 'integration-ci', command: 'npm run test:integration:ci:prebuilt', stdout: 'integration failed' };
    const commands: string[] = [];
    const names = new Map<string, string>();
    const openedByName = new Map<string, { incidentId: string; gateKey?: string; command: string }>();
    let reruns = 0;
    const certified: string[] = [];
    const result = await route({
      slug: 'fixture', missionWorktree: '', failedGate: unit, gates: [
        { key: unit.key, command: unit.command, order: 0 },
        { key: integration.key, command: integration.command, order: 1 },
      ], implementer: 'codex', repositoryId: 'fixture',
      startAgentFn: async () => ({ result: { status: 0 } }), transitionTaskFn: async () => {},
      captureFinalTreeFn: () => ({ ok: true, rootDir: '', commit: 'unchanged', tree: 'tree' }),
      runPhaseGatesFn: async () => {
        reruns++;
        return { ok: reruns === 2, phase: 'integration', gates: [], executed: 2, skipped: false, dryRun: false,
          failedGate: reruns === 1 ? integration : null, failures: reruns === 1 ? [integration] : [], outcomes: [
            { ...unit, exitCode: 0, stdout: '', stderr: '' },
            { ...integration, ...(reruns === 2 ? { exitCode: 0, stdout: '', stderr: '' } : {}) },
          ], error: reruns === 1 ? 'integration failed' : null };
      },
      reboundFn: (reason, context) => rebound(reason, { ...context, repairCheckpoints: {
        open: async input => {
          commands.push(input.command);
          const identity = `${input.incidentId}:${input.gateKey ?? ''}`;
          const name = names.get(identity) ?? `CP-${names.size + 2}`;
          names.set(identity, name);
          openedByName.set(name, input);
          return { name, version: input.attempt };
        },
        readBlocker: async () => undefined,
        prepareVerification: async (_slug, name, scope) => {
          const opened = openedByName.get(name)!;
          return { missionId: 'fixture', command: opened.command, worktree: '', executionRevision: scope.executionRevision!,
            executionMissionRevision: 1, checkpointEvidenceRevision: 1, authorizedGates: [], authorizedCriteria: [],
            verifiedOccurrence: { checkpoint: name, incidentId: opened.incidentId, attempt: 1, openedMissionRevision: 1,
              worktree: '', failureRevision: 'unchanged', failureEvidenceId: name }, coveredOccurrences: [] };
        },
        verify: async (_slug, name) => { certified.push(name); },
        verifyAll: async (_slug, checks) => { certified.push(...checks.map(check => check.name)); },
      } }),
      log() {}, error() {},
    });
    assert.equal(result.route, 'fixed');
    assert.equal(result.rebounds, 2);
    assert.deepEqual(commands, [unit.command, unit.command, integration.command]);
    assert.deepEqual(certified, ['CP-2', 'CP-3']);
    assert.equal(reruns, 2);
  });

  test('one failed integration gate uses the per-gate checkpoint collection across retries (TASK-2857)', async t => {
    const worktree = mkdtemp('single-integration-repair-');
    t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
    const unit = { key: 'unit', command: 'npm test', exitCode: 1, stdout: 'unit failed in a.test.ts', stderr: '' };
    const opened: Array<{ incidentId: string; gateKey?: string; command: string; worktree?: string;
      failureRevision?: string | null; failureEvidenceId?: string }> = [];
    const attempts: Array<[string, number]> = [];
    const blockers: string[] = [];
    const names = new Map<string, string>();
    let launches = 0;
    let reruns = 0;
    let certifications = 0;
    const result = await route({
      slug: 'fixture', missionWorktree: worktree, failedGate: unit, testedRevision: 'tested-revision',
      gates: [{ key: unit.key, command: unit.command, order: 0 }], implementer: 'codex', repositoryId: 'fixture',
      startAgentFn: async () => { launches++; return { result: { status: 0 } }; },
      transitionTaskFn: async () => {},
      captureFinalTreeFn: () => ({ ok: true, rootDir: worktree, commit: 'tested-revision', tree: 'tree' }),
      runPhaseGatesFn: async () => {
        reruns++;
        return reruns === 1
          ? { ok: true, phase: 'integration', gates: [], executed: 0, skipped: false, dryRun: false,
            failedGate: null, failures: [], outcomes: [], error: null }
          : { ok: true, phase: 'integration', gates: [], executed: 1, skipped: false, dryRun: false,
            failedGate: null, failures: [], outcomes: [{ ...unit, exitCode: 0, stdout: '', stderr: '' }], error: null };
      },
      reboundFn: (reason, context) => rebound(reason, { ...context, repairCheckpoints: {
        open: async input => {
          opened.push(input);
          const identity = `${input.incidentId}:${input.gateKey ?? ''}`;
          const name = names.get(identity) ?? `CP-${names.size + 2}`;
          names.set(identity, name);
          return { name, version: input.attempt };
        },
        recordAttempt: async (_slug, name, attempt) => { attempts.push([name, attempt]); },
        readBlocker: async (_slug, name) => { blockers.push(name); return undefined; },
        prepareVerification: async (_slug, name, scope) => {
          const input = opened.find(item => names.get(`${item.incidentId}:${item.gateKey ?? ''}`) === name)!;
          return { missionId: 'fixture', command: input.command, worktree, executionRevision: scope.executionRevision!,
            executionMissionRevision: 3, checkpointEvidenceRevision: 3, authorizedGates: [], authorizedCriteria: [],
            verifiedOccurrence: { checkpoint: name, incidentId: input.incidentId, attempt: 1, openedMissionRevision: 1,
              worktree, failureRevision: 'tested-revision', failureEvidenceId: input.failureEvidenceId! }, coveredOccurrences: [] };
        },
        verify: async () => {},
        verifyAll: async () => { certifications++; },
      } }),
      log() {}, error() {},
    });
    assert.equal(result.route, 'fixed');
    assert.equal(launches, 2);
    assert.equal(names.size, 1, 'the incident-and-gate identity reuses one checkpoint on retry');
    assert.deepEqual(opened.map(item => [item.incidentId, item.gateKey, item.command]), [
      ['integration:tested-revision', 'unit', unit.command],
      ['integration:tested-revision', 'unit', unit.command],
    ]);
    assert.ok(opened.every(item => item.worktree === worktree && item.failureRevision === 'tested-revision'
      && Boolean(item.failureEvidenceId)), 'each retry retains the tested-revision failure occurrence');
    assert.deepEqual(attempts, [['CP-2', 1], ['CP-2', 2]]);
    assert.deepEqual(blockers, ['CP-2', 'CP-2']);
    assert.equal(reruns, 2, 'an incomplete green receipt must not certify a one-gate collection');
    assert.equal(certifications, 1, 'only the complete rerun certifies the checkpoint collection');
  });

  test('brief-less Mission keeps legacy integration repair checkpoint-free (TASK-2857-R1-1)', async t => {
    const worktree = mkdtemp('brief-less-integration-repair-');
    t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
    const slug = 'fixture-legacy';
    const unit = { key: 'unit', command: 'npm test', exitCode: 1, stdout: 'unit failed', stderr: '' };
    const store = inMemoryTransitionStore(fixtureMission(slug, {
      status: 'integration', brief: null, checkpoints: [],
    }));
    let launches = 0;
    const result = await route({
      slug, missionWorktree: worktree, failedGate: unit, testedRevision: 'tested-revision',
      gates: [{ key: unit.key, command: unit.command, order: 0 }], implementer: 'codex', repositoryId: 'fixture',
      startAgentFn: async () => { launches++; return { result: { status: 0 } }; },
      transitionTaskFn: async () => {},
      captureFinalTreeFn: () => ({ ok: true, rootDir: worktree, commit: 'tested-revision', tree: 'tree' }),
      runPhaseGatesFn: async () => ({ ok: true, phase: 'integration', gates: [], executed: 1, skipped: false,
        dryRun: false, failedGate: null, failures: [],
        outcomes: [{ ...unit, exitCode: 0, stdout: '', stderr: '' }], error: null }),
      reboundFn: (reason, context) => rebound(reason, { ...context, maxAttempts: 1,
        repairCheckpoints: new RepairCheckpointService(store) }),
      log() {}, error() {},
    });
    assert.equal(result.route, 'fixed');
    assert.equal(launches, 1);
    assert.deepEqual(store.mission().checkpoints, [], 'historical document authority opens no database checkpoint');
  });

  test('aggregate integration failures open one checkpoint per failed gate before one implementer handoff (px-0050.02)', async t => {
    const worktree = mkdtemp('aggregate-integration-repair-');
    t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
    const unit = { key: 'unit', command: 'npm test', exitCode: 1, stdout: 'unit failed in a.test.ts', stderr: '' };
    const integration = { key: 'integration-ci', command: 'npm run test:integration:ci:prebuilt', exitCode: 2,
      stdout: '', stderr: 'integration failed in b.test.ts' };
    const opened: Array<{ incidentId: string; gateKey?: string; command: string }> = [];
    const verified: string[] = [];
    const events: string[] = [];
    let prompt = '';
    const names = new Map<string, string>();
    const result = await route({
      slug: 'fixture', missionWorktree: worktree, failedGate: unit, failedGates: [unit, integration],
      testedRevision: 'tested-revision', blockedGates: [{ key: 'browser', command: 'npm run browser', blockedBy: ['unit'] }],
      cancelledGates: ['agent-e2e'], gates: [
        { key: unit.key, command: unit.command, order: 0 },
        { key: integration.key, command: integration.command, order: 1 },
      ], implementer: 'codex', repositoryId: 'fixture',
      startAgentFn: async (_step, options) => {
        events.push('launch');
        assert.equal(opened.length, 2, 'all aggregate checkpoints exist before the implementer starts');
        if (typeof options.prompt !== 'function') { assert.fail('aggregate repair launch must render its fresh prompt for the selected agent'); }
        prompt = options.prompt('codex');
        return { result: { status: 0 } };
      },
      transitionTaskFn: async () => { events.push('transition'); },
      captureFinalTreeFn: () => ({ ok: true, rootDir: worktree, commit: 'tested-revision', tree: 'tree' }),
      runPhaseGatesFn: async () => ({ ok: true, phase: 'integration', gates: [], executed: 2, skipped: false,
        dryRun: false, failedGate: null, failures: [], outcomes: [
          { ...unit, exitCode: 0, stdout: '', stderr: '' }, { ...integration, exitCode: 0, stdout: '', stderr: '' },
        ], error: null }),
      reboundFn: (reason, context) => {
        assert.equal(reason.kind, 'gate-failure');
        assert.equal(reason.testedRevision, 'tested-revision');
        assert.deepEqual(reason.relatedFailures?.map(failure => failure.gate), ['integration-ci']);
        assert.deepEqual(reason.blockedGates, [{ gate: 'browser', blockedBy: ['unit'] }]);
        assert.deepEqual(reason.cancelledGates, ['agent-e2e']);
        return rebound(reason, { ...context, maxAttempts: 1, repairCheckpoints: {
          open: async input => {
            opened.push(input);
            const identity = `${input.incidentId}:${input.gateKey ?? ''}`;
            const name = names.get(identity) ?? `CP-${names.size + 2}`;
            names.set(identity, name);
            return { name, version: opened.length };
          },
          readBlocker: async () => undefined,
          prepareVerification: async (_slug, name, scope) => {
            const input = opened.find(item => names.get(`${item.incidentId}:${item.gateKey ?? ''}`) === name)!;
            return { missionId: 'fixture', command: input.command, worktree, executionRevision: scope.executionRevision!,
              executionMissionRevision: 3, checkpointEvidenceRevision: 3, authorizedGates: [], authorizedCriteria: [],
              verifiedOccurrence: { checkpoint: name, incidentId: input.incidentId, attempt: 1, openedMissionRevision: 1,
                worktree, failureRevision: 'tested-revision', failureEvidenceId: `${input.gateKey}:1` }, coveredOccurrences: [] };
          },
          verify: async (_slug, name) => { verified.push(name); },
          verifyAll: async (_slug, checks) => { verified.push(...checks.map(check => check.name)); },
        } });
      }, log() {}, error() {},
    });
    assert.equal(result.route, 'fixed');
    assert.equal(events.filter(event => event === 'launch').length, 1);
    assert.deepEqual(opened.map(item => [item.incidentId, item.gateKey, item.command]), [
      ['integration:tested-revision', 'unit', unit.command],
      ['integration:tested-revision', 'integration-ci', integration.command],
    ]);
    assert.deepEqual(verified, ['CP-2', 'CP-3']);
    assert.match(prompt, /Also failed: integration-ci/);
    assert.match(prompt, /Blocked: browser/);
    assert.match(prompt, /Cancelled: agent-e2e/);
    assert.match(prompt, /Retained evidence for every failed gate/);
    assert.match(prompt, /CP-2/);
    assert.match(prompt, /CP-3/);
  });
}
