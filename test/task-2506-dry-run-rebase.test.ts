// TASK-2506: `px integrate --dry-run` must report whether a rebase is needed
// and whether it would conflict, without mutating the mission branch. These
// drive `predictIntegrationRebase` with an injected git runner so the decision
// logic (ancestor check and the virtual 3-way merge exit-code interpretation)
// is covered hermetically. Red-to-green: the export is new, so it is absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { predictIntegrationRebase } from '../src/adapters/cli/commands/integrate.js';

const SLUG = 'task-2506-dry';
const BRANCH = `mission/${SLUG}`;
const ROOT = '/tmp/base';

interface Case {
  name: string;
  missionSha: string;
  baseSha: string;
  mergeBase: string;
  mergeTreeStatus: number;
  expected: { needed: boolean, wouldConflict: boolean };
}

const CASES: Case[] = [
  {
    name: 'no rebase when the primary branch is already an ancestor of the mission',
    missionSha: 'mission', baseSha: 'base', mergeBase: 'base', mergeTreeStatus: 0,
    expected: { needed: false, wouldConflict: false },
  },
  {
    name: 'clean rebase when the primary advanced on an unrelated change',
    missionSha: 'mission', baseSha: 'main-advanced', mergeBase: 'base', mergeTreeStatus: 0,
    expected: { needed: true, wouldConflict: false },
  },
  {
    name: 'conflict when the primary advanced and the virtual merge conflicts',
    missionSha: 'mission', baseSha: 'main-advanced', mergeBase: 'base', mergeTreeStatus: 1,
    expected: { needed: true, wouldConflict: true },
  },
];

function makeGit(c: Case) {
  return (_args: string[]) => {
    const joined = _args.join(' ');
    if (joined.includes('rev-parse') && joined.includes(BRANCH)) { return { status: 0, stdout: c.missionSha, stderr: '' }; }
    if (joined.includes('rev-parse')) { return { status: 0, stdout: c.baseSha, stderr: '' }; }
    if (joined.includes('merge-base')) { return { status: 0, stdout: c.mergeBase, stderr: '' }; }
    if (joined.includes('merge-tree')) { return { status: c.mergeTreeStatus, stdout: '', stderr: '' }; }
    return { status: 0, stdout: '', stderr: '' };
  };
}

for (const c of CASES) {
  test(`predicts ${JSON.stringify(c.expected)} — ${c.name}`, () => {
    const prediction = predictIntegrationRebase(SLUG, {
      baseWorktree: ROOT,
      baseBranch: 'main',
      git: makeGit(c) as never,
    });
    assert.deepEqual(prediction, c.expected);
  });
}

test('predictIntegrationRebase falls back to main when no base branch is resolved', () => {
  const prediction = predictIntegrationRebase(SLUG, {
    baseWorktree: ROOT,
    baseBranch: '',
    git: makeGit(CASES[1] as Case) as never,
  });
  // Empty baseBranch -> target 'main'; merge-base ('base') != 'main' -> needed.
  assert.deepEqual(prediction, { needed: true, wouldConflict: false });
});
