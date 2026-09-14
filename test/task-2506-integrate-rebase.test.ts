// TASK-2506 regression: `px integrate` must rebase the mission onto its
// primary/parent branch before the probe merge and gates. Before the fix the
// probe merge dead-ends with "Rebase the mission branch before integrating";
// after the fix the shared rebase workflow runs first, the probe merge is
// clean, and the mission lands. Hermetic: git, backlog, forgejo, stats,
// verification and mission services are all injected doubles, so no worktree,
// real Forgejo, or agent is touched.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const stats = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const verification = mockModule<typeof import('../src/adapters/verification/verification.js')>('../src/adapters/verification/verification.js', import.meta.url);
const composition = mockModule<typeof import('../src/composition/application-services.js')>('../src/composition/application-services.js', import.meta.url);
const integrateModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();
const integrate = integrateModule.default;

const SLUG = 'task-2506-intreg';
const BRANCH = `mission/${SLUG}`;
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2506-'));

/**
 * Stateful git double: the probe merge conflicts only until the integration
 * rebase has run, so the test is red before the fix (probe merge dead-ends)
 * and green after (rebase clears the conflict, probe merge is clean). The
 * rebase subcommand is matched as an exact arg element so the slug is never
 * confused with a rebase invocation.
 */
function installGitDoubles(rebased: { value: boolean }) {
  mock.method(git, 'getCurrentBranch', () => `mission/${SLUG}`);
  mock.method(git, 'git', (args: string[]) => {
    if (args.includes('rebase')) {
      if (args.includes('--show-current') || args.includes('--continue')) { return { status: 0, stdout: '', stderr: '' }; }
      rebased.value = true;
      return { status: 0, stdout: '', stderr: '' };
    }
    const joined = args.join(' ');
    if (joined.includes('merge-base') && joined.includes('--is-ancestor')) { return { status: 0, stdout: '', stderr: '' }; }
    // Plain merge-base: the primary is an ancestor of the mission after the
    // rebase, so it resolves to the same sha rev-parse returns.
    if (joined.includes('merge-base')) { return { status: 0, stdout: 'landed-sha', stderr: '' }; }
    if (args.includes('rev-parse')) { return { status: 0, stdout: 'landed-sha', stderr: '' }; }
    if (args.includes('show')) { return { status: 0, stdout: '2026-05-15T12:00:00+00:00', stderr: '' }; }
    if (joined.includes('merge') && joined.includes('--no-commit')) {
      return rebased.value
        ? { status: 0, stdout: '', stderr: '' }
        : { status: 1, stdout: 'CONFLICT (content): Merge conflict in src/app.ts\n', stderr: '' };
    }
    if (joined.includes('merge') && joined.includes('--abort')) {
      return rebased.value
        ? { status: 0, stdout: '', stderr: '' }
        : { status: 1, stdout: 'fatal: There is no merge to abort\n', stderr: '' };
    }
    if (joined.includes('merge') && joined.includes('--squash')) { return { status: 0, stdout: '', stderr: '' }; }
    if (joined.includes('commit')) { return { status: 0, stdout: '', stderr: '' }; }
    if (joined.includes('diff') && joined.includes('--cached')) { return { status: 0, stdout: 'src/app.ts\n', stderr: '' }; }
    if (joined.includes('...')) { return { status: 0, stdout: '', stderr: '' }; }
    if (joined.includes('symbolic-ref')) { return { status: 0, stdout: `mission/${SLUG}`, stderr: '' }; }
    if (joined.includes('ls-files')) { return { status: 0, stdout: '', stderr: '' }; }
    if (joined.includes('status')) { return { status: 0, stdout: '', stderr: '' }; }
    if (joined.includes('branch')) { return { status: 0, stdout: 'main\n', stderr: '' }; }
    return { status: 0, stdout: '', stderr: '' };
  });
}

/** Install every injected double shared by the task-2506 integrate tests. */
function installHarness() {
  const logs: string[] = [];
  mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
  mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });

  let status = 'integration';
  mock.method(missionUtils, 'inferSlug', () => SLUG);
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtils, 'getPrimaryWorktree', () => ROOT);
  mock.method(missionUtils, 'findMissionDir', () => path.join(ROOT, 'missions', SLUG));
  mock.method(missionUtils, 'findMissionArea', () => 'all');
  mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(ROOT, '..', SLUG));
  mock.method(missionUtils, 'resolveMainRepo', () => ROOT);
  mock.method(missionUtils, 'missionTitle', () => 'fixture');
  mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
  // ADR 0043 target the integration rebase rebases onto.
  mock.method(missionUtils, 'resolveMissionBaseBranch', () => 'main');
  mock.method(missionUtils, 'resolveWorktree', () => ROOT);
  mock.method(missionUtils, 'missionBranchName', (_slug: string) => `mission/${SLUG}`);

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(ROOT, 'backlog', 'tasks', 'task.md') }));
  mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
  mock.method(backlog, 'getTaskStatus', () => 'integration');
  mock.method(backlog, 'getTaskAssignee', () => 'codex');
  mock.method(backlog, 'getTaskImplementer', () => 'codex');
  mock.method(backlog, 'completeTask', () => true);

  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 1 }));
  mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
  mock.method(forgejo, 'listOpenPrsForSlug', () => []);
  mock.method(forgejo, 'readToken', () => 'token');
  mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
  mock.method(forgejo, 'syncMerged', () => ({ ok: true }));

  mock.method(stats, 'recordIntegrationStats', async () => ({ changed: false, row: { mission: SLUG }, data: { rows: [] }, report: 'none' }));
  mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
  mock.method(verification, 'captureVerifiedTreeProof', () => ({ ok: true, proof: { rootDir: ROOT, area: 'all', command: 'verify', commit: 'landed-sha', tree: 'tree' } }));
  mock.method(verification, 'assertVerifiedTreeProof', () => ({ ok: true }));
  mock.method(process, 'cwd', () => ROOT);
  mock.method(process, 'exit', () => {});

  mock.method(composition, 'createMissionApplicationServices', async () => ({
    store: { _repoId: 'default', load: async () => ({ kind: 'found', mission: { status, review: null }, version: 1 }) },
    integration: { decideIntegration: async () => { status = 'done'; return { status: 'completed', value: { mission: { status }, version: 2 } }; } },
    lifecycle: { transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }) },
    handoff: { recordNel: async () => ({}) },
  }));

  return { logs, getStatus: () => status };
}

