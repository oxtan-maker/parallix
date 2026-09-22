/**
 * TASK-2521.03 — the shipped agent read/write surface, end to end.
 *
 * AC #15: read state -> change it -> re-read -> record checkpoint evidence ->
 * re-read -> record review data -> re-read. Every write runs through the
 * production command graph against a real SQLite operator database, and every
 * read comes back from that database. No workflow file is written or read at
 * any point.
 *
 * Reads go to the store rather than `px status --json` because building the
 * board projection lists the repository's pull requests, which would put a
 * network call in the middle of a test about the Mission read/write path. The
 * `px status --json` rendering of these same fields is covered by
 * `test/task-2521-03-status-projection.test.ts`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { clearOperatorStateCache, initOperatorState } from '../src/adapters/sqlite/adapter-factory.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { run } from '../src/composition/create-cli.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionBrief } from '../src/domain/mission-brief.js';
import { intakeMission, missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { ConfiguredReviewerEligibility, changeRevision, startReview } from '../src/domain/review.js';
import { repositoryId } from '../src/domain/repository.js';
import { latestEvidencedCheckpoint } from '../src/domain/checkpoint.js';

const SLUG = 'task-2521-03-context-cli';

test('the typed write verbs round-trip through the production command graph', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-context-cli-'));
  // `px status` reports the mission's pull request. This test is about the
  // Mission read/write path, so it runs against a repo with no review provider
  // configured rather than reaching a provider over the network.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-context-repo-'));
  fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({
    product: { name: 'Context CLI Fixture' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog' },
      missions: { baseDir: 'docs/missions' },
      verification: { command: './scripts/verify-local.sh {{area}}' },
      review: { provider: 'none' },
      agents: {},
    },
  }, null, 2));
  const previousHome = process.env.PARALLIX_HOME;
  const output: string[] = [];
  const errors: string[] = [];
  process.env.PARALLIX_HOME = home;

  try {
    const { db } = await initOperatorState({ homeDir: home });
    const store = new SqliteMissionStore(db);
    const mission: Mission = {
      ...intakeMission({
        id: missionId(SLUG),
        repositoryId: repositoryId('parallix'),
        title: 'Context CLI integration fixture',
        labels: missionLabels(['cli']),
        assignee: agentFamily('codex'),
      }),
      status: 'active',
      brief: missionBrief({
        goal: 'Prove the real CLI reads and writes Mission state',
        why: 'The composition boundary must remain wired.',
        scope: 'Read and change one persisted Mission.',
        outOfScope: ['A filesystem fallback'],
      }),
      declaredGates: ['npm test'],
    } as Mission;
    await store.save(mission, null);
    await clearOperatorStateCache();

    const invoke = async (args: string[]) => {
      output.length = 0;
      errors.length = 0;
      const write = process.stdout.write.bind(process.stdout);
      (process.stdout as unknown as { write: (_chunk: string) => boolean }).write = (chunk) => {
        output.push(String(chunk));
        return true;
      };
      try { return await run(args, { baseCwd: repo, error: (message) => { errors.push(message); return message; } }); }
      finally { (process.stdout as unknown as { write: typeof write }).write = write; }
    };
    /** Re-read the Mission exactly as a later agent would: from the database. */
    const statusJson = async () => {
      await clearOperatorStateCache();
      const { db: readDb } = await initOperatorState({ homeDir: home });
      const loaded = await new SqliteMissionStore(readDb).load(missionId(SLUG));
      assert.equal(loaded.kind, 'found', 'the mission must stay readable');
      const found = loaded as { mission: Mission; version: number };
      const brief = found.mission.brief;
      const checkpoints = found.mission.checkpoints;
      const latest = latestEvidencedCheckpoint(checkpoints);
      return {
        slug: found.mission.id,
        version: found.version,
        brief,
        declaredGates: found.mission.declaredGates ?? [],
        successCriteria: found.mission.successCriteria ?? [],
        checkpoints: found.mission.checkpoints.map(({ name, firstLine, goalCheck }) => ({ name, description: firstLine, recorded: goalCheck.length > 0 })),
        predictedNelBucket: found.mission.predictedNelBucket ?? null,
        latestCheckpoint: latest
          ? { name: latest.name, goalCheck: latest.goalCheck, nextAction: latest.nextActionText }
          : null,
        assignee: found.mission.assignee,
        review: found.mission.review,
      };
    };

    // --- read -------------------------------------------------------------
    const first = await statusJson();
    assert.equal(first.slug, SLUG);
    assert.equal(first.brief.goal, 'Prove the real CLI reads and writes Mission state');
    assert.deepEqual(first.declaredGates, ['npm test']);
    const version = first.version;
    assert.ok(Number.isSafeInteger(version), 'status --json must expose the write version');

    // --- every write requires the version --------------------------------
    assert.equal(await invoke(['goal', 'set', '--slug', SLUG, '--goal', 'x', '--why', 'y']), 1);
    assert.match(errors.join('\n'), /--expected-version <n> is required/);
    assert.equal((await statusJson()).brief.goal, 'Prove the real CLI reads and writes Mission state');

    // --- change, then re-read --------------------------------------------
    assert.equal(await invoke([
      'goal', 'set', '--slug', SLUG,
      '--goal', 'Prove the typed verbs write', '--why', 'AC #15 needs a real round trip',
      '--expected-version', String(version),
    ]), 0, errors.join('\n'));
    const afterGoal = await statusJson();
    assert.equal(afterGoal.brief.goal, 'Prove the typed verbs write');
    assert.equal(afterGoal.brief.why, 'AC #15 needs a real round trip');
    // Omitted fields are preserved: the scope written by the fixture survives.
    assert.equal(afterGoal.brief.scope, 'Read and change one persisted Mission.');

    // --- a stale write is rejected and changes nothing --------------------
    assert.equal(await invoke([
      'goal', 'set', '--slug', SLUG, '--goal', 'stale', '--why', 'stale',
      '--expected-version', String(version),
    ]), 1);
    assert.match(errors.join('\n'), /expected version/);
    assert.equal((await statusJson()).brief.goal, 'Prove the typed verbs write');

    // --- one gate per call, and gates round-trip --------------------------
    let current = (await statusJson()).version;
    assert.equal(await invoke(['gate', 'add', '--slug', SLUG, '--command', './scripts/verify-local.sh all', '--expected-version', String(current)]), 0, errors.join('\n'));
    assert.deepEqual((await statusJson()).declaredGates, ['npm test', './scripts/verify-local.sh all']);
    current = (await statusJson()).version;
    assert.equal(await invoke(['gate', 'remove', '--slug', SLUG, '--command', 'npm test', '--expected-version', String(current)]), 0, errors.join('\n'));
    assert.deepEqual((await statusJson()).declaredGates, ['./scripts/verify-local.sh all']);

    // --- success criteria: one per call, duplicates refused ---------------
    current = (await statusJson()).version;
    assert.equal(await invoke(['criterion', 'add', '--slug', SLUG, '--text', 'The CLI round trip passes', '--expected-version', String(current)]), 0, errors.join('\n'));
    current = (await statusJson()).version;
    assert.equal(await invoke(['criterion', 'add', '--slug', SLUG, '--text', 'The CLI round trip passes', '--expected-version', String(current)]), 1);
    assert.match(errors.join('\n'), /already declared/);
    assert.deepEqual((await statusJson()).successCriteria, ['The CLI round trip passes']);
    current = (await statusJson()).version;
    assert.equal(await invoke(['criterion', 'add', '--slug', SLUG, '--text', 'Stale writes change nothing', '--expected-version', String(current)]), 0, errors.join('\n'));
    current = (await statusJson()).version;
    assert.equal(await invoke(['criterion', 'remove', '--slug', SLUG, '--text', 'The CLI round trip passes', '--expected-version', String(current)]), 0, errors.join('\n'));
    assert.deepEqual((await statusJson()).successCriteria, ['Stale writes change nothing']);

    // --- checkpoint plan: one list with the evidence, CP-N names ------------
    current = (await statusJson()).version;
    assert.equal(await invoke(['checkpoint', 'plan', '--slug', SLUG, '--name', 'step one', '--text', 'x', '--expected-version', String(current)]), 1);
    assert.match(errors.join('\n'), /must look like CP-1/);
    for (const [name, text] of [['CP-2', 'Prove the round trip'], ['CP-1', 'Wire the verbs'], ['CP-3', 'Dropped again']]) {
      current = (await statusJson()).version;
      assert.equal(await invoke(['checkpoint', 'plan', '--slug', SLUG, '--name', name, '--text', text, '--expected-version', String(current)]), 0, errors.join('\n'));
    }
    current = (await statusJson()).version;
    assert.equal(await invoke(['checkpoint', 'unplan', '--slug', SLUG, '--name', 'CP-3', '--expected-version', String(current)]), 0, errors.join('\n'));
    assert.deepEqual((await statusJson()).checkpoints, [
      { name: 'CP-1', description: 'Wire the verbs', recorded: false },
      { name: 'CP-2', description: 'Prove the round trip', recorded: false },
    ]);

    // --- predicted NEL bucket, validated ----------------------------------
    current = (await statusJson()).version;
    assert.equal(await invoke(['nel', 'set', '--slug', SLUG, '--predicted', 'Huge', '--expected-version', String(current)]), 1);
    assert.match(errors.join('\n'), /Small, Medium or Large/);
    assert.equal(await invoke(['nel', 'set', '--slug', SLUG, '--predicted', 'Medium', '--expected-version', String(current)]), 0, errors.join('\n'));
    assert.equal((await statusJson()).predictedNelBucket, 'Medium');

    // --- checkpoint evidence, recorded and read back ----------------------
    current = (await statusJson()).version;
    assert.equal(await invoke([
      'checkpoint', 'record', '--slug', SLUG, '--name', 'CP-1',
      '--criterion', 'CLI round trip', '--evidence', 'test/task-2521-03-context-cli.integration.test.ts',
      '--next', 'Read the status again.', '--expected-version', String(current),
    ]), 0, errors.join('\n'));
    const afterCheckpoint = await statusJson();
    assert.equal(afterCheckpoint.latestCheckpoint.name, 'CP-1');
    assert.equal(afterCheckpoint.latestCheckpoint.goalCheck[0].criterion, 'CLI round trip');
    assert.equal(afterCheckpoint.latestCheckpoint.nextAction, 'Read the status again.');
    // Evidence replaced the planned CP-1 in place and kept what it was planned to deliver.
    assert.deepEqual(afterCheckpoint.checkpoints, [
      { name: 'CP-1', description: 'Wire the verbs', recorded: true },
      { name: 'CP-2', description: 'Prove the round trip', recorded: false },
    ]);

    // --- same-checkpoint replacement keeps one CP-1 (AC #7) ---------------
    current = afterCheckpoint.version;
    assert.equal(await invoke([
      'checkpoint', 'record', '--slug', SLUG, '--name', 'CP-1',
      '--criterion', 'CLI round trip replaced', '--evidence', 'test/task-2521-03-review-verbs.test.ts',
      '--next', 'Replaced evidence.', '--expected-version', String(current),
    ]), 0, errors.join('\n'));
    const replaced = await statusJson();
    assert.equal(replaced.latestCheckpoint.goalCheck[0].criterion, 'CLI round trip replaced');

    // --- malformed evidence fails closed ----------------------------------
    current = replaced.version;
    assert.equal(await invoke([
      'checkpoint', 'record', '--slug', SLUG, '--name', 'CP-invalid',
      '--criterion', 'no evidence for this one',
      '--next', 'This must fail.', '--expected-version', String(current),
    ]), 1);
    assert.match(errors.join('\n'), /--criterion and --evidence must pair up/);
    assert.equal((await statusJson()).latestCheckpoint.name, 'CP-1', 'the rejected write changed nothing');

    // --- assignment set and clear -----------------------------------------
    current = (await statusJson()).version;
    assert.equal(await invoke(['assign', '--slug', SLUG, '--agent', 'reviewer', '--expected-version', String(current)]), 0, errors.join('\n'));
    current = (await statusJson()).version;
    assert.equal(await invoke(['unassign', '--slug', SLUG, '--expected-version', String(current)]), 0, errors.join('\n'));

    // --- review data: decision, then resolution, then re-read (AC #8, #15) --
    // The Mission needs an open round before a verdict has anywhere to land;
    // `px verdict` must refuse rather than invent one.
    assert.equal(await invoke([
      'verdict', 'request-changes', '--slug', SLUG, '--actor', 'reviewer',
      '--expected-version', String((await statusJson()).version),
      '--finding', 'F1', '--summary', 'needs coverage',
    ]), 1);
    assert.match(errors.join('\n'), /no review state/);
    assert.equal((await statusJson()).review, null, 'the refused verdict recorded nothing');

    const reviewer = agentFamily('reviewer');
    const implementer = agentFamily('codex');
    const opened = await statusJson();
    const withReview = {
      ...(await new SqliteMissionStore((await initOperatorState({ homeDir: home })).db).load(missionId(SLUG)) as { mission: Mission }).mission,
      status: 'review' as const,
      review: startReview(
        { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('base') },
        reviewer, implementer, '2026-09-20T00:00:00Z',
        ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' }),
      ),
    };
    await new SqliteMissionStore((await initOperatorState({ homeDir: home })).db)
      .save(withReview as Mission, opened.version as never);
    await clearOperatorStateCache();

    assert.equal(await invoke([
      'verdict', 'request-changes', '--slug', SLUG, '--actor', 'reviewer',
      '--expected-version', String((await statusJson()).version),
      '--finding', 'F1', '--summary', 'needs coverage', '--location', 'src/a.ts:1',
    ]), 0, errors.join('\n'));

    const afterVerdict = await statusJson();
    const round = afterVerdict.review?.rounds[0];
    assert.ok(round?.decision, 'the decision must be readable from the database, not from a file');
    assert.equal(round.decision.kind, 'changes-requested');
    // The finding reaches the aggregate typed: id, summary and location
    // survive intact because nothing re-parsed them out of Markdown.
    const decision = round.decision as { kind: 'changes-requested'; findings: readonly { id: string; summary: string; location: string | null }[] };
    assert.deepEqual(
      decision.findings.map((f) => ({ id: f.id, summary: f.summary, location: f.location })),
      [{ id: 'F1', summary: 'needs coverage', location: 'src/a.ts:1' }],
    );

    assert.equal(await invoke([
      'resolve', '--slug', SLUG, '--actor', 'codex', '--revision', 'fixedsha',
      '--expected-version', String((await statusJson()).version),
      '--finding', 'F1', '--fixed', 'test/task-2521-03-context-cli.integration.test.ts',
    ]), 0, errors.join('\n'));

    const afterResolve = await statusJson();
    const response = afterResolve.review?.rounds[0]?.response;
    assert.ok(response, 'the resolution must be readable from the database');
    assert.deepEqual(
      response.resolutions.map((r: { findingId: string; kind: string }) => ({ findingId: r.findingId, kind: r.kind })),
      [{ findingId: 'F1', kind: 'fixed' }],
    );

    // Nothing in this test ever named a workflow file.
    assert.ok(!fs.existsSync(path.join(repo, 'missions', SLUG)),
      'the round trip must not create a mission directory');
    assert.ok(!fs.existsSync(path.join(repo, 'docs', 'missions')),
      'the round trip must not create a mission document tree');
    assert.ok(!fs.existsSync(path.join(repo, 'missions')),
      'recording review data must not create a review-event file tree');
  } finally {
    await clearOperatorStateCache();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
