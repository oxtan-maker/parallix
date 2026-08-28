// Regression test for task-2419: `px status <slug>` must report the Forgejo PR
// of the *requested* mission's branch, not the PR of whatever branch the
// command happens to run on.
//
// At the mission's parent commit this test is RED: `StatusCommandUseCase`
// passes the current branch (`mission/task-2402`) to `getPrInfo`, so the
// recorded branch is `mission/task-2402`, not the requested `mission/task-2419`.
// After the fix it is GREEN.

import test from 'node:test';
import assert from 'node:assert/strict';
import { StatusCommandUseCase } from '../src/application/status-command-use-case.js';
import type {
  StatusBoardPort,
  StatusGitPort,
  StatusPrPort,
  StatusAgentPort,
  StatusStaleWorktreesPort,
} from '../src/application/ports/cli-workflows.js';

// A current branch for a *different* mission than the requested slug.
const CURRENT_BRANCH = 'mission/task-2402';
// The requested slug resolves to this branch under the default adapter
// (branchPrefix 'mission/'), independent of the current branch.
const REQUESTED_BRANCH = 'mission/task-2419';

test('StatusCommandUseCase: PR lookup uses the requested mission branch, not the current branch', async () => {
  let capturedBranch: string | undefined;

  const mockBoard: StatusBoardPort = {
    inferSlug() { return null; },
    async getMissionData() {
      return {
        backlogStatus: 'active',
        checkpoint: 'CP-1.md',
        checkpointDescription: 'Initial checkpoint',
        reviewHistory: [],
      };
    },
  };

  const mockGit: StatusGitPort = {
    getCurrentBranch() { return CURRENT_BRANCH; },
    // Mirror the default adapter: the requested slug resolves to the 'mission/'
    // prefix branch regardless of the current branch.
    missionBranchName(slug: string) { return 'mission/' + slug; },
    getRebaseInfo() { return null; },
    getLastThreeCommits() { return []; },
    getUncommittedCount() { return 0; },
  };

  const mockPr: StatusPrPort = {
    getPrInfo(branch: string) {
      capturedBranch = branch;
      return { exists: true, number: 339, state: 'open' };
    },
  };

  const mockAgent: StatusAgentPort = {
    getAgentMatrix() { return []; },
    getAgentOverride() { return undefined; },
  };

  const mockStale: StatusStaleWorktreesPort = {
    findStaleWorktrees() { return []; },
    getStaleWorktreeRebase() { return {}; },
  };

  const useCase = new StatusCommandUseCase(mockBoard, mockGit, mockPr, mockAgent, mockStale);
  const result = await useCase.execute('/tmp/repo', 'task-2419');

  // SC1: the branch passed to getPrInfo equals the requested mission's branch
  // and differs from the current branch.
  assert.equal(capturedBranch, REQUESTED_BRANCH);
  assert.notEqual(capturedBranch, CURRENT_BRANCH);
  assert.equal(result.prInfo?.number, 339);
});