test('behind-primary conflict-free mission integrates without a manual rebase (task-2506)', async () => {
  const rebased = { value: false };
  installGitDoubles(rebased);

  fs.mkdirSync(path.join(ROOT, 'backlog', 'tasks'), { recursive: true });
  // A real preIntegration gate that writes a marker file when it runs. This is
  // the evidence F3 requires: the gate actually executes (not skipped via
  // --no-integration-gates) against the rebased branch, so the marker proves a
  // gate ran after the rebase and before the probe merge.
  const markerPath = path.join(ROOT, 'gate-ran.txt');
  fs.writeFileSync(path.join(ROOT, 'workflow.config.json'), JSON.stringify({
    adapters: {
      verification: { command: 'true' },
      gates: { preIntegration: [{ key: 'marker', order: 0, command: `echo ran > ${markerPath}` }] },
    },
  }));

  const { logs, getStatus } = installHarness();

  try {
    await integrate([SLUG], { missionServicesFn: composition.createMissionApplicationServices });

    // The integration rebase must have run before the probe merge.
    assert.ok(rebased.value, 'px integrate must rebase the mission onto the primary branch before the probe merge');
    // A configured preIntegration gate must have executed against the rebased
    // branch (F3): the marker only exists when the gate ran, which happens after
    // the rebase and before the probe merge in the integrate() flow.
    assert.ok(fs.existsSync(markerPath), 'a configured integration gate must run against the rebased branch');
    // The mission must land end to end: the conflict-free probe merge only
    // succeeds once the rebase has applied the primary's ahead commit.
    assert.equal(getStatus(), 'done');
  } finally {
    mock.reset();
    fs.rmSync(ROOT, { recursive: true, force: true });
  }
});

// A `git` double for the dry-run test: the primary advanced on an unrelated
// change (merge-base != baseSha) so a rebase is required and clean (merge-tree
// exits 0), with a benign result for every other command.
function installDryRunGitDoubles(calls: string[][]) {
  mock.method(git, 'getCurrentBranch', () => `mission/${SLUG}`);
  mock.method(git, 'git', (args: string[]) => {
    calls.push(args.slice());
    const joined = args.join(' ');
    if (joined.includes('rev-parse') && joined.includes(BRANCH)) { return { status: 0, stdout: 'mission-sha', stderr: '' }; }
    if (joined.includes('rev-parse')) { return { status: 0, stdout: 'base-sha', stderr: '' }; }
    if (joined.includes('merge-base')) { return { status: 0, stdout: 'other-sha', stderr: '' }; }
    if (joined.includes('merge-tree')) { return { status: 0, stdout: '', stderr: '' }; }
    if (joined.includes('branch')) { return { status: 0, stdout: 'main\n', stderr: '' }; }
    return { status: 0, stdout: '', stderr: '' };
  });
}

test('px integrate --dry-run reports a needed rebase and mutates nothing (task-2506)', async () => {
  const calls: string[][] = [];
  installGitDoubles({ value: false });
  installDryRunGitDoubles(calls);

  fs.mkdirSync(path.join(ROOT, 'backlog', 'tasks'), { recursive: true });
  // No preIntegration gates configured: the dry run plans only and executes
  // nothing, so non-mutation is observable purely through the git calls.
  fs.writeFileSync(path.join(ROOT, 'workflow.config.json'), JSON.stringify({
    adapters: { verification: { command: 'true' } },
  }));

  const { logs } = installHarness();

  try {
    await integrate([SLUG, '--dry-run'], { missionServicesFn: composition.createMissionApplicationServices });

    // The dry-run branch must report that a rebase is required.
    assert.match(logs.join('\n'), /Rebase required/);
    // --dry-run must never start a rebase or attempt a probe merge: the shared
    // rebase workflow and the probe merge are only invoked on the live path.
    for (const args of calls) {
      assert.ok(
        !(args.includes('rebase') && !args.includes('--show-current') && !args.includes('--continue')),
        `dry-run must not start a rebase: ${args.join(' ')}`,
      );
      assert.ok(
        !(args.includes('merge') && (args.includes('--no-commit') || args.includes('--squash'))),
        `dry-run must not attempt a probe merge: ${args.join(' ')}`,
      );
    }
  } finally {
    mock.reset();
    fs.rmSync(ROOT, { recursive: true, force: true });
  }
});
