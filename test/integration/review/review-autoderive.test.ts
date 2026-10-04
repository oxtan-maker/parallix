

/**
 * Test for review-loop implementer auto-derivation from the Backlog task.
 * Requires a temporary repo with a task file.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { createReviewLoopPorts } from '../../../src/adapters/review/review-loop.js';
import { runReviewLoop } from '../../../src/application/review-loop/review-loop.js';
import type { ReviewLoopRequest } from '../../../src/application/ports/review-round.js';
test.afterEach(() => mock.restoreAll());

/**
 * The bound review-loop mechanisms over the temporary repository: the real
 * Backlog task mirror reads the task file; reviewer routing is pinned.
 */
async function startReviewLoop(root: string, request: ReviewLoopRequest) {
  const logs: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const ports = createReviewLoopPorts(request.slug, { worktree: root }, { log: line => logs.push(line), error: line => errors.push(line), exit: code => exits.push(code) });
  await runReviewLoop(request, {
    ...ports,
    routing: { ...ports.routing, eligibleFamilies: () => ['codex', 'claude', 'gemini'], launcherStatus: agent => ({ supported: true, detail: agent }), nominate: () => 'claude' },
  });
  return { logs, errors, exits };
}


async function withTempRepo(fn) {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-review-autoderive-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workflow', 'config'), { recursive: true });

  // Initialize git repo with main branch so getPrimaryWorktree() works.
  // Use the portable two-step form because the verification environment also
  // supports Git versions predating `git init -b`.
  execSync('git init', { cwd: root, stdio: 'pipe' });
  execSync('git checkout -b main', { cwd: root, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'pipe' });
  fs.writeFileSync(path.join(root, 'README.md'), '# Test Repo');
  execSync('git add .', { cwd: root, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: root, stdio: 'pipe' });

  // Provide a minimal agents.json so eligibleAgentsForStep works.
  const agentsConfig = {
    steps: {
      review: { eligible: ['codex', 'claude', 'gemini'] }
    }
  };
  fs.writeFileSync(path.join(root, 'workflow', 'config', 'agents.json'), JSON.stringify(agentsConfig));

  process.chdir(root);

  try {
    await fn(root);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('review loop auto-derives implementer from backlog task', { concurrency: false }, async () => {

  await withTempRepo(async root => {
    const slug = 'task-999';
    const taskPath = path.join(root, 'backlog', 'tasks', `${slug} - test.md`);
    fs.writeFileSync(taskPath, '---\nid: TASK-999\nassignee: [claude]\n---\n');

    // dryRun: true never polls a provider or launches agents.
    const { logs } = await startReviewLoop(root, { slug, dryRun: true });

    // We expect it to reach the dryRun return point if auto-derivation worked
    assert.ok(
      logs.some(l => l.includes('Auto-derived implementer from backlog task: claude')),
      `Expected auto-derive log; got: ${logs.join(' | ')}`
    );
  });
});

test('review loop prioritizes explicit implementer over backlog task', { concurrency: false }, async () => {

  await withTempRepo(async root => {
    const slug = 'task-999';
    const taskPath = path.join(root, 'backlog', 'tasks', `${slug} - test.md`);
    fs.writeFileSync(taskPath, '---\nid: TASK-999\nassignee: [claude]\n---\n');

    const { logs } = await startReviewLoop(root, { slug, implementer: 'gemini', dryRun: true });

    assert.ok(
      logs.some(l => l.includes('Implementer: gemini')),
      `Expected implementer gemini in log; got: ${logs.join(' | ')}`
    );
    assert.ok(
      !logs.some(l => l.includes('Auto-derived')),
      'Should not have auto-derived when explicit implementer is provided'
    );
  });
});
