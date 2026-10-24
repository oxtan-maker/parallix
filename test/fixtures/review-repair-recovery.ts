// Composed retained-repair contracts. Cases own independent Git/SQLite roots,
// launch seams and cleanup; acknowledgment and verification have separate owners.
import { it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { missionVersion } from '../../src/application/domain-ports.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { missionId, type Mission } from '../../src/domain/mission.js';
import { revokeApprovedDecision, requestReviewIntervention, resumeReview, reviewStatus } from '../../src/domain/review.js';
import { setLogger } from '../../src/application/presentation/cli-format.js';
import { run as runCli } from '../../src/composition/create-cli.js';
import { openRepairFixture, type RepairFixture } from '../lib/integration-repair-fixture.js';
import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../src/adapters/agents/agents.js';
import { RepairCheckpointService } from '../../src/application/repair-checkpoint-service.js';
import { composeProductionCapabilities } from '../../src/composition/production-capabilities.js';
import { resolveConfiguration } from '../../src/composition/config.js';
import { NO_CURRENT_WORK_PORT } from '../../src/application/recording/current-work-recorder.js';
import { agentFamily } from '../../src/domain/agents.js';
import { repositoryId } from '../../src/domain/repository.js';
import { makeExecutePorts } from './execute-mission-ports.js';
import { emptyBoardRepositories } from '../helpers/empty-board-repositories.js';
import { captureRecoveryEvidence } from '../../src/application/recovery-evidence.js';

// Keep acknowledgment and verified recovery as separate contracts. Each owns a
// fresh Git/SQLite fixture; neither depends on a preceding test's mutations.
export function registerRetainedRepairCases(phases: readonly ('acknowledgment' | 'recovery' | 'failed-check' | 'new-blocker')[]): void {
  for (const phase of phases) {
    for (const inferred of [false, true]) {
      it(`running CLI ${phase} with ${inferred ? 'inferred' : 'explicit'} slug (TASK-2759)`, { timeout: 10000 }, async t => {
        await retainedRepairCase(phase, inferred, t);
      });
    }
  }
}


type ReviewEntry = 'cli' | 'board';

/**
 * Enter review the way a supported caller does: the CLI runs `px review`, the
 * board dispatches a typed `handoff:record` through production composition.
 * A refusal or stop is exit 1 for the CLI and a failed dispatch for the board.
 */
export async function enterReviewVia(entry: ReviewEntry, fixture: RepairFixture, store: SqliteMissionStore, messages: string[], invoke: (_args: string[]) => Promise<number>): Promise<number> {
  if (entry === 'cli') { return await invoke(['review', fixture.slug]); }
  const repos = emptyBoardRepositories();
  const capabilities = composeProductionCapabilities(fixture.worktree, repositoryId('parallix'),
    { agentBlocklist: repos.blocklistRepo, operationalHistory: repos.historyRepo, boardLaneEvents: repos.laneEventRepo, usage: repos.usageRepo },
    makeExecutePorts().ports, store, NO_CURRENT_WORK_PORT, undefined, null, { configuration: resolveConfiguration(process.env) });
  const result = await capabilities.commandController.dispatch({ operationId: `board-${fixture.slug}-${Date.now()}`, kind: 'handoff:record', missionId: fixture.slug,
    missionStatusAtRequest: (await fixture.load()).status, agent: agentFamily('custom'), capabilities: new Set(['handoff:record']), cancellation: { requested: false } });
  if (result.status !== 'completed') { messages.push(result.error?.message ?? result.status); }
  return result.status === 'completed' ? 0 : 1;
}

/** Seed an interrupted retained repair on an active Mission whose round awaits review (the TASK-2789 shape). */
export async function seedRetainedRepair(phase: 'acknowledgment' | 'recovery' | 'failed-check' | 'new-blocker', t: TestContext, withoutReview = false) {
  const command = phase === 'failed-check' ? 'false' : ':';
  const fixture = await openRepairFixture({ slug: 'task-repair-recovery' });
  const priorConfinement = process.env.PARALLIX_NO_BUBBLEWRAP;
  process.env.PARALLIX_NO_BUBBLEWRAP = '1';
  t.after(async () => {
    setWorkflowLaunchPort(null);
    setCommandPathProbe(null);
    setLauncherHealthProbe(null);
    if (priorConfinement === undefined) { delete process.env.PARALLIX_NO_BUBBLEWRAP; }
    else { process.env.PARALLIX_NO_BUBBLEWRAP = priorConfinement; }
    await fixture.close();
  });
  const store = new SqliteMissionStore(fixture.database);
  const original = await fixture.load();
  const bounced = revokeApprovedDecision(original.review!, 1, {
    revokedAt: '2026-10-01T12:00:00Z', revokedBy: 'workflow', reason: 'gate failed',
    cause: { kind: 'integration-gate-failure', gate: command },
  });
  const stopped = requestReviewIntervention(bounced, {
    requestedAt: '2026-10-01T13:00:00Z', requestedBy: 'workflow', reason: 'REPAIR_EXHAUSTED',
  });
  await store.save({ ...original, status: 'active', rawStatus: 'active', closedAt: null, review: withoutReview ? null : stopped, declaredGates: ['stale-check'] }, missionVersion(await fixture.version()));
  const repair = new RepairCheckpointService(store);
  const opened = await repair.open({ slug: fixture.slug, incidentId: 'interrupted-incident', command, attempt: 3 });
  assert.ok(opened);
  const task = path.join(fixture.worktree, 'backlog', 'tasks', `${fixture.slug} - Fixture.md`);
  fs.writeFileSync(task, fs.readFileSync(task, 'utf8').replace('status: ready-for-integration', 'status: active'));
  fixture.git(fixture.worktree, ['add', '.']);
  fixture.git(fixture.worktree, ['commit', '-m', 'persist interrupted repair fixture']);
  const blocker = { command, diagnostic: 'historical invalid contract', authorityReason: 'operator owns locked checks', proposedCorrection: 'repair stale check reference' };
  await repair.report({ operationId: 'report', missionId: missionId(fixture.slug), capabilities: new Set(['checkpoint:record']), name: opened.name, blocker });
  const stoppedContract = await fixture.load();
  await store.save({ ...stoppedContract, declaredGates: [command] } as Mission, await fixture.version() as never);
  if (phase !== 'acknowledgment') {
    await repair.acknowledgeOperatorResume({ operationId: 'seed-acknowledgment', missionId: missionId(fixture.slug),
      capabilities: new Set(['checkpoint:record']), actor: 'px review operator', occurredAt: '2026-10-01T14:00:00Z' });
    const acknowledged = await fixture.load();
    await store.save({ ...acknowledged, review: acknowledged.review ? resumeReview(acknowledged.review) : null }, missionVersion(await fixture.version()));
  }
  return { fixture, store, repair, opened, blocker, command };
}

export async function retainedRepairCase(phase: 'acknowledgment' | 'recovery' | 'failed-check' | 'new-blocker', inferred: boolean, t: TestContext, withoutReview = false, entry: 'cli' | 'board' = 'cli'): Promise<void> {
  const { fixture, store, repair, opened, blocker, command } = await seedRetainedRepair(phase, t, withoutReview);
  const before = await fixture.load();
  const prompts: string[] = [];
  const launches: string[] = [];
  setCommandPathProbe(() => '/fixture-agent');
  setLauncherHealthProbe(() => ({ ok: true as const }));
  setWorkflowLaunchPort(({ prompt, worktree }: { prompt: string; worktree?: string }) => {
    launches.push('act-on-review');
    prompts.push(prompt);
    return { invocation: { command: 'fixture-agent', args: [], options: { cwd: worktree } },
      resultPromise: (async () => {
        if (phase === 'new-blocker') {
          const result = await repair.report({ operationId: 'new-report', missionId: missionId(fixture.slug),
            capabilities: new Set(['checkpoint:record']), name: opened.name,
            blocker: { ...blocker, diagnostic: 'new blocker during repair' } });
          assert.equal(result.status, 'completed');
        }
        return { status: 0, stdout: '', stderr: '' };
      })() };
  });
  const messages: string[] = [];
  const previousLogger = setLogger({ log: text => { messages.push(String(text)); }, error: text => { messages.push(String(text)); } });
  t.after(() => { setLogger(previousLogger); });
  const invoke = (args: string[]) => runCli(inferred && args[0] === 'review' ? args.filter(arg => arg !== fixture.slug) : args, { baseCwd: fixture.worktree, log: text => { messages.push(text); return text; }, error: text => { messages.push(text); return text; } });
  // The board dispatches the same review entry through production composition;
  // only the launcher and provider boundaries are doubled. A refusal or stop is
  // a failed dispatch, the board's analogue of the CLI's exit 1.
  const enterReview = (): Promise<number> => enterReviewVia(entry, fixture, store, messages, invoke);
  if (phase === 'acknowledgment') {
    assert.equal(await runCli(['review', fixture.slug], {
      operatorInvocation: false, baseCwd: fixture.worktree,
      log: text => { messages.push(text); return text; }, error: text => { messages.push(text); return text; },
    }), 1);
    assert.deepEqual((await fixture.load()).checkpoints.at(-1)?.repair?.blocker, blocker);
    assert.equal(launches.length, 0, 'automatic continuation cannot acknowledge the stop');
    messages.length = 0;
    // An interrupted checkpoint without retained diagnostics must fail before launch.
    assert.equal(await invoke(['review', fixture.slug]), 1, messages.join('\n'));
    assert.equal(launches.length, 0);
    assert.match(messages.join('\n'), /Retained evidence unavailable/);
    const after = await fixture.load();
    const acknowledged = after.checkpoints.at(-1)!.repair!;
    assert.deepEqual(before.checkpoints.at(-1)!.repair?.authorizedGates, ['stale-check']);
    assert.deepEqual(acknowledged.authorizedGates, [':']);
    assert.deepEqual(acknowledged.authorizedCriteria, after.successCriteria);
    assert.equal(acknowledged.blocker, undefined);
    assert.deepEqual(acknowledged.acknowledgedBlocker, blocker);
    assert.equal(acknowledged.acknowledgedBy, 'px review operator');
    assert.ok(Number.isFinite(Date.parse(acknowledged.acknowledgedAt!)));
    assert.deepEqual(after.checkpoints.at(-1)!.goalCheck, before.checkpoints.at(-1)!.goalCheck);
    assert.equal(after.review?.intervention ?? null, null, 'direct entry clears the operator stop');
    assert.equal(after.checkpoints.at(-1)?.repair?.evidenceRecorded, false);
    assert.equal(after.checkpoints.at(-1)?.repair?.verified, false);
    if (withoutReview) {
      assert.equal(after.review, null, 'acknowledgment never fabricates a Review or approval');
      assert.doesNotMatch(messages.join('\n'), /no valid Review|--push|push.*PR/i);
    } else {
      const priorDecision = after.review?.rounds[0].decision;
      assert.equal(priorDecision?.kind, 'approved');
      assert.equal(priorDecision?.kind === 'approved' && priorDecision.revocation?.reason, 'gate failed');
      assert.equal(reviewStatus(after.review!), 'awaiting-review', 'acknowledgment supplies no approval');
    }

    t.diagnostic(`CLI recovery refused missing diagnostics before launch; ${opened.name}/interrupted-incident retained, evidenceRecorded=false, verified=false; operator stop cleared.`);

    messages.length = 0;
    assert.equal(await invoke(['review', fixture.slug, '--submit']), 1);
    assert.ok(messages.join('\n').includes('checkpoint evidence is missing'), messages.join('\n'));
    assert.ok(messages.join('\n').includes(opened.name), messages.join('\n'));
    assert.equal(launches.length, 0, 'handoff refusal must not launch a reviewer or repair agent');
    t.diagnostic(`Reviewer handoff rejected missing ${opened.name} evidence before any reviewer launch.`);
    await assert.rejects(repair.verify(fixture.slug, opened.name), /fresh authorized evidence/);
    return;
  }
  // Start independently at the acknowledged, unverified repair boundary.
  await assert.rejects(repair.verify(fixture.slug, opened.name), /fresh authorized evidence/);
  assert.equal(await invoke(['checkpoint', 'record', '--slug', fixture.slug, '--name', opened.name,
    '--criterion', 'feature ships', '--evidence', 'feature.txt', '--next', 'Run authorized checks, then independent review']), 0);
  const recorded = await fixture.load();
  assert.equal(recorded.checkpoints.at(-1)?.repair?.evidenceRecorded, true);
  assert.equal(recorded.checkpoints.at(-1)?.repair?.verified, false, 'recorded evidence is not harness verification');
  assert.equal(recorded.checkpoints.at(-1)?.repair?.incidentId, 'interrupted-incident');
  t.diagnostic('Real checkpoint record accepted fresh evidence and retained incident authority; it did not synthesize verification or approval.');
  const captured = captureRecoveryEvidence({ missionId: fixture.slug, cwd: fixture.worktree,
    command, capturedRevision: fixture.approvedRevision, signal: null, exitCode: 1, stdout: 'original interrupted check', stderr: 'original gate failure' });
  assert.equal(captured.ok, true);
  // A no-op agent cannot turn even a passing check into checkpoint proof.
  messages.length = 0;
  assert.equal(await enterReview(), 1, messages.join('\n'));
  if (phase === 'new-blocker') {
    const after = await fixture.load();
    assert.equal(launches.length, 1, 'new blocker stops the finite repair before another agent');
    assert.equal(after.checkpoints.at(-1)?.repair?.blocker?.diagnostic, 'new blocker during repair');
    assert.equal(after.checkpoints.at(-1)?.repair?.verified, false);
    assert.notEqual(reviewStatus(after.review!), 'approved');
    assert.match(messages.join('\n'), /new blocker during repair/);
    t.diagnostic('New blocker retained with diagnostics; exit 1, no reviewer or approval.');
    return;
  }
  if (phase === 'failed-check') {
    const after = await fixture.load();
    assert.equal(launches.length, 2, 'failed exact check spends only the finite repair budget');
    assert.equal(after.status, 'active');
    assert.equal(reviewStatus(after.review!), 'awaiting-review');
    assert.equal(after.checkpoints.at(-1)?.repair?.verified, false);
    assert.ok(prompts.every(prompt => prompt.includes('REPAIR AUTHORITY')));
    t.diagnostic('Exact false check failed despite agent exit 0: two repair launches, active/awaiting-review, no reviewer or approval.');
    return;
  }
  assert.deepEqual(launches, ['act-on-review']);
  assert.match(prompts[0], /original gate failure/);
  assert.match(prompts[0], /REPAIR AUTHORITY/);
  assert.match(messages.join('\n'), /fresh authorized evidence/);
  assert.equal((await fixture.load()).checkpoints.at(-1)?.repair?.verified, false);
  setWorkflowLaunchPort(({ prompt, worktree }: { prompt: string; worktree?: string }) => ({
    invocation: { command: 'fixture-reviewer', args: [], options: { cwd: worktree } },
    resultPromise: (async () => {
      if (prompt.includes('REPAIR AUTHORITY')) {
        launches.push('repair');
        assert.equal(await invoke(['checkpoint', 'record', '--slug', fixture.slug, '--name', opened.name,
          '--criterion', 'feature ships', '--evidence', 'feature.txt', '--next', 'Independent review']), 0);
        return { status: 0, stdout: '', stderr: '' };
      }
      assert.match(prompt, /^Mode: review\./m, 'only independent reviewer work is allowed after repaired handoff');
      launches.push('review');
      const mission = await fixture.load();
      assert.equal(await invoke(['verdict', 'approve', '--slug', fixture.slug,
        '--actor', mission.review!.rounds.at(-1)!.reviewer, '--comment', 'Fixture repair reviewed']), 0);
      return { status: 0, stdout: '', stderr: '' };
    })(),
  }));
  assert.equal(await enterReview(), 0, messages.join('\n'));
  assert.equal((await fixture.load()).checkpoints.at(-1)?.repair?.verified, true);
  assert.deepEqual(launches, ['act-on-review', 'repair', 'review']);
  assert.equal(reviewStatus((await fixture.load()).review!), 'approved');
  t.diagnostic('After valid evidence, inferred review passed handoff and launched the independent reviewer; approval came only from its explicit verdict.');
}
