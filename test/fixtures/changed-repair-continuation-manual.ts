/** Disposable public CLI observation; npx tsx test/fixtures/changed-repair-continuation-manual.ts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixtureMission } from './mission-builders.js';
import { agentFamily } from '../../src/domain/agents.js';
import { missionId, missionLabels } from '../../src/domain/mission.js';
import { applyReviewerCommand, changeRevision, ConfiguredReviewerEligibility, currentReviewRound, replaceCurrentRound, startReview } from '../../src/domain/review.js';
import { decideMission } from '../../src/domain/mission-workflow.js';
import { recordImplementerLaunch } from '../../src/application/rebase-identity.js';
import { createMissionApplicationServices } from '../../src/composition/application-services.js';
import { clearOperatorStateCache } from '../../src/adapters/sqlite/adapter-factory.js';
import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../src/adapters/agents/agents.js';
import { configureMissionWriteAuthorization } from '../../src/application/ports/mission-write-authorization.js';
import type { ReviewStartDecision } from '../../src/application/ports/verification-policy.js';
import { REVIEW_START_DECISION_EVENT } from '../../src/application/verification-policy/review-start-decision.js';
import { run } from '../../src/composition/create-cli.js';
import { recordApproval } from '../../src/adapters/review/review-round.js';
import { reviewerResultAttribution } from '../../src/adapters/review/reviewer-result-attribution.js';

const equivalent = process.argv.includes('--equivalent');
const failingCheck = process.argv.includes('--failing-check');
const aggregateMode = process.argv.includes('--aggregate-review') || process.argv.includes('--aggregate-execute');
const aggregateExecute = process.argv.includes('--aggregate-execute');
const reviewStartPolicy = process.argv.includes('--review-start-policy');
const parallelReviewers = process.argv.includes('--parallel-reviewers');
const reviewFamilies = parallelReviewers ? ['custom', 'claude'] : ['custom'];
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-changed-repair-manual-'));
const exactCommand = `test -f ${temporary}/allow-check`;
const aggregateCommands = [`test -f ${temporary}/allow-static`, `test -f ${temporary}/allow-integration`];
const repo = path.join(temporary, 'repo');
const worktree = path.join(temporary, 'repo-task-manual-repair');
const slug = 'task-manual-repair';
const lane = process.argv.includes('--review-lane') ? 'review' : 'active';
const previousCwd = process.cwd();
const previousEnv = { ...process.env };
const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
try {
  fs.mkdirSync(path.join(repo, 'config'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'backlog', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({ product: { name: 'manual-repair', targetUser: 'probe' },
    ...(reviewStartPolicy ? { verificationPolicy: { mode: 'shadow', artifact: 'missing-policy.json' } } : {}), adapters: {
    tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
    agents: { models: { custom: 'stub/custom', claude: 'stub/claude' } },
    missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
    verification: { command: ':', defaultArea: 'all' },
    gates: { preIntegration: aggregateMode
      ? aggregateCommands.map((command, index) => ({ key: index ? 'integration-ci' : 'static-analysis', command, order: index + 1 }))
      : [{ key: 'unit', command: equivalent ? exactCommand : ':', order: 1 }] }, review: { provider: 'none', tmpDir: path.join(temporary, 'review') },
  } }));
  fs.writeFileSync(path.join(repo, 'config', 'agents.json'), JSON.stringify({ steps: {
    draft: { eligible: ['custom'], selection: 'random' }, active: { eligible: ['codex', 'custom'], selection: 'random' },
    review: { eligible: reviewFamilies, selection: 'random' },
  } }));
  fs.writeFileSync(path.join(repo, 'config', 'state-map.json'), JSON.stringify({ ready: 'refined', approved: 'ready-for-integration' }));
  fs.writeFileSync(path.join(repo, 'README.md'), '# Disposable repair exercise\n');
  fs.writeFileSync(path.join(repo, 'backlog', 'tasks', `${slug} - Manual repair.md`), `---\nid: ${slug}\ntitle: Manual repair\nstatus: review\nassignee: [codex]\nlabels: [ai_sdlc]\n---\n\nRead the recorded Mission.\n`);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'probe@example.invalid');
  git(repo, 'config', 'user.name', 'Disposable repair observer');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'disposable baseline');
  const baseline = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'worktree', 'add', '-b', `mission/${slug}`, worktree);
  fs.writeFileSync(path.join(worktree, 'deliverable.txt'), 'old behavior\n');
  git(worktree, 'add', '.'); git(worktree, 'commit', '-qm', 'original reviewed change');
  const approvedRevision = git(worktree, 'rev-parse', 'HEAD');
  if (!equivalent) { fs.writeFileSync(path.join(worktree, 'deliverable.txt'), 'repaired behavior\n'); }
  git(worktree, 'add', '.'); git(worktree, 'commit', '--allow-empty', '-qm', 'committed repair candidate');
  const repairedRevision = git(worktree, 'rev-parse', 'HEAD');
  process.env.PARALLIX_HOME = path.join(temporary, 'state');
  process.env.PARALLIX_CUSTOM_ADMISSION_HOME = process.env.PARALLIX_HOME;
  process.env.PRIMARY_WORKTREE = repo;
  process.env.PARALLIX_NO_BUBBLEWRAP = '1';
  for (const key of ['PARALLIX_GATE_OWNER', 'PARALLIX_CUSTOM_ADMISSION_REPOSITORY', 'PARALLIX_WORKFLOW_OPERATION', 'PARALLIX_WORKFLOW_GENERATION', 'PARALLIX_MISSION_TERMINAL', 'PARALLIX_MISSION_SOCKET', 'PARALLIX_OPERATION_CAPTURE']) { delete process.env[key]; }
  process.chdir(worktree);
  await clearOperatorStateCache();
  const services = await createMissionApplicationServices(worktree);
  configureMissionWriteAuthorization({ operationId: 'disposable-manual-review', async assert(id) { assert.equal(id, slug); } });
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: reviewFamilies.map(agentFamily), strategy: 'random' });
  const review = applyReviewerCommand(startReview({ change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
    revision: changeRevision(approvedRevision), baseline: changeRevision(baseline) }, agentFamily('custom'), agentFamily('codex'), '2026-10-01T08:00:00Z', eligibility), {
    type: 'approve', revision: changeRevision(approvedRevision), decidedAt: '2026-10-01T09:00:00Z', comment: 'historical approval', source: { kind: 'local' },
  });
  const approved = fixtureMission(slug, { repositoryId: services.repositoryId, status: 'integration', assignee: agentFamily('codex'), review,
    labels: missionLabels(['ai_sdlc']),
    brief: { goal: 'Review repaired behavior', why: 'Avoid historical approval replay', scope: 'deliverable.txt', outOfScope: ['Landing'] },
    successCriteria: ['The deliverable is repaired'], completedSuccessCriteria: [0], declaredGates: aggregateMode ? aggregateCommands : [':'],
    checkpoints: [{ missionId: missionId(slug), name: 'CP-1', goalCheck: [{ criterion: 'The deliverable is repaired', evidence: 'deliverable.txt:1', recordedRound: 1 }], nextActionText: 'Independent review',
      recording: { recordedAt: '2026-10-02T09:00:00Z', recordedRound: 1, missionRevision: 2 },
      repair: { incidentId: 'manual-successful-repair', command: ':', attempt: 1, authorizedGates: [':'],
        authorizedCriteria: ['The deliverable is repaired'], evidenceRecorded: true, verified: true } }],
  });
  const active = decideMission(approved, { type: 'rebound-to-active', agent: agentFamily('codex'),
    cause: { kind: 'integration-gate-failure', gate: aggregateMode ? 'static-analysis' : 'unit',
      command: aggregateMode ? aggregateCommands[0] : ':' }, occurredAt: '2026-10-01T10:00:00Z' });
  await services.store.save({ ...active, status: equivalent || aggregateMode && !aggregateExecute ? 'review' : lane,
    ...(equivalent ? { reviewPreparationPending: true } : {}), closedAt: null }, null);
  if (aggregateMode) {
    const { captureRecoveryEvidence } = await import('../../src/application/recovery-evidence.js');
    const references = aggregateCommands.map((command, index) => {
      const captured = captureRecoveryEvidence({ missionId: slug, command, cwd: worktree,
        capturedRevision: approvedRevision, exitCode: index + 1, signal: null, stdout: '', stderr: `original failure ${index + 1}`, diagnostic: `failed ${command}` });
      assert.ok(captured.ok && captured.ref);
      if (!captured.ok || !captured.ref) { throw new Error('aggregate failure capture failed'); }
      return captured.ref;
    });
    await recordImplementerLaunch(slug, 'claude', services.store, services.lifecycle);
    const loaded = await services.store.load(missionId(slug));
    if (loaded.kind !== 'found') { throw new Error('missing aggregate fixture'); }
    const round = currentReviewRound(loaded.mission.review!);
    await services.store.save({ ...loaded.mission, assignee: agentFamily('claude'),
      review: { ...loaded.mission.review!, rounds: replaceCurrentRound(loaded.mission.review!, { ...round, implementer: agentFamily('claude') }) },
      declaredGates: aggregateCommands, checkpoints: references.map((reference, index) => ({
        missionId: missionId(slug), name: `CP-${index + 1}`, nextActionText: 'Resume the interrupted configured verification',
        goalCheck: [{ criterion: 'The deliverable is repaired', evidence: 'deliverable.txt', recordedRound: 1 }],
        recording: { recordedAt: '2026-10-02T09:00:00Z', recordedRound: 1, missionRevision: loaded.version },
        repair: { incidentId: `aggregate-${index + 1}`, gateKey: index ? 'integration-ci' : 'static-analysis',
          command: aggregateCommands[index], attempt: 1, authorizedGates: aggregateCommands,
          authorizedCriteria: ['The deliverable is repaired'], evidenceRecorded: true, verified: false,
          occurrence: { openedMissionRevision: loaded.version, worktree, failureRevision: approvedRevision,
            failureEvidenceId: `${reference.incidentId}:${reference.attempt}` } },
      })) }, loaded.version);
    for (const marker of ['allow-static', 'allow-integration']) { fs.writeFileSync(path.join(temporary, marker), 'green\n'); }
    let reviewerLaunches = 0;
    setCommandPathProbe(() => '/disposable-reviewer');
    setLauncherHealthProbe(() => ({ ok: true }));
    setWorkflowLaunchPort(({ prompt, worktree: launchedWorktree }) => ({
      invocation: { command: 'disposable-independent-reviewer', args: [], options: { cwd: launchedWorktree } },
      resultPromise: (async () => {
        reviewerLaunches++;
        assert.match(prompt, /Mode: review\./);
        const reviewing = await services.store.load(missionId(slug));
        assert.equal(reviewing.kind, 'found');
        if (reviewing.kind !== 'found') { throw new Error('missing aggregate review'); }
        const fresh = currentReviewRound(reviewing.mission.review!);
        assert.equal(fresh.number, 2);
        assert.equal(fresh.implementer, 'claude');
        assert.equal(fresh.decision, null);
        assert.equal(await run(['verdict', 'approve', '--actor', 'custom'], { baseCwd: launchedWorktree }), 0);
        return { status: 0, stdout: '', stderr: '' };
      })(),
    }));
    const command = aggregateExecute ? ['active', slug] : ['review', slug, '--reviewer', 'custom'];
    console.log(`COMMAND: px ${command.join(' ')}`);
    assert.equal(await run(command, { baseCwd: worktree }), 0);
    const result = await services.store.load(missionId(slug));
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') { throw new Error('missing aggregate result'); }
    const repairs = result.mission.checkpoints.map(checkpoint => checkpoint.repair!);
    assert.deepEqual(repairs.map(repair => repair.verified), [true, true]);
    assert.equal(repairs[0].exactSuccessCoverage?.verifiedMissionRevision, repairs[1].exactSuccessCoverage?.verifiedMissionRevision);
    assert.equal(currentReviewRound(result.mission.review!).decision?.kind, 'approved');
    assert.equal(currentReviewRound(result.mission.review!).implementer, 'claude');
    assert.equal(result.mission.status, 'integration');
    assert.equal(reviewerLaunches, 1);
    assert.equal(git(repo, 'rev-parse', 'HEAD'), baseline, 'human landing never ran');
    assert.deepEqual(references.map(reference => fs.readFileSync(reference.stderrPath, 'utf8')), ['original failure 1', 'original failure 2']);
    console.log(JSON.stringify({ observation: aggregateExecute ? 'public Execute aggregate restart' : 'public Review aggregate restart',
      seededInterruption: true, fallbackImplementer: result.mission.assignee, configuredCommands: aggregateCommands,
      verifiedMissionRevision: repairs[0].exactSuccessCoverage?.verifiedMissionRevision, reviewerLaunches,
      finalLane: result.mission.status, landed: false, boundaries: 'disposable Git/SQLite/operator home; stubbed reviewer/provider' }));
  } else if (equivalent) {
    const { captureRecoveryEvidence } = await import('../../src/application/recovery-evidence.js');
    const { RepairCheckpointService } = await import('../../src/application/repair-checkpoint-service.js');
    const { MissionCheckpointService } = await import('../../src/application/mission-checkpoint-service.js');
    const captured = captureRecoveryEvidence({ missionId: slug, command: exactCommand, cwd: worktree,
      capturedRevision: approvedRevision, exitCode: 1, signal: null, stdout: '', stderr: 'original missing marker', diagnostic: 'original failure' });
    assert.ok(captured.ok && captured.ref);
    if (!captured.ok || !captured.ref) { throw new Error('capture failed'); }
    const ref = captured.ref;
    const repair = new RepairCheckpointService(services.store);
    const current = await services.store.load(missionId(slug));
    if (current.kind !== 'found') { throw new Error('missing fixture'); }
    await services.store.save({ ...current.mission, declaredGates: [exactCommand], checkpoints: current.mission.checkpoints.map(cp => ({ ...cp,
      repair: { ...cp.repair!, command: exactCommand, authorizedGates: [exactCommand] } })) }, current.version);
    const opened = await repair.open({ slug, incidentId: 'manual-approved-repair', command: exactCommand, attempt: 1,
      worktree, failureRevision: approvedRevision, failureEvidenceId: `${ref.incidentId}:${ref.attempt}` });
    assert.ok(opened, 'brief-backed disposable mission must open a repair checkpoint');
    const checkpoints = new MissionCheckpointService(services.store);
    const recorded = await checkpoints.record({ missionId: missionId(slug), operationId: 'manual-record', capabilities: new Set(['checkpoint:record']),
      checkpoint: { missionId: missionId(slug), name: opened.name, goalCheck: [{ criterion: 'The deliverable is repaired', evidence: 'deliverable.txt' }], nextActionText: 'Certify repair' } });
    assert.equal(recorded.status, 'completed', JSON.stringify(recorded));
    if (!failingCheck) { fs.writeFileSync(path.join(temporary, 'allow-check'), 'authorized verifier can pass'); }
    let launches = 0;
    setWorkflowLaunchPort(() => { launches++; throw new Error('No agent may launch during approved certification'); });
    console.log(`COMMAND: px review ${slug}`);
    const code = await run(['review', slug], { baseCwd: worktree });
    const after = await services.store.load(missionId(slug));
    assert.equal(after.kind, 'found');
    if (after.kind !== 'found') { throw new Error('missing disposable mission'); }
    assert.equal(code, failingCheck ? 1 : 0);
    assert.equal(launches, 0);
    assert.equal(after.mission.status, failingCheck ? 'review' : 'integration');
    assert.deepEqual(currentReviewRound(after.mission.review!).decision, currentReviewRound(review).decision);
    assert.equal(after.mission.checkpoints.at(-1)?.repair?.verified, !failingCheck);
    assert.equal(fs.readFileSync(ref.stderrPath, 'utf8'), 'original missing marker');
    assert.equal(git(repo, 'rev-parse', 'HEAD'), baseline, 'human landing never ran');
    console.log(JSON.stringify({ observation: 'approved direct-review continuation', control: failingCheck, code,
      lane: after.mission.status, verified: after.mission.checkpoints.at(-1)?.repair?.verified, launches,
      originalDecisionPreserved: true, originalFailurePreserved: true, exactCommand }));
  } else {
  console.log(JSON.stringify({ observation: 'seeded repaired Mission', lane, approvedRevision, repairedRevision }));
  const seeded = await services.store.load(missionId(slug));
  assert.equal(seeded.kind, 'found');
  if (seeded.kind !== 'found') { throw new Error('disposable Mission missing'); }
  const checkpointsBefore = structuredClone(seeded.mission.checkpoints);
  let reviewerLaunches = 0;
  let reviewedRevision = '';
  let verdictTail = Promise.resolve();
  setCommandPathProbe(() => '/disposable-reviewer');
  setLauncherHealthProbe(() => ({ ok: true }));
  setWorkflowLaunchPort(({ prompt, worktree: launchedWorktree, model }) => ({
    invocation: { command: 'disposable-independent-reviewer', args: [], options: { cwd: launchedWorktree } },
    resultPromise: (async () => {
      reviewerLaunches++;
      assert.equal(launchedWorktree, worktree);
      assert.match(prompt, /Mode: review\./);
      assert.match(prompt, /px.*status|status.*task-manual-repair/s, 'normal reviewer receives authoritative Mission reader');
      assert.equal(fs.readFileSync(path.join(worktree, 'deliverable.txt'), 'utf8'), 'repaired behavior\n');
      const loaded = await services.store.load(missionId(slug));
      assert.equal(loaded.kind, 'found');
      if (loaded.kind !== 'found') { throw new Error('disposable Mission missing'); }
      const current = currentReviewRound(loaded.mission.review!);
      assert.equal(current.number, 2);
      reviewedRevision = git(worktree, 'rev-parse', 'HEAD');
      assert.equal(current.subject.revision, reviewedRevision);
      assert.equal(current.decision, null);
      const reviewer = model === 'stub/claude' ? 'claude' : 'custom';
      console.log(JSON.stringify({ observation: 'independent reviewer launched', reviewer, implementer: current.implementer,
        round: current.number, revision: current.subject.revision, lane: loaded.mission.status, goal: loaded.mission.brief?.goal }));
      const verdict = verdictTail.then(async () => {
        if (!parallelReviewers) { return await run(['verdict', 'approve', '--actor', reviewer], { baseCwd: worktree }); }
        const recorded = await recordApproval(slug, { comment: null, decidedAt: new Date().toISOString(),
          revision: reviewedRevision, source: { kind: 'local' },
          result: reviewerResultAttribution(reviewer, { status: 0, runId: `manual-${reviewer}` }) },
        { missionStore: services.store, lifecycleService: services.lifecycle });
        assert.notEqual(recorded.outcome, 'failed', JSON.stringify(recorded));
        return 0;
      });
      verdictTail = verdict.then(() => {}, () => {});
      assert.equal(await verdict, 0);
      return { status: 0, stdout: '', stderr: '' };
    })(),
  }));
  console.log(`COMMAND: px review ${slug} --reviewer custom`);
  assert.equal(await run(['review', slug, '--reviewer', 'custom'], { baseCwd: worktree }), 0);
  const result = await services.store.load(missionId(slug));
  assert.equal(result.kind, 'found');
  if (result.kind !== 'found') { throw new Error('disposable Mission missing'); }
  const current = currentReviewRound(result.mission.review!);
  assert.equal(reviewerLaunches, parallelReviewers ? 2 : 1);
  assert.equal(current.number, 2);
  assert.equal(current.decision?.kind, 'approved');
  assert.equal(current.decision?.revision, reviewedRevision);
  assert.equal(current.subject.revision, reviewedRevision);
  assert.match(git(worktree, 'diff', '--name-only', reviewedRevision, 'HEAD'), /^backlog\/tasks\//);
  assert.equal(result.mission.status, 'integration');
  assert.deepEqual(result.mission.checkpoints, checkpointsBefore);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), baseline, 'human integration never ran');
  const decisions = (await services.operationalHistory.loadAllByTypeForMission(REVIEW_START_DECISION_EVENT, missionId(slug)))
    .map(entry => JSON.parse(entry.eventData) as ReviewStartDecision).sort((left, right) => left.actionSequence - right.actionSequence);
  if (reviewStartPolicy) {
    assert.deepEqual(decisions.map(decision => decision.actualAction), parallelReviewers ? ['agent', 'agent', 'human'] : ['agent', 'human']);
    assert.deepEqual(decisions.map(decision => decision.failureReason?.kind), decisions.map(() => 'artifact-missing'));
    assert.deepEqual(decisions.map(decision => decision.verdictCorrelation), parallelReviewers
      ? ['review:2:agent:custom-verdict', 'review:2:agent:claude-verdict', 'review:2:human-verdict']
      : ['review:2:agent:custom-verdict', 'review:2:human-verdict']);
    assert.deepEqual(decisions.map(decision => decision.actionSequence), parallelReviewers ? [1, 2, 3] : [1, 2]);
    assert.ok(decisions.filter(decision => decision.actualAction === 'agent').every(decision => decision.agentRunId),
      'each agent review row retains its available run link');
    assert.equal(decisions.at(-1)?.agentRunId, null);
    const keys = decisions.map(decision => decision.idempotencyKey);
    assert.equal(await run(['review', slug, '--reviewer', 'custom'], { baseCwd: worktree }), 0);
    const replay = (await services.operationalHistory.loadAllByTypeForMission(REVIEW_START_DECISION_EVENT, missionId(slug)))
      .map(entry => JSON.parse(entry.eventData) as ReviewStartDecision);
    assert.deepEqual(replay.map(decision => decision.idempotencyKey), keys, 'public restart must not duplicate start rows');
    assert.equal(reviewerLaunches, parallelReviewers ? 2 : 1, 'public restart must not relaunch an accepted reviewer');
  } else {
    assert.deepEqual(decisions, [], 'absent policy must append no review-start rows');
  }
  console.log(JSON.stringify({ observation: 'fresh decision persisted', approvedRevision, repairedRevision,
    decisionRevision: current.decision?.revision, round: current.number, lane: result.mission.status, reviewerLaunches,
    policyMode: reviewStartPolicy ? 'shadow' : 'off', reviewStartDecisions: decisions,
    boundaries: parallelReviewers
      ? 'canonical public px review CLI; real Git, SQLite, preparation, prompts and patch comparison; injected deterministic reviewer launches and approval writes only'
      : 'canonical public px review/verdict CLI; real Git, SQLite, preparation, prompts and patch comparison; injected deterministic reviewer launch only' }));
  }
} finally {
  configureMissionWriteAuthorization(null);
  setWorkflowLaunchPort(null);
  await clearOperatorStateCache();
  process.chdir(previousCwd);
  for (const key of Object.keys(process.env)) { if (!(key in previousEnv)) { delete process.env[key]; } }
  Object.assign(process.env, previousEnv);
  fs.rmSync(temporary, { recursive: true, force: true });
  assert.equal(fs.existsSync(temporary), false);
  console.log('Cleaned disposable Git repository, worktree and operator state.');
}
