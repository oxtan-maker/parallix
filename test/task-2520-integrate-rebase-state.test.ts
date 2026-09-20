// TASK-2520 SC7 / AC8: the integration-time rebase must inspect the mission
// worktree for an active rebase, not the base worktree. The rebase runs in the
// mission worktree, so a mid-rebase state there is the only one that matters;
// checking the base worktree always reports clean and a paused mission rebase
// is falsely reported as complete. Hermetic: the shared rebase workflow and git
// are injected doubles, so no worktree, real Forgejo, or agent is touched.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

const rebaseWorkflow = mockModule<typeof import('../src/application/rebase-workflow.js')>('../src/application/rebase-workflow.js', import.meta.url);
await installModuleMocks();
// The shared workflow is driven to a clean completion by the rebase port double;
// stub it so the only behaviour under test is the post-rebase in-progress check.
// Re-establish it per test: afterEach's mock.restoreAll() removes the stub.
test.beforeEach(() => { mock.method(rebaseWorkflow, 'runRebaseWorkflow', async () => {}); });
test.afterEach(() => mock.restoreAll());

const { createIntegrationRebase } = await import('../src/application/integrate/rebase.js');

const SLUG = 'task-2520-rebase';
const MISSION_WORKTREE = `/tmp/mission-${SLUG}`;
const BASE_WORKTREE = '/tmp/base-worktree';

/**
 * Build minimal ports for `createIntegrationRebase`. The rebase workflow port is
 * driven to a clean completion (exit 0) so the only thing under test is the
 * post-rebase in-progress check, which must read the mission worktree.
 */
function buildPorts({ missionRebaseInProgress }: { missionRebaseInProgress: boolean }) {
  const rebase = {
    createRebaseWorkflowPort: (opts: { exitFn: (code: number) => void }) => {
      opts.exitFn(0);
      return { cwd() {}, getCurrentBranch() {}, resolveMissionBaseBranch() {} };
    },
  };
  const landing = { createAbort: () => ({ isAbort: true }) };
  const missionPaths = {
    missionBranchName: (_slug: string) => `mission/${SLUG}`,
    conventionalWorktreePath: (_slug: string) => MISSION_WORKTREE,
    parseConflictFilesFromMergeOutput: () => [],
  };
  const git = mock.fn((args: string[]) => {
    const joined = args.join(' ');
    if (joined.includes('rebase') && args.includes('--show-current')) {
      // The rebase lives in the mission worktree; the base worktree is clean.
      if (args.includes(MISSION_WORKTREE)) {
        return { status: 0, stdout: missionRebaseInProgress ? SLUG : '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    if (joined.includes('rev-parse')) { return { status: 0, stdout: 'missionsha', stderr: '' }; }
    if (joined.includes('merge-base') && joined.includes('--is-ancestor')) { return { status: 0, stdout: '', stderr: '' }; }
    return { status: 0, stdout: '', stderr: '' };
  });
  const ports = {
    missionPaths: missionPaths as any,
    rebase: rebase as any,
    landing: landing as any,
    git: { git },
  };
  return ports as any;
}

test('integration rebase reports a paused rebase in the mission worktree (SC7)', async () => {
  const logs: string[] = [];
  mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
  mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });
  const ports = buildPorts({ missionRebaseInProgress: true });
  let aborted = false;
  try {
    await createIntegrationRebase(ports).runIntegrationRebase(SLUG, { baseWorktree: BASE_WORKTREE, baseBranch: 'main', git: ports.git.git });
  } catch (error) {
    aborted = (error as { isAbort?: boolean })?.isAbort === true;
  }
  assert.ok(aborted, 'a paused mission rebase aborts the integration rebase');
  assert.match(logs.join('\n'), /Integration-time rebase did not complete cleanly \(inProgress=true/,
    'a paused rebase in the mission worktree must be reported, not reported clean');
});

/**
 * Base not an ancestor of the mission HEAD: the resolved local base has not been
 * folded into the mission branch, so landing would squash onto a stale base.
 * This is the SC4 ancestry guard — the integration rebase must abort rather than
 * proceed to squash/merge against a base the mission does not build on.
 */
test('integration rebase aborts when the local base is not an ancestor of the mission (SC4)', async () => {
  const logs: string[] = [];
  mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
  mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });
  const ports = buildPorts({ missionRebaseInProgress: false });
  // Make the ancestry probe report the base is NOT an ancestor of the mission.
  const git = (args: string[]) => {
    const joined = args.join(' ');
    if (joined.includes('merge-base') && joined.includes('--is-ancestor')) { return { status: 1, stdout: '', stderr: '' }; }
    if (joined.includes('rebase') && args.includes('--show-current')) { return { status: 0, stdout: '', stderr: '' }; }
    if (joined.includes('rev-parse')) { return { status: 0, stdout: 'missionsha', stderr: '' }; }
    return { status: 0, stdout: '', stderr: '' };
  };
  let aborted = false;
  try {
    await createIntegrationRebase({ ...ports, git }).runIntegrationRebase(SLUG, { baseWorktree: BASE_WORKTREE, baseBranch: 'main', git });
  } catch (error) {
    aborted = (error as { isAbort?: boolean })?.isAbort === true;
  }
  assert.ok(aborted, 'a base that is not an ancestor of the mission aborts the integration rebase');
  assert.match(logs.join('\n'), /did not complete cleanly/,
    'the ancestry failure must surface as an incomplete rebase, not a clean completion');
});

test('integration rebase completes cleanly when no rebase is active in the mission worktree (SC7)', async () => {
  const ports = buildPorts({ missionRebaseInProgress: false });
  // A clean-start round exits 0 with no active rebase and an ancestor base, so
  // the integration rebase resolves without throwing.
  await createIntegrationRebase(ports).runIntegrationRebase(SLUG, { baseWorktree: BASE_WORKTREE, baseBranch: 'main', git: ports.git.git });
});
