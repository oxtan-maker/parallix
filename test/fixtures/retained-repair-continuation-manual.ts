/** Manual CLI continuation observation; run with npx tsx, never discovered as a suite. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openMigratedMissionStore } from './mission-sqlite-store.js';
import { fixtureMission, pendingReview } from './mission-builders.js';
import { fakeReviewLoopPorts } from '../helpers/review-loop-ports.js';
import { agentFamily } from '../../src/domain/agents.js';
import { missionId } from '../../src/domain/mission.js';
import { RepairCheckpointService } from '../../src/application/repair-checkpoint-service.js';
import { MissionCheckpointService } from '../../src/application/mission-checkpoint-service.js';
import { runCheckpointVerification } from '../../src/application/rebound-checkpoints.js';
import { runReviewLoop } from '../../src/application/review-loop/review-loop.js';
import { captureRecoveryEvidence, setRecoveryEvidenceFileSystem } from '../../src/application/recovery-evidence.js';
import { recoveryEvidenceFileSystem } from '../../src/adapters/filesystem/recovery-evidence-fs.js';
import { retainedRepairPort } from '../../src/adapters/review/retained-repair.js';
import { ReviewState } from '../../src/adapters/review/review-state.js';
import { createReviewCommand } from '../../src/interfaces/cli/review.js';
import { ReviewCommandUseCase } from '../../src/application/review-command-use-case.js';
import type { ReviewLoopPorts } from '../../src/application/ports/review-round.js';
import type { ReviewWorkflowPort } from '../../src/application/ports/review-workflow.js';

setRecoveryEvidenceFileSystem(recoveryEvidenceFileSystem);
for (const scenario of ['covered', 'uncovered', 'unrecorded']) {
  const covered = scenario === 'covered';
  const unrecorded = scenario === 'unrecorded';
  const slug = `${scenario}-manual`;
  const command = 'test -f repaired';
  const fixture = await openMigratedMissionStore([fixtureMission(slug, {
    brief: { goal: 'manual coverage probe', why: 'continuation', scope: 'disposable', outOfScope: [] },
    assignee: agentFamily('codex'), declaredGates: [command], successCriteria: ['criterion'], completedSuccessCriteria: [0],
    review: pendingReview(slug),
  })]);
  const { root, store } = fixture;
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 2000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const read = async () => {
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found') { throw new Error('disposable Mission missing'); }
    return loaded;
  };
  try {
    git('init', '-q');
    git('config', 'user.name', 'Disposable probe');
    git('config', 'user.email', 'probe@example.invalid');
    fs.writeFileSync(path.join(root, '.gitignore'), '.workflow/\nparallix.db*\n');
    git('add', '.gitignore'); git('commit', '-qm', 'disposable parent');
    const repair = new RepairCheckpointService(store);
    const record = async (name: string) => {
      const result = await new MissionCheckpointService(store).record({ missionId: missionId(slug), operationId: 'manual-evidence',
        capabilities: new Set(['checkpoint:record']), checkpoint: { missionId: missionId(slug), name,
          nextActionText: 'continue through public CLI', goalCheck: [{ criterion: 'criterion',
            evidence: 'test/fixtures/retained-repair-continuation-manual.ts' }] } });
      assert.equal(result.status, 'completed', JSON.stringify(result));
    };
    for (const [index, incidentId] of ['older-manual', 'newer-manual'].entries()) {
      const failure = spawnSync('bash', ['-lc', command], { cwd: root, encoding: 'utf8', timeout: 1000 });
      assert.equal(failure.status, 1);
      const capture = captureRecoveryEvidence({ missionId: slug, command, cwd: root, capturedRevision: git('rev-parse', 'HEAD'),
        exitCode: failure.status, signal: failure.signal, stdout: failure.stdout, stderr: failure.stderr, diagnostic: 'missing repaired file' });
      assert.equal(capture.ok, true);
      if (!capture.ok || !capture.ref) { throw new Error('failure capture failed'); }
      await repair.open({ slug, incidentId, command, attempt: 1, worktree: root,
        failureRevision: capture.ref.capturedRevision, failureEvidenceId: `${capture.ref.incidentId}:${capture.ref.attempt}` });
      if (!unrecorded || index === 0) { await record(`CP-${index + 2}`); }
    }
    const retained = retainedRepairPort(slug, root, store);
    const commitRepair = () => {
      fs.writeFileSync(path.join(root, 'repaired'), 'fixed\n');
      git('add', 'repaired'); git('commit', '-qm', 'disposable repair');
    };
    if (!unrecorded) {
      commitRepair();
      const current = await read();
      const verification = await runCheckpointVerification({ slug, worktree: root, implementer: 'codex', readHead: () => git('rev-parse', 'HEAD'),
        repairCheckpoints: repair, startAgent: async () => { throw new Error('no seed agent'); }, verify: () => retained.verify(command, root) },
      { repairPort: repair, repairCheckpoint: { name: 'CP-3', version: current.version }, fixPrompt: '' }, 1);
      assert.equal(verification.verified.ok, true);
      // Control models a historical certification with no explicit occurrence receipt.
      if (covered) { await verification.certify(); }
      else { await repair.verify(slug, 'CP-3'); }
    }
    const historical = structuredClone((await read()).mission.checkpoints[1]);
    let diagnosticReads = 0;
    let exactChecks = 0;
    let handoffs = 0;
    let implementerLaunches = 0;
    const fake = fakeReviewLoopPorts({ slug, worktree: root, missionStore: store,
      preReview: { head: () => git('rev-parse', 'HEAD') },
      agents: { launch: async request => {
        if (request.role === 'implementer') {
          implementerLaunches++;
          if (!unrecorded) { await record('CP-2'); }
          else if (implementerLaunches === 2) { commitRepair(); }
        }
        return { agent: request.agent, result: { status: 0 } };
      } },
      artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) },
      handoff: { handoff: async () => {
        handoffs++;
        await fake.ports.state.persist(new ReviewState(slug, { implementer: 'codex', reviewer: 'claude', round: 2 }));
        return { ok: true };
      } },
    });
    const ports: ReviewLoopPorts = { ...fake.ports, retainedRepair: { ...retained,
      read: async actual => { diagnosticReads++; return retained.read(actual); },
      verify: async (actual, cwd) => { exactChecks++; return retained.verify(actual, cwd); },
    } };
    // Exercise the public review CLI parser and application command with agent/review fixtures.
    const unused = async () => { throw new Error('unexpected CLI operation'); };
    const workflow: ReviewWorkflowPort = { preflight: (args, options = {}) => ({ slug, args, options }),
      continue: async () => runReviewLoop({ slug, isContinue: true, implementer: 'codex' }, ports),
      verify: unused, submit: unused, push: unused, start: unused, resume: unused, comment: unused,
      readComments: unused, submitReview: unused, close: unused, status: unused, createEvent: unused,
      backfillReview: unused, reconcileReview: unused, importLegacy: unused };
    await createReviewCommand(new ReviewCommandUseCase(workflow))([slug, '--continue']);
    if (unrecorded) {
      assert.deepEqual(fake.exits, [1]);
      assert.equal(handoffs, 0);
      assert.equal(diagnosticReads, 1);
      assert.equal(exactChecks, 2, 'a red first rerun still permits the second implementer attempt');
      assert.deepEqual(fake.launches.map(item => item.role), ['implementer', 'implementer']);
      assert.match(fake.errors.join('\n'), /Recovery dossier/);
      assert.match(fake.errors.join('\n'), /fresh authorized evidence/);
      const checkpoint = (await read()).mission.checkpoints.find(item => item.name === 'CP-3')!;
      assert.equal(checkpoint.repair!.verified, false);
      assert.equal(checkpoint.repair!.exactSuccessCoverage, undefined);
    } else {
      assert.deepEqual(fake.exits, [], JSON.stringify(fake.errors));
      assert.equal(handoffs, 1);
      assert.equal(diagnosticReads, covered ? 0 : 1);
      assert.equal(exactChecks, covered ? 0 : 1);
      assert.deepEqual(fake.launches.map(item => item.role), covered ? ['reviewer'] : ['implementer', 'reviewer']);
      assert.equal(fake.current()?.phase, 'approved');
      if (covered) { assert.deepEqual((await read()).mission.checkpoints[1], historical); }
    }
    console.log(JSON.stringify({ command: `px review ${slug} --continue`, scenario, diagnosticReads, exactChecks,
      handoffs, launches: fake.launches.map(item => item.role), review: fake.current()?.phase,
      boundaries: 'public CLI factory, real Git/shell/SQLite; agent and handoff/reviewer fixtures' }));
  } finally {
    await fixture.close();
    assert.equal(fs.existsSync(root), false);
    console.log(`cleaned disposable repository and Mission store for ${slug}`);
  }
}
