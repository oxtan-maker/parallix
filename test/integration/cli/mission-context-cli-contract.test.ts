import { missionVersion } from '../../../src/application/domain-ports.js';
// Mission context CLI contract: context CLI mutation,
// dependency recording, and Mission title resolution across the CLI boundary.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Context CLI: TASK-2521.03
//   Mission dependencies CLI: TASK-2521.04
//   Mission title: TASK-2441

import test, { describe, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import assert from 'node:assert/strict';
import { pxNodeArgs, resolvePxEntryLoader } from '../../lib/px-entry.js';
import { clearOperatorStateCache, initOperatorState } from '../../../src/adapters/sqlite/adapter-factory.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { run } from '../../../src/composition/create-cli.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionBrief } from '../../../src/domain/mission-brief.js';
import { intakeMission, missionId, missionLabels, type Mission, type MissionStatus } from '../../../src/domain/mission.js';
import { ConfiguredReviewerEligibility, changeRevision, startReview } from '../../../src/domain/review.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { latestEvidencedCheckpoint } from '../../../src/domain/checkpoint.js';
import React from 'react';
import { renderToString } from 'ink';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../../src/adapters/sqlite/migration-runner.js';
import { composeBoardProjection } from '../../../src/composition/board-projection.js';
import { MissionEditService } from '../../../src/application/mission-edit-service.js';
import { MissionCard } from '../../../src/interfaces/tui/mission-card.js';


