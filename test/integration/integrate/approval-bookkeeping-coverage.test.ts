// TASK-2620 AC11: an approval of revision A covers A plus recognised Parallix
// bookkeeping commits only. Real Git, so this is an integration-ci test.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createGitChangeIdentity } from '../../../src/adapters/git/change-identity.js';
import { missionApprovalCoverage } from '../../../src/application/approval-coverage.js';
import { bookkeepingCommitMessage } from '../../../src/domain/approval-coverage.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { applyReviewerCommand, changeRevision, ConfiguredReviewerEligibility, startReview } from '../../../src/domain/review.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2620-bookkeeping-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const branch = 'mission/task-2620';

function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** A mission branch with one approved commit A. */
function approvedBranch(name: string): { root: string; approved: string } {
  const root = path.join(tmp, name);
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(root, 'feature.ts'), 'export const v = 1;\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'base');
  git(root, 'checkout', '-qb', branch);
  fs.writeFileSync(path.join(root, 'feature.ts'), 'export const v = 2;\n');
  git(root, 'commit', '-qam', 'mission change');
  return { root, approved: git(root, 'rev-parse', 'HEAD') };
}

function approval(revision: string) {
  return applyReviewerCommand(startReview(
    { change: { kind: 'local-branch', sourceBranch: branch, targetBranch: 'main' }, revision: changeRevision(revision) },
    agentFamily('codex'), agentFamily('custom'), '2026-09-30T00:00:00Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('codex')], strategy: 'random' }),
  ), { type: 'approve', decidedAt: '2026-09-30T00:01:00Z', comment: null, source: { kind: 'local' } });
}

test('an approval of A covers A plus a recognised pre-commit-hook bookkeeping commit', () => {
  const { root, approved } = approvedBranch('bookkeeping');
  // The integrate pre-commit hook reformats code: a real diff, but Parallix bookkeeping.
  fs.writeFileSync(path.join(root, 'feature.ts'), 'export const v = 2; // formatted\n');
  git(root, 'commit', '-qam', bookkeepingCommitMessage('chore(task-2620): integrate pre-commit hook', 'pre-commit-hook'));
  assert.equal(missionApprovalCoverage(approval(approved), createGitChangeIdentity(root))?.kind, 'covers');
});

test('an unrecognised commit after A makes the approval stale, even after bookkeeping', () => {
  const { root, approved } = approvedBranch('work');
  fs.writeFileSync(path.join(root, 'feature.ts'), 'export const v = 2; // formatted\n');
  git(root, 'commit', '-qam', bookkeepingCommitMessage('chore(task-2620): integrate pre-commit hook', 'pre-commit-hook'));
  fs.writeFileSync(path.join(root, 'feature.ts'), 'export const v = 3;\n');
  git(root, 'commit', '-qam', 'repair');
  assert.equal(missionApprovalCoverage(approval(approved), createGitChangeIdentity(root))?.kind, 'stale');
});

test('an unknown bookkeeping kind is not whitelisted', () => {
  const { root, approved } = approvedBranch('unknown-kind');
  fs.writeFileSync(path.join(root, 'feature.ts'), 'export const v = 4;\n');
  git(root, 'commit', '-qam', 'sneaky\n\nParallix-Bookkeeping: anything');
  assert.equal(missionApprovalCoverage(approval(approved), createGitChangeIdentity(root))?.kind, 'stale');
});
