// Mission ad hoc lifecycle and context CLI contract: ad hoc Mission lifecycle, context CLI mutation, and
// dependency recording, and Mission title resolution across the CLI boundary.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Ad hoc lifecycle: TASK-2468
//   Context CLI: TASK-2521.03
//   Mission dependencies CLI: TASK-2521.04
//   Mission title: TASK-2441

import test, { describe, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import assert from 'node:assert/strict';
import { pxNodeArgs, resolvePxEntryLoader } from './lib/px-entry.js';
import { clearOperatorStateCache, initOperatorState } from '../src/adapters/sqlite/adapter-factory.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { run } from '../src/composition/create-cli.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionBrief } from '../src/domain/mission-brief.js';
import { intakeMission, missionId, missionLabels, type Mission, type MissionStatus } from '../src/domain/mission.js';
import { ConfiguredReviewerEligibility, changeRevision, startReview } from '../src/domain/review.js';
import { repositoryId } from '../src/domain/repository.js';
import { latestEvidencedCheckpoint } from '../src/domain/checkpoint.js';
import React from 'react';
import { renderToString } from 'ink';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { composeBoardProjection } from '../src/composition/board-projection.js';
import { MissionCard } from '../src/interfaces/tui/mission-card.js';

// TASK-2468 (was test/task-2468-adhoc-lifecycle-repro.test.ts)
describe('Ad hoc lifecycle', () => {
  // TASK-2468 reproduction: a free-text adhoc mission must reach `active` (and
  // beyond) on a DB-owned adhoc identity in a repository with no Backlog task.
  // This is the red-to-green anchor: on the parent commit the `task-` prefix guard
  // in `px active` refuses the adhoc identity, so the assertion below fails; it
  // passes once the DB-owned adhoc identity and lifecycle work land.
  //
  // Runs the real CLI end to end against stub `codex`/`opencode` binaries on a
  // fixture PATH — no real model, so it lives in the default suite.

  // Both the CLI under test and the stub agent's own `px` writes run from the
  // prebuilt bundle in the prebuilt integration lanes, skipping tsx's
  // multi-second start-up on each spawn.
  const PX = resolvePxEntryLoader();
  function runCommand(command, args, options = {}) {
    const result = childProcess.spawnSync(command, args, {
      encoding: 'utf8',
      ...options
    });
    if (result.error && result.status === null) {
      throw result.error;
    }
    return result;
  }

  function runGit(cwd, args, options = {}) {
    const result = runCommand('git', args, { cwd, ...options });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    return (result.stdout || '').trim();
  }

  function commandDir(command) {
    const resolved = maybeCommandPath(command);
    if (!resolved) {
      throw new Error(`Could not resolve command on PATH: ${command}`);
    }
    return resolved;
  }

  function maybeCommandPath(command) {
    for (const directory of (process.env.PATH || '').split(path.delimiter)) {
      if (!directory) {continue;}
      const candidate = path.join(directory, command);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Keep searching PATH.
      }
    }
    return null;
  }

  function writeExecutable(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    fs.chmodSync(filePath, 0o755);
  }

  function lifecycleStubSource() {
    // The stub is written to an extensionless file on the fixture PATH, so Node
    // loads it as CommonJS. Its own `require` calls are part of the generated
    // script and are unrelated to this file's module system.
    return `#!${process.execPath}
  const fs = require('node:fs');
  const path = require('node:path');

  // TASK-2521.03: activation refuses a mission whose contract draft never
  // finished, so a drafting agent records it through \`px\` — the same commands the
  // draft prompt names. The harness passes the CLI entry in the environment
  // because this stub runs as a bare executable on the fixture PATH.
  function px(args) {
    const entry = process.env.PARALLIX_E2E_PX_ENTRY;
    const loader = process.env.PARALLIX_E2E_PX_LOADER;
    if (!entry) { return null; }
    const run = require('node:child_process').spawnSync(
      process.execPath, (loader ? ['--import', loader] : []).concat([entry], args),
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    return run.status === 0 ? (run.stdout || '') : null;
  }

  // Each write prints the Mission's new version, so the stub chains writes from
  // that instead of re-reading \`px status\` between them: every \`px\` spawn
  // costs a full CLI start-up.
  function missionVersion(missionSlug) {
    const out = px(['status', missionSlug, '--json']);
    if (!out) { return null; }
    try { return String(JSON.parse(out).version); } catch (_) { return null; }
  }

  function writeChain(missionSlug, writes) {
    let v = missionVersion(missionSlug);
    for (const args of writes) {
      if (v === null) { return; }
      const out = px(args.concat(['--slug', missionSlug, '--expected-version', v]));
      try { v = out ? String(JSON.parse(out).version) : null; } catch (_) { v = null; }
    }
  }

  function recordMissionContract(missionSlug) {
    writeChain(missionSlug, [
      ['goal', 'set', '--goal', 'Exercise the real lifecycle with a deterministic stub agent',
        '--why', 'Protect the workflow surface from regression drift'],
      ['scope', 'set', '--scope', 'Run draft, active, review and integrate through the real CLI',
        '--out-of-scope', 'Real model execution'],
      ['gate', 'add', '--command', 'node -e ""'],
      ['criterion', 'add', '--text', 'The lifecycle reaches integration through the real CLI'],
      ['checkpoint', 'plan', '--name', 'CP-1', '--text', 'Execute the stub deliverable'],
      ['checkpoint', 'plan', '--name', 'CP-2', '--text', 'Ready the mission for review'],
      ['nel', 'set', '--predicted', 'Small'],
    ]);
  }

  function writeFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  function read(filePath) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  }

  function match(prompt, regex) {
    const found = prompt.match(regex);
    return found ? found[1].trim() : null;
  }

  const prompt = process.argv[process.argv.length - 1] || '';
  const slug = match(prompt, /(parallix-adhoc-[0-9]+|task-[a-z0-9-]+)/im)
    || match(prompt, /^Mode: act-on-review\\. Branch:\\s*mission\\/(task-[a-z0-9-]+)/im)
    || match(prompt, /^Mode: review\\. .*?Mission:\\s+.*?(task-[a-z0-9-]+)/im)
    || 'task-unknown';
  // Typed missions record the contract through px; the directory holds only
  // optional mission-local artifacts.
  const missionBaseDir = (() => {
    try {
      const cfg = JSON.parse(read(path.join(process.cwd(), 'workflow.config.json')) || '{}');
      return (cfg.adapters && cfg.adapters.missions && cfg.adapters.missions.baseDir) || 'missions';
    } catch (_) { return 'missions'; }
  })();
  const missionDir = match(prompt, /^Mission dir:\\s*(.+)$/m)
    || path.join(process.cwd(), missionBaseDir, slug);
  const reviewFindingsPath = match(prompt, /\\\`([^\\\`\\n]+-review-findings\\.md)\\\`/);
  const reviewOutcomePath = match(prompt, /\\\`([^\\\`\\n]+-review-outcome\\.md)\\\`/);
  const reviewVerdictPath = match(prompt, /\\\`([^\\\`\\n]+-review-verdict\\.txt)\\\`/);
  const resolutionPath = match(prompt, /\\\`([^\\\`\\n]+-round-resolution\\.md)\\\`/);
  const dispositionPath = match(prompt, /\\\`([^\\\`\\n]+-review-disposition\\.txt)\\\`/);

  if (process.argv.includes('--help')) {
    process.stdout.write('stub opencode help\\n');
    process.exit(0);
  }

  if (/^Mode: draft\\./m.test(prompt)) {
    recordMissionContract(slug);
    writeFile(path.join(missionDir, 'milestone-1.md'), '# Milestone 1\\n\\nTyped contract recorded.\\n');
  }

  if (/^Mode: execute after lock\\./m.test(prompt)) {
    writeFile(path.join(process.cwd(), 'deliverable.txt'), 'stub execute output\\n');
    writeChain(slug, [
      ['CP-1', 'Execute artifacts committed', 'Run review.'],
      ['CP-2', 'The lifecycle reaches integration through the real CLI', 'Approve the mission in review.'],
    ].map(([name, criterion, next]) => ['checkpoint', 'record', '--name', name,
      '--criterion', criterion, '--evidence', 'deliverable.txt:1', '--next', next]));
  }

  if (/^Mode: review\\./m.test(prompt)) {
    writeFile(reviewFindingsPath, '# Findings\\n\\nNo blocking findings. The lifecycle artifacts are present and consistent.\\n');
    writeFile(reviewOutcomePath, 'Verdict: approve\\n\\nLifecycle approved for integration.\\n');
    writeFile(reviewVerdictPath, 'approve\\n');
  }

  if (/^Mode: act-on-review\\./m.test(prompt)) {
    writeFile(resolutionPath, 'fixed_items: []\\npushed_back_items: []\\nparked_items: []\\nblocked_reason: ""\\n');
    writeFile(dispositionPath, 'CHANGES_MADE\\n');
  }

  process.stdout.write('{"sessionID":"ses_stubbed_opencode"}\\n');
  `;
  }

  function postIntegrateHookMarkerPath(repoRoot) {
    return path.join(repoRoot, 'post-integrate-hook.log');
  }

  function writePostIntegrateHookScript(repoRoot) {
    const scriptPath = path.join(repoRoot, 'scripts', 'e2e-post-integrate-hook.sh');
    const markerPath = postIntegrateHookMarkerPath(repoRoot);
    writeExecutable(scriptPath, [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `printf 'slug=%s base_worktree=%s base_branch=%s variant=%s\\n' "$INTEGRATE_HOOK_SLUG" "$INTEGRATE_HOOK_BASE_WORKTREE" "$INTEGRATE_HOOK_BASE_BRANCH" "$INTEGRATE_HOOK_VARIANT" >> ${JSON.stringify(markerPath)}`,
      ''
    ].join('\n'));
    return scriptPath;
  }

  function setupRepository({ slug, title, postIntegrateHook = false }) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-e2e-'));
    const repoRoot = path.join(tmpRoot, 'repo');
    const binDir = path.join(repoRoot, 'bin');
    const stateHome = path.join(tmpRoot, 'parallix-home');
    const reviewTmpDir = path.join(tmpRoot, 'review-artifacts');

    // Adhoc-only fixture: no backlog/ directory at all. The mission identity is
    // DB-owned (parallix-adhoc-<NNNN>), so this draft must reach `active` with no
    // Backlog task file — the red->green anchor for the free-text first-value
    // path (task-2468). Any backlog/ creation here would contradict the fixture.
    fs.mkdirSync(path.join(repoRoot, 'config'), { recursive: true });
    fs.mkdirSync(reviewTmpDir, { recursive: true });

    const agentStub = lifecycleStubSource();
    writeExecutable(path.join(binDir, 'opencode'), agentStub);
    writeExecutable(path.join(binDir, 'codex'), agentStub);
    fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
    fs.symlinkSync(commandDir('git'), path.join(binDir, 'git'));
    fs.symlinkSync(commandDir('bash'), path.join(binDir, 'bash'));
    fs.symlinkSync(commandDir('id'), path.join(binDir, 'id'));
    const bwrapPath = maybeCommandPath('bwrap');
    if (bwrapPath) {
      fs.symlinkSync(bwrapPath, path.join(binDir, 'bwrap'));
    }
    const graphifyPath = maybeCommandPath('graphify');
    if (graphifyPath) {
      fs.symlinkSync(graphifyPath, path.join(binDir, 'graphify'));
    }

    const adapters = {
      tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
      agents: { models: { custom: 'stub/custom' } },
      missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      verification: { command: ':', defaultArea: 'all' },
      review: { provider: 'none', tmpDir: reviewTmpDir }
    };

    if (postIntegrateHook) {
      const scriptPath = writePostIntegrateHookScript(repoRoot);
  // @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `integrate` absent from its inferred mock shape.
      adapters.integrate = { postIntegrateCommand: `./${path.relative(repoRoot, scriptPath)}` };
    }

    fs.writeFileSync(path.join(repoRoot, 'workflow.config.json'), JSON.stringify({
      product: {
        name: 'e2e-probe',
        targetUser: 'tests'
      },
      adapters
    }, null, 2));

    fs.writeFileSync(path.join(repoRoot, 'config', 'state-map.json'), JSON.stringify({
      ready: 'refined',
      approved: 'ready-for-integration'
    }, null, 2));

    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# E2E Probe\n', 'utf8');

    // `git init -b` was added in Git 2.28. Keep this real-Git E2E compatible
    // with older installations by creating the initial branch separately.
    runGit(repoRoot, ['init']);
    runGit(repoRoot, ['checkout', '-b', 'main']);
    runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
    runGit(repoRoot, ['config', 'user.name', 'Parallix E2E']);
    runGit(repoRoot, ['add', '.']);
    runGit(repoRoot, ['commit', '-m', 'initial test repo']);

    return {
      tmpRoot,
      repoRoot,
      binDir,
      stateHome,
      reviewTmpDir
    };
  }

  function workflowEnv(binDir, stateHome, repoRoot) {
    return {
      ...process.env,
      FORCE_COLOR: '0',
      FORGEJO_USER: 'custom',
      PRIMARY_WORKTREE: repoRoot,
      PARALLIX_HOME: stateHome,
      // The agent stub records the mission contract with `px`, the same commands
      // the draft prompt names, because activation now refuses an incomplete one.
      // It runs as a bare executable on the fixture PATH, so it cannot resolve
      // the CLI entry itself.
      PARALLIX_E2E_PX_ENTRY: PX.entry,
      PARALLIX_E2E_PX_LOADER: PX.loader,
      PATH: binDir
    };
  }

  // This test launches real CLI and agent-stub processes. Coverage instrumentation
  // and concurrent integration workers can delay startup beyond one minute even
  // though the fixture remains healthy, so keep the boundary bounded but give it
  // the same two-minute allowance used by the end-to-end workflow lane.
  function runWorkflow(repoRoot, env, args, timeout = 120000, { allowFailure = false } = {}) {
    const stdoutPath = path.join(os.tmpdir(), `parallix-e2e-stdout-${process.pid}-${Date.now()}.log`);
    const stderrPath = path.join(os.tmpdir(), `parallix-e2e-stderr-${process.pid}-${Date.now()}.log`);
    const stdoutFd = fs.openSync(stdoutPath, 'w');
    const stderrFd = fs.openSync(stderrPath, 'w');
    let result;
    try {
      result = childProcess.spawnSync(process.execPath, pxNodeArgs(PX, args), {
        cwd: repoRoot,
        env,
        timeout,
        stdio: ['ignore', stdoutFd, stderrFd]
      });
    } finally {
      fs.closeSync(stdoutFd);
      fs.closeSync(stderrFd);
    }
    result.stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
    result.stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, 'utf8') : '';
    fs.rmSync(stdoutPath, { force: true });
    fs.rmSync(stderrPath, { force: true });
    if (result.error && result.status === null) {
      throw result.error;
    }
    if (!allowFailure && result.status !== 0) {
      throw new Error(
        `px ${args.join(' ')} failed (status=${result.status}, signal=${result.signal}, error=${result.error ? result.error.message : 'none'})\n` +
        `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      );
    }
    return result;
  }

  function worktreePathFor(repoRoot, slug) {
    return path.resolve(repoRoot, '..', `${path.basename(repoRoot)}-${slug}`);
  }


  /**
   * The draft materializes the mission under the mission worktree's `missions/`
   * dir, so discover the adhoc slug there. The worktree is the sibling of the
   * base repo named `<repo>-<slug>` (the configured worktree pattern).
   */
  function missionDir(rootDir, slug) {
    return path.join(rootDir, 'missions', slug);
  }

  function discoverAdhocSlug(repoRoot) {
    const parent = path.dirname(repoRoot);
    const base = path.basename(repoRoot);
    const siblings = fs.existsSync(parent)
      ? fs.readdirSync(parent).filter((d) => d.startsWith(base + '-') && d !== base)
      : [];
    for (const sibling of siblings) {
      const missionsDir = path.join(parent, sibling, 'missions');
      if (!fs.existsSync(missionsDir)) {continue;}
      const entries = fs.readdirSync(missionsDir).filter((d) => !d.startsWith('.'));
      const adhoc = entries.find((d) => !d.startsWith('task-'));
      if (adhoc) {return adhoc;}
    }
    return null;
  }

  let sharedFixture: ReturnType<typeof setupRepository> | undefined;
  after(() => {
    if (sharedFixture) {
      fs.rmSync(sharedFixture.tmpRoot, { recursive: true, force: true });
    }
  });

  test('a free-text adhoc mission reaches active on a DB-owned adhoc identity in a Backlog-less repo', () => {
    const repo = setupRepository({ slug: 'fix-hello-world-greeting', title: 'fix hello world greeting' });
    sharedFixture = repo;
    const env = workflowEnv(repo.binDir, repo.stateHome, repo.repoRoot);

    runWorkflow(repo.repoRoot, env, ['draft', 'fix hello world greeting', '--agent', 'custom']);

    const slug = discoverAdhocSlug(repo.repoRoot);
    assert.ok(slug, 'draft must materialize an adhoc mission under missions/');
    assert.match(slug, /^(parallix-adhoc|adhoc)-/i, 'materialized identity must be adhoc-owned');

    const worktree = worktreePathFor(repo.repoRoot, slug);
    assert.ok(fs.existsSync(worktree), `expected mission worktree at ${worktree}`);

    // The red line on the parent commit: the `task-` prefix guard refuses this
    // with "slug must begin with task-". It passes once the DB-owned adhoc
    // identity and lifecycle work land.
    runWorkflow(worktree, env, ['active', slug, '--implementer', 'custom']);
  });

  // F9 (task-2468): Success Criterion 5 guards the draft-side rejection path this
  // mission edited (`resolveDraftTarget` / `resolveTaskFile` in draft-setup.ts /
  // draft-stats.ts). The prior CP-4 row cited active.test:220, a mission-start
  // test — a different command. This test runs the real `px draft` against a
  // Backlog-less repo with a missing `task-<N>` argument and asserts the
  // draft command itself rejects it (exit 1), not a sibling command.
  test('px draft task-<missing> rejects a missing task file at the draft boundary', () => {
    assert.ok(sharedFixture, 'the lifecycle fixture must be available for the draft rejection proof');
    const repo = sharedFixture;
    const env = workflowEnv(repo.binDir, repo.stateHome, repo.repoRoot);

    const result = runWorkflow(
      repo.repoRoot,
      env,
      ['draft', 'task-missing-missing'],
      60000,
      { allowFailure: true }
    );
    assert.equal(result.status, 1, 'px draft must reject a missing task file with a non-zero exit');
    assert.match(
      `${result.stdout}${result.stderr}`,
      /task.*(not found|ambiguous|could not be resolved)/i,
      'the draft rejection must name the missing/ambiguous task file'
    );
  });
});

// TASK-2521.03 (was test/task-2521-03-context-cli.integration.test.ts)
describe('Context CLI', () => {
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
   * `test/status-command-use-case.test.ts`.
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
});

// TASK-2521.04 (was test/task-2521.04-mission-dependencies.integration.test.ts)
describe('Mission dependencies CLI', () => {
  /**
   * TASK-2521.04 — `px depends add|remove` end to end.
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
        (process.stdout as unknown as { write: (_chunk: string) => boolean }).write = () => true;
        try {
          return await run([...args], { baseCwd: repo, error: (message) => { errors.push(message); return message; } });
        } finally { (process.stdout as unknown as { write: typeof write }).write = write; }
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
  /**
   * task-2441 — the Ink board must show a mission's real title on every lane.
   *
   * The board catalog comes from the Backlog Markdown, which owns the title
   * (`MISSION_FIELD_AUTHORITY.title` is `target-repository`). The SQLite mission
   * aggregate owns lifecycle state only, but it is seeded at `px draft` intake
   * time from the still-unfilled mission scaffold, so its stored title is the
   * literal `<Title> (task-NNNN)` placeholder from `templates/mission-scaffold.md`.
   *
   * Before the repair `composeBoardProjection` replaced the whole Markdown
   * mission with the stored aggregate, so every persisted mission card rendered
   * the placeholder instead of its title.
   */



  const TITLE = 'Restore title visibility';
  const PLACEHOLDER = '<Title>';
  const CLOSED_AT = '2026-08-29T12:00:00.000Z';

  /** One mission per board lane the regression was reported on. */
  const LANES = [
    { id: 'task-4401', backlogStatus: 'active', domainStatus: 'active', lane: 'active', completed: false },
    { id: 'task-4402', backlogStatus: 'review', domainStatus: 'review', lane: 'review', completed: false },
    { id: 'task-4403', backlogStatus: 'approved', domainStatus: 'integration', lane: 'integration', completed: false },
    { id: 'task-4404', backlogStatus: 'done', domainStatus: 'done', lane: 'done', completed: true },
  ] as const;

  /** The mission aggregate as `px draft` intake records it: scaffold title, real lifecycle. */
  function persistedMission(id: string, status: MissionStatus, repository: ReturnType<typeof repositoryId>): Mission {
    return {
      id: missionId(id),
      repositoryId: repository,
      title: `${PLACEHOLDER} (${id})`,
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

  test('board cards render the backlog title, not the mission scaffold placeholder, on every lane', async () => {
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
      childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
      childProcess.spawnSync('git', ['commit', '-m', 'seed tasks'], { cwd: root, encoding: 'utf8' });

      const seeded = await openStore(databasePath);
      for (const lane of LANES) {
        await seeded.store.save(persistedMission(lane.id, lane.domainStatus, repository), null);
      }
      await seeded.database.close();

      const opened = await openStore(databasePath);
      try {
        const board = composeBoardProjection({
          rootDir: root,
          missionStore: opened.store,
          repositoryId: repository,
          blocklistRepo: { async findAll() { return []; } } as never,
          historyRepo: { async findAll() { return []; }, async findByType() { return []; } } as never,
          laneEventRepo: { async findAll() { return []; } } as never,
          usageRepo: { async findAll() { return []; } } as never,
          knownAgentFamilies: [],
        });
        const projection = await board.builder.build();
        const cards = new Map(projection.stages.flatMap((stage) => stage.cards.map((card) => [String(card.id), card])));

        for (const lane of LANES) {
          const card = cards.get(lane.id);
          assert.ok(card, `${lane.id} must be on the board (${lane.lane} lane)`);
          assert.equal(card.lane, lane.lane, `${lane.id} lane`);
          assert.equal(card.title, TITLE, `${lane.id} card title comes from the Backlog task`);

          const output = await renderToString(
            React.createElement(MissionCard, { card, width: 60 } as never),
            { columns: 80 },
          );
          assert.ok(output.includes(TITLE), `${lane.lane} card must render "${TITLE}"; got:\n${output}`);
          assert.ok(!output.includes(PLACEHOLDER), `${lane.lane} card must not render "${PLACEHOLDER}"; got:\n${output}`);
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