// TASK-2521.03 (was test/task-2521-03-context-cli.integration.test.ts)
describe('Context CLI', () => {
  /**
   * TASK-2521.03 — the shipped context read/write CLI and SQLite boundary.
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
   * `test/unit/application/status-command-use-case.test.ts`.
   */



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
      // Review verdicts require an actual implementer revision.
      for (const args of [
        ['init', '-b', 'main'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'Seed review revision'],
      ]) {
        const result = childProcess.spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
      }
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
        process.stdout.write = (chunk) => {
          output.push(String(chunk));
          return true;
        };
        try { return await run(args, { baseCwd: repo, error: (message) => { errors.push(message); return message; } }); }
        finally { process.stdout.write = write; }
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
      assert.ok(first.brief != null);
      assert.equal(first.brief.goal, 'Prove the real CLI reads and writes Mission state');
      assert.deepEqual(first.declaredGates, ['npm test']);
      const version = first.version;
      assert.ok(Number.isSafeInteger(version), 'status --json must expose the write version');

      // --- writes resolve the version without the flag ---------------------
      assert.equal(await invoke([
        'goal', 'set', '--slug', SLUG,
        '--goal', 'Prove the typed verbs write', '--why', 'AC #15 needs a real round trip',
      ]), 0, errors.join('\n'));
      const afterWrite1 = await statusJson();
      assert.ok(afterWrite1.brief);
      assert.equal(afterWrite1.brief.goal, 'Prove the typed verbs write');

      // --- genuinely sequential flag-free writes need no readback between ---
      // No statusJson read between writes: each resolves its own stored version
      // and threads it through the store's compare-and-swap save. A stale
      // expected-version would fail here; none is supplied.
      assert.equal(await invoke(['nel', 'set', '--slug', SLUG, '--predicted', 'Large']), 0, errors.join('\n'));
      assert.equal(await invoke(['assign', '--slug', SLUG, '--agent', 'codex']), 0, errors.join('\n'));
      assert.equal(await invoke(['nel', 'set', '--slug', SLUG, '--predicted', 'Medium']), 0, errors.join('\n'));
      assert.equal(await invoke(['assign', '--slug', SLUG, '--agent', 'reviewer']), 0, errors.join('\n'));
      const sequential = await statusJson();
      assert.equal(sequential.predictedNelBucket, 'Medium');
      assert.equal(sequential.assignee, 'reviewer');

      // --- an injected competing write between load and save is refused -----
      // Two flag-free writes race the same stored revision: SQLite serialises
      // them and exactly one wins, the other conflicts and changes nothing
      // (no overwrite, no duplicate effect). The version always advances by one.
      const before = (await statusJson()).version;
      const [win, lose] = await Promise.all([
        run(['nel', 'set', '--slug', SLUG, '--predicted', 'Small'], { baseCwd: repo, error: (m) => m }),
        run(['nel', 'set', '--slug', SLUG, '--predicted', 'Medium'], { baseCwd: repo, error: (m) => m }),
      ]);
      assert.equal([win, lose].filter((c) => c === 0).length, 1, 'exactly one concurrent flag-free write wins');
      assert.equal([win, lose].filter((c) => c === 1).length, 1, 'the other conflicts');
      const competing = await statusJson();
      assert.equal(competing.version, before + 1, 'one competing write advanced the version once');
      assert.equal(['Small', 'Medium'].includes(competing.predictedNelBucket ?? ''), true, 'the winner landed, the loser did not');

      // --- a stale write is rejected and changes nothing --------------------
      assert.equal(await invoke([
        'goal', 'set', '--slug', SLUG, '--goal', 'stale', '--why', 'stale',
        '--expected-version', String(version),
      ]), 1);
      const afterGoal = await statusJson();
      assert.ok(afterGoal.brief != null);
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
      const afterWrite2 = await statusJson();
      assert.ok(afterWrite2.brief);
      assert.equal(afterWrite2.brief.goal, 'Prove the typed verbs write');

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
      assert.ok(afterCheckpoint.latestCheckpoint != null);
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
        '--criterion', 'CLI round trip', '--evidence', 'test/task-2521-03-review-verbs.test.ts',
        '--next', 'Replaced evidence.', '--expected-version', String(current),
      ]), 0, errors.join('\n'));
      const replaced = await statusJson();
      assert.ok(replaced.latestCheckpoint != null);
      assert.deepEqual(replaced.latestCheckpoint.goalCheck, [
        { criterion: 'CLI round trip', criterionId: null, evidence: 'test/task-2521-03-review-verbs.test.ts' },
      ]);
      assert.equal(replaced.latestCheckpoint.nextAction, 'Replaced evidence.');
      assert.deepEqual(replaced.checkpoints, afterCheckpoint.checkpoints);

      // --- malformed evidence fails closed ----------------------------------
      current = replaced.version;
      assert.equal(await invoke([
        'checkpoint', 'record', '--slug', SLUG, '--name', 'CP-invalid',
        '--criterion', 'no evidence for this one',
        '--next', 'This must fail.', '--expected-version', String(current),
      ]), 1);
      assert.match(errors.join('\n'), /--criterion and --evidence must pair up/);
      const afterWrite3 = await statusJson();
      assert.ok(afterWrite3.latestCheckpoint);
      assert.equal(afterWrite3.latestCheckpoint.name, 'CP-1', 'the rejected write changed nothing');

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
      const reviewLoad = await new SqliteMissionStore((await initOperatorState({ homeDir: home })).db).load(missionId(SLUG));
      assert.equal(reviewLoad.kind, 'found');
      assert.equal(reviewLoad.mission.closedAt, null);
      const withReview = {
        ...reviewLoad.mission,
        status: 'review' as const,
        review: startReview(
          { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('base') },
          reviewer, implementer, '2026-09-20T00:00:00Z',
          ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' }),
        ),
      };
      await new SqliteMissionStore((await initOperatorState({ homeDir: home })).db)
        .save(withReview, missionVersion(opened.version));
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

  // Flag-free writes in inferred-slug mode: run from the mission worktree
  // branch so the slug is inferred, never passed, with no intervening status
  // read, and an injected competing write that must conflict.
  test('flag-free writes resolve the inferred worktree slug and a competing write conflicts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-flagfree-'));
    const repo = path.join(root, 'repo');
    const home = path.join(root, 'state');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Flagfree Fixture' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions' },
        verification: { command: ':' },
        review: { provider: 'none' },
        agents: {},
      },
    }, null, 2));
    // A mission worktree branch so the slug is inferred, not passed.
    for (const args of [
      ['init', '-q'],
      ['checkout', '-b', 'mission/task-flagfree'],
      ['config', 'user.email', 'test@example.com'],
      ['config', 'user.name', 'Parallix E2E'],
    ]) { const r = childProcess.spawnSync('git', args, { cwd: repo }); if (r.status !== 0) { throw new Error(`git ${args.join(' ')} failed`); } }
    const previousHome = process.env.PARALLIX_HOME;
    process.env.PARALLIX_HOME = home;
    const id = missionId('task-flagfree');
    try {
      const { db } = await initOperatorState({ homeDir: home });
      const store = new SqliteMissionStore(db);
      await store.save({
        ...intakeMission({ id, repositoryId: repositoryId('parallix'), title: 'Flagfree fixture', assignee: agentFamily('codex') }),
        status: 'active',
        brief: missionBrief({ goal: 'flag-free goal', why: 'flag-free', scope: 'read one Mission', outOfScope: [] }),
        declaredGates: [],
      } as Mission, null);
      await clearOperatorStateCache();

      // Inferred slug: no --slug, no --expected-version. Genuinely sequential.
      assert.equal(await run(['goal', 'set', '--goal', 'sequential one', '--why', 'no read'], { baseCwd: repo }), 0);
      assert.equal(await run(['nel', 'set', '--predicted', 'Large'], { baseCwd: repo }), 0);
      assert.equal(await run(['assign', '--agent', 'reviewer'], { baseCwd: repo }), 0);
      const inferred = await new SqliteMissionStore((await initOperatorState({ homeDir: home })).db).load(id);
      assert.equal(inferred.kind, 'found');
      if (inferred.kind !== 'found') { throw new Error('missing'); }
      assert.equal(inferred.mission.brief?.goal, 'sequential one');
      assert.equal(inferred.mission.predictedNelBucket, 'Large');
      assert.equal(inferred.mission.assignee, agentFamily('reviewer'));

      // Injected competing write: two flag-free writes race the same revision.
      const before = inferred.version;
      const [win, lose] = await Promise.all([
        run(['nel', 'set', '--predicted', 'Small'], { baseCwd: repo }),
        run(['nel', 'set', '--predicted', 'Medium'], { baseCwd: repo }),
      ]);
      assert.equal([win, lose].filter((c) => c === 0).length, 1, 'exactly one concurrent flag-free write wins');
      assert.equal([win, lose].filter((c) => c === 1).length, 1, 'the other conflicts');
      const competing = await new SqliteMissionStore((await initOperatorState({ homeDir: home })).db).load(id);
      assert.equal(competing.kind, 'found');
      if (competing.kind !== 'found') { throw new Error('missing'); }
      assert.equal(competing.version, before + 1, 'one competing write advanced the version once');
      assert.ok(['Small', 'Medium'].includes(competing.mission.predictedNelBucket ?? ''), 'the winner landed');
    } finally {
      await clearOperatorStateCache();
      if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// TASK-2521.04 (was test/task-2521.04-mission-dependencies.integration.test.ts)
describe('Mission dependencies CLI', () => {
  /**
   * TASK-2521.04 — `px depends add|remove` CLI persistence contract.
   *
   * Every write runs through the production command graph against a real SQLite
   * operator database, and every read comes back from that database through the
   * `mission_dependencies` table migration 0025 adds. Reads go to the store
   * rather than `px status --json` for the reason
   * the Context CLI section of this suite states: building the
   * board projection would list the repository's pull requests.
   */



  const SLUG = 'task-2521-04-depends';
  const OTHER = 'task-2521-04-predecessor';

  test('px depends records Mission-to-Mission dependencies and refuses the rest', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-depends-'));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-depends-repo-'));
    fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Depends Fixture' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions' },
        verification: { command: './scripts/verify-local.sh {{area}}' },
        review: { provider: 'none' },
        agents: {},
      },
    }, null, 2));
    const previousHome = process.env.PARALLIX_HOME;
    const errors: string[] = [];
    process.env.PARALLIX_HOME = home;

    try {
      const { db } = await initOperatorState({ homeDir: home });
      const store = new SqliteMissionStore(db);
      for (const slug of [SLUG, OTHER]) {
        await store.save({
          ...intakeMission({
            id: missionId(slug),
            repositoryId: repositoryId('parallix'),
            title: `Dependency fixture ${slug}`,
            labels: missionLabels(['cli']),
            assignee: agentFamily('codex'),
          }),
        } as Mission, null);
      }
      await clearOperatorStateCache();

      const invoke = async (args: readonly string[]) => {
        errors.length = 0;
        const write = process.stdout.write.bind(process.stdout);
        process.stdout.write = () => true;
        try {
          return await run([...args], { baseCwd: repo, error: (message) => { errors.push(message); return message; } });
        } finally { process.stdout.write = write; }
      };
      /** Re-read the Mission exactly as a later agent would: from the database. */
      const recorded = async () => {
        await clearOperatorStateCache();
        const { db: readDb } = await initOperatorState({ homeDir: home });
        const loaded = await new SqliteMissionStore(readDb).load(missionId(SLUG));
        assert.equal(loaded.kind, 'found', 'the mission must stay readable');
        const found = loaded as { mission: Mission; version: number };
        return { dependencies: found.mission.dependencies ?? [], version: found.version };
      };

      // --- add, and read it back out of the database ------------------------
      let current = (await recorded()).version;
      assert.equal(
        await invoke(['depends', 'add', '--slug', SLUG, '--on', OTHER, '--expected-version', String(current)]),
        0,
        errors.join('\n'),
      );
      assert.deepEqual((await recorded()).dependencies, [OTHER]);

      // --- a stale version is rejected and changes nothing ------------------
      assert.equal(
        await invoke(['depends', 'remove', '--slug', SLUG, '--on', OTHER, '--expected-version', String(current)]),
        1,
      );
      assert.match(errors.join('\n'), /expected version/);
      assert.deepEqual((await recorded()).dependencies, [OTHER], 'the stale write changed nothing');

      // --- a self-reference is refused --------------------------------------
      current = (await recorded()).version;
      assert.equal(
        await invoke(['depends', 'add', '--slug', SLUG, '--on', SLUG, '--expected-version', String(current)]),
        1,
      );
      assert.match(errors.join('\n'), /cannot depend on itself/);

      // --- an id that is not a Mission is refused ---------------------------
      assert.equal(
        await invoke(['depends', 'add', '--slug', SLUG, '--on', 'task-does-not-exist', '--expected-version', String(current)]),
        1,
      );
      assert.match(errors.join('\n'), /dependency is not a mission/);
      assert.deepEqual((await recorded()).dependencies, [OTHER], 'neither refusal wrote a row');

      // --- remove ------------------------------------------------------------
      assert.equal(
        await invoke(['depends', 'remove', '--slug', SLUG, '--on', OTHER, '--expected-version', String(current)]),
        0,
        errors.join('\n'),
      );
      assert.deepEqual((await recorded()).dependencies, []);
    } finally {
      await clearOperatorStateCache();
      if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

// TASK-2441 (was test/task-2441-mission-title-repro.test.ts)
describe('Mission title', () => {
  // TASK-2702: recorded Mission titles remain authoritative after an edit,
  // even when a historical Backlog input has a different title.
  const TITLE = 'Restore title visibility';
  const STORED_TITLE = 'Saved mission title';
  const CLOSED_AT = '2026-08-29T12:00:00.000Z';

  /** One mission per board lane the regression was reported on. */
  const LANES = [
    { id: 'task-4401', backlogStatus: 'active', domainStatus: 'active', lane: 'active', completed: false },
    { id: 'task-4402', backlogStatus: 'review', domainStatus: 'review', lane: 'review', completed: false },
    { id: 'task-4403', backlogStatus: 'approved', domainStatus: 'integration', lane: 'integration', completed: false },
    { id: 'task-4404', backlogStatus: 'done', domainStatus: 'done', lane: 'done', completed: true },
  ] as const;

  /** Recorded planning state and lifecycle are preserved together. */
  function persistedMission(id: string, status: MissionStatus, repository: ReturnType<typeof repositoryId>): Mission {
    return {
      id: missionId(id),
      repositoryId: repository,
      title: STORED_TITLE,
      labels: [],
      assignee: null,
      checkpoints: [],
      review: null,
      netEngineeringLines: null,
      status,
      closedAt: null,
    } as Mission;
  }

  function writeTask(root: string, id: string, status: string, completed: boolean): void {
    const dir = path.join(root, 'backlog', completed ? 'completed' : 'tasks');
    const file = path.join(dir, `${id} - restore-title-visibility.md`);
    fs.mkdirSync(dir, { recursive: true });
    const closed = completed ? `closedAt: '${CLOSED_AT}'\n` : '';
    fs.writeFileSync(file, `---\nid: ${id.toUpperCase()}\ntitle: ${TITLE}\nstatus: ${status}\n${closed}---\n`, 'utf8');
  }

  async function openStore(databasePath: string): Promise<{ database: SqliteDatabaseAdapter; store: SqliteMissionStore }> {
    const database = new SqliteDatabaseAdapter();
    await database.open({ path: databasePath });
    await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
    return { database, store: new SqliteMissionStore(database) };
  }

  test('board cards retain saved Mission titles across reload on every lane (TASK-2702)', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-2441-repository-')));
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-2441-home-')));
    const oldHome = process.env.PARALLIX_HOME;
    const repository = repositoryId(path.basename(root));
    const databasePath = path.join(home, 'parallix.db');
    process.env.PARALLIX_HOME = home;

    try {
      childProcess.spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
      childProcess.spawnSync('git', ['config', 'user.name', 'Task 2441'], { cwd: root, encoding: 'utf8' });
      childProcess.spawnSync('git', ['config', 'user.email', 'task-2441@example.test'], { cwd: root, encoding: 'utf8' });
      for (const lane of LANES) { writeTask(root, lane.id, lane.backlogStatus, lane.completed); }
      writeTask(root, 'task-4405', 'backlog', false);
      childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
      childProcess.spawnSync('git', ['commit', '-m', 'seed tasks'], { cwd: root, encoding: 'utf8' });

      const seeded = await openStore(databasePath);
      for (const lane of LANES) {
        const mission = persistedMission(lane.id, lane.domainStatus, repository);
        const version = await seeded.store.save({ ...mission, title: lane.domainStatus === 'done' ? STORED_TITLE : 'Before edit' }, null);
        if (lane.domainStatus !== 'done') {
          const result = await new MissionEditService(seeded.store).save({
            operationId: `edit-${lane.id}`, missionId: mission.id, expectedVersion: version,
            capabilities: new Set(['mission:context']), title: STORED_TITLE,
            description: '', context: '', labels: [], successCriteria: [], dependencies: [],
          });
          assert.equal(result.status, 'completed');
        }
      }
      await seeded.database.close();

      const opened = await openStore(databasePath);
      try {
        const board = composeBoardProjection({
          rootDir: root,
          missionStore: opened.store,
          repositoryId: repository,
          blocklistRepo: { async findAll() { return []; }, async findByAgent() { return undefined; }, async save() { throw new Error('Unexpected block save'); }, async deleteByAgent() { throw new Error('Unexpected block delete'); }, async clear() { throw new Error('Unexpected block clear'); } },
          historyRepo: { async findAll() { return []; }, async findByType() { return []; }, async append() { throw new Error('Unexpected history append'); }, async clear() { throw new Error('Unexpected history clear'); } },
          laneEventRepo: { async findAll() { return []; }, async findByMissionId() { return []; }, async findByRepositoryId() { return []; }, async append() { throw new Error('Unexpected lane append'); }, async clear() { throw new Error('Unexpected lane clear'); } },
          usageRepo: { async findAll() { return []; }, async findWhere() { return []; } },
          knownAgentFamilies: [],
        });
        const projection = await board.builder.build();
        const cards = new Map(projection.stages.flatMap((stage) => stage.cards.map((card) => [String(card.id), card])));

        assert.equal(cards.get('task-4405')?.title, TITLE, 'unimported inputs retain their Backlog title');
        for (const lane of LANES) {
          const card = cards.get(lane.id);
          assert.ok(card, `${lane.id} must be on the board (${lane.lane} lane)`);
          assert.equal(card.lane, lane.lane, `${lane.id} lane`);
          assert.equal(card.title, STORED_TITLE, `${lane.id} card title comes from the recorded Mission`);

          const output = await renderToString(
            React.createElement(MissionCard, { card, width: 60 }),
            { columns: 80 },
          );
          assert.ok(output.includes(STORED_TITLE), `${lane.lane} card must render "${STORED_TITLE}"; got:\n${output}`);
          assert.ok(!output.includes(TITLE), `${lane.lane} card must not render "${TITLE}"; got:\n${output}`);
          assert.ok(output.includes(lane.id), `${lane.lane} card must still render its slug`);
        }
      } finally {
        await opened.database.close();
      }
    } finally {
      if (oldHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = oldHome; }
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

test('CLI mutations preserve invalid-contract blockers, evidence and optimistic versions (TASK-2702)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-restart-'));
  const previousHome = process.env.PARALLIX_HOME;
  const home = path.join(root, 'state');
  process.env.PARALLIX_HOME = home;
  const id = missionId('task-restart');
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'none' } } }));
    const { db } = await initOperatorState({ homeDir: home });
    const store = new SqliteMissionStore(db);
    const blocker = { command: 'npm test', diagnostic: 'obsolete assertion', authorityReason: 'locked', proposedCorrection: 'correct assertion' } satisfies import("../../../src/domain/rebound-policy.js").InvalidContractBlocker;
    await store.save({ ...intakeMission({ id, repositoryId: repositoryId('parallix'), title: 'Restart fixture' }),
      brief: missionBrief({ goal: 'before', why: 'fixture', scope: null, outOfScope: [] }),
      checkpoints: [{ missionId: id, name: 'CP-1', goalCheck: [{ criterion: 'existing proof', evidence: 'test/unit/domain/checkpoint-repair-freshness-contract.test.ts' }], nextActionText: 'repair', repair: {
        incidentId: 'restart', command: 'npm test', authorizedGates: [], authorizedCriteria: [], attempt: 1,
        evidenceRecorded: false, verified: false, blocker,
      } }],
    } as Mission, null);
    const invoke = (args: string[]) => run(args, { baseCwd: root, log: () => '', error: () => '' });
    const before = await store.load(id); assert.equal(before.kind, 'found');
    if (before.kind !== 'found') { throw new Error('missing fixture'); }
    await clearOperatorStateCache();
    assert.equal(await invoke(['checkpoint', '--help', '--slug', id]), 0);
    const read = async () => new SqliteMissionStore((await initOperatorState({ homeDir: home })).db).load(id);
    const untouched = await read(); assert.equal(untouched.kind, 'found');
    if (untouched.kind !== 'found') { throw new Error('missing fixture'); }
    assert.deepEqual(untouched.mission.checkpoints[0].repair?.blocker, blocker);
    await clearOperatorStateCache();
    assert.equal(await invoke(['goal', 'set', '--slug', id, '--goal', 'after', '--why', 'retry', '--expected-version', String(before.version)]), 0);
    const restarted = await read(); assert.equal(restarted.kind, 'found');
    if (restarted.kind !== 'found') { throw new Error('missing fixture'); }
    assert.equal(restarted.mission.brief?.goal, 'after');
    assert.deepEqual(restarted.mission.checkpoints, before.mission.checkpoints);
    assert.equal(restarted.version, before.version + 1);
    assert.equal(restarted.mission.checkpoints[0].repair?.verified, false);
    await clearOperatorStateCache();
    assert.equal(await invoke(['goal', 'set', '--slug', id, '--goal', 'stale', '--why', 'stale', '--expected-version', String(before.version)]), 1);
    const unchanged = await read();
    assert.equal(unchanged.kind === 'found' && unchanged.mission.brief?.goal, 'after');
    assert.deepEqual(unchanged, restarted);
  } finally {
    await clearOperatorStateCache();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkpoint history and round replay survive production CLI re-records (TASK-2742)', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-checkpoint-history-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-checkpoint-repo-'));
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  try {
    fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Checkpoint fixture' }, adapters: { review: { provider: 'none' }, agents: {} },
    }));
    const id = missionId('task-checkpoint-replay-fixture');
    const { db } = await initOperatorState({ homeDir: home });
    const store = new SqliteMissionStore(db);
    await store.save({ ...intakeMission({ id, repositoryId: repositoryId('parallix'), title: 'Disposable evidence replay', labels: [], assignee: agentFamily('codex') }), status: 'active' } as Mission, null);
    const invoke = async (args: string[]) => {
      const output: string[] = [];
      const errors: string[] = [];
      const original = process.stdout.write;
      process.stdout.write = ((chunk: string) => { output.push(String(chunk)); return true; }) as typeof original;
      try {
        const code = await run(['checkpoint', ...args, '--slug', id], { baseCwd: repo, error: message => { errors.push(message); return message; } });
        return { code, output: output.join(''), errors: errors.join('\n') };
      } finally { process.stdout.write = original; }
    };
    const record = (evidence: string) => invoke(['record', '--name', 'CP-1', '--criterion', 'replay', '--evidence', evidence, '--next', 'inspect round state']);
    assert.equal((await record('original proof')).code, 0);
    const loaded = await store.load(id);
    if (loaded.kind !== 'found') { throw new Error('fixture missing'); }
    const reviewer = agentFamily('claude');
    const review = startReview({ change: { kind: 'local-branch', sourceBranch: `mission/${id}`, targetBranch: 'main' }, revision: changeRevision('fixture-head') }, reviewer, agentFamily('codex'), '2026-10-14T00:00:00Z', ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' }));
    await store.save({ ...loaded.mission, review, status: 'review' } as Mission, loaded.version);
    const before = await invoke(['round', '--round', '1']);
    assert.equal(before.code, 0, before.errors);
    assert.equal((await record('replacement proof')).code, 0);
    await clearOperatorStateCache();
    const latest = await invoke(['read']);
    assert.equal(JSON.parse(latest.output).checkpoints[0].goalCheck[0].evidence, 'replacement proof');
    const history = await invoke(['history']);
    assert.equal(history.code, 0, history.errors);
    const versions = JSON.parse(history.output);
    assert.deepEqual(versions.map((v: { checkpoint: { goalCheck: { evidence: string }[] } }) => v.checkpoint.goalCheck[0]?.evidence), ['original proof', 'replacement proof']);
    assert.equal(versions[1].recordedRound, 1);
    const replay = await invoke(['round', '--round', '1']);
    assert.deepEqual(JSON.parse(replay.output), JSON.parse(before.output));
    assert.deepEqual(JSON.parse(replay.output).versions, [1]);
    const missing = await invoke(['round', '--round', '99']);
    assert.equal(missing.code, 1);
    assert.match(missing.errors, /no checkpoint state.*99/);
    const { db: reopened } = await initOperatorState({ homeDir: home });
    const final = await new SqliteMissionStore(reopened).load(id);
    assert.equal(final.kind, 'found');
    if (final.kind === 'found') { assert.equal(final.version, loaded.version + 2, 'all subsequent reads leave the write version unchanged'); }
  } finally {
    await clearOperatorStateCache();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('public checkpoint check reports blocked and ready evidence without effects (TASK-2713)', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-readiness-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-readiness-repo-'));
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  try {
    const marker = path.join(repo, 'unexpected-gate');
    const gate = `node -e "require('fs').writeFileSync('${marker}', 'gate ran')"`;
    fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({ product: { name: 'Readiness fixture' }, adapters: {
      review: { provider: 'none' }, agents: {}, verification: { command: gate },
      gates: { preHandoff: [{ key: 'sentinel', command: gate }] },
    } }));
    fs.mkdirSync(path.join(repo, 'test'));
    fs.writeFileSync(path.join(repo, 'test', 'proof.test.ts'), '// disposable evidence reference');
    const id = missionId('task-readiness-fixture');
    const { db } = await initOperatorState({ homeDir: home });
    const store = new SqliteMissionStore(db);
    const blocker = { command: gate, diagnostic: 'requires operator choice', authorityReason: 'locked contract', proposedCorrection: 'operator decision' };
    const mission = { ...intakeMission({ id, repositoryId: repositoryId('parallix'), title: 'Readiness', labels: [], assignee: agentFamily('codex') }),
      status: 'active', brief: missionBrief({ goal: 'check evidence', why: 'read-only contract', scope: 'fixture', outOfScope: [] }),
      declaredGates: [gate], successCriteria: ['first', 'second'], completedSuccessCriteria: [0, 1], checkpoints: [
        { missionId: id, name: 'CP-1', nextActionText: 'continue', goalCheck: [{ criterion: 'first', evidence: 'test/proof.test.ts' }] },
        { missionId: id, name: 'CP-5', nextActionText: '', goalCheck: [] },
        { missionId: id, name: 'CP-6', nextActionText: 'all done; blocker resolved', goalCheck: [], repair: {
          incidentId: 'incident', command: gate, authorizedGates: [gate], authorizedCriteria: ['first', 'second'], attempt: 1,
          evidenceRecorded: false, verified: false, blocker,
        } },
      ],
    } as Mission;
    await store.save(mission, null);
    const invoke = async (args: string[]) => {
      const output: string[] = [];
      const errors: string[] = [];
      const original = process.stdout.write;
      process.stdout.write = ((chunk: string) => { output.push(String(chunk)); return true; }) as typeof original;
      try {
        const code = await run(args, { baseCwd: repo, error: message => { errors.push(message); return message; } });
        return { code, output: output.join(''), errors: errors.join('\n') };
      } finally { process.stdout.write = original; }
    };
    assert.match((await invoke(['checkpoint', '--help'])).output, /checkpoint check/);
    assert.match((await invoke(['--help'])).output, /check \[--json\].*read-only evidence readiness/);
    const snapshot = async () => ({ state: await store.load(id), history: await store.checkpointHistory(id),
      files: fs.readdirSync(repo), homeFiles: fs.readdirSync(home) });
    const before = await snapshot();
    const checked = await invoke(['checkpoint', 'check', '--slug', id, '--json']);
    assert.equal(checked.code, 0, checked.errors);
    const result = JSON.parse(checked.output);
    assert.equal(result.ready, false);
    assert.equal(result.version, before.state.kind === 'found' && before.state.version);
    assert.equal(result.primaryStopReason, 'human-only-contract-blocker');
    assert.deepEqual(result.findings.filter((item: { code: string }) => item.code === 'missing-checkpoint').map((item: { checkpoint: string }) => item.checkpoint), ['CP-5', 'CP-6']);
    assert.ok(result.findings.some((item: { code: string; criterion: string }) => item.code === 'uncovered-criterion' && item.criterion === 'second'));
    assert.match(result.findings[1].nextCommands[0], /px checkpoint record --name CP-5/);
    assert.deepEqual(await snapshot(), before, 'version, lifecycle, evidence history and repair state remain unchanged');
    assert.equal(fs.existsSync(marker), false);
    const loaded = await store.load(id);
    if (loaded.kind !== 'found') { throw new Error('fixture missing'); }
    await store.save({ ...loaded.mission, checkpoints: loaded.mission.checkpoints.map(cp => ({ ...cp, repair: undefined,
      goalCheck: cp.name === 'CP-1' ? cp.goalCheck : [{ criterion: 'second', evidence: 'test/proof.test.ts' }], nextActionText: 'review' })) } as Mission, loaded.version);
    const readyBefore = await snapshot();
    const ready = await invoke(['checkpoint', 'check', '--slug', id]);
    assert.equal(ready.code, 0, ready.errors);
    assert.deepEqual(JSON.parse(ready.output).findings, []);
    assert.equal(JSON.parse(ready.output).ready, true);
    assert.deepEqual(await snapshot(), readyBefore);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(path.join(repo, 'missions')), false);
  } finally {
    await clearOperatorStateCache();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
