const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Test for startReviewLoop auto-derivation from Backlog task.
 * Requires a temporary repo with a task file.
 */

async function withTempRepo(fn) {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-review-autoderive-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workflow', 'config'), { recursive: true });

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

async function captureExit(fn) {
  const originalExit = process.exit;
  const originalError = console.error;
  const originalLog = console.log;
  const errors = [];
  const logs = [];
  let exitCode = null;

  process.exit = (code) => {
    exitCode = code;
    throw new Error(`process.exit(${code})`);
  };
  console.error = (...args) => errors.push(args.join(' '));
  console.log = (...args) => logs.push(args.join(' '));

  try {
    await fn();
  } catch (err) {
    if (!err.message.startsWith('process.exit(')) throw err;
  } finally {
    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
  }

  return { exitCode, errors, logs };
}

test('startReviewLoop auto-derives implementer from backlog task', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  await withTempRepo(async root => {
    const slug = 'task-999';
    const taskPath = path.join(root, 'backlog', 'tasks', `${slug} - test.md`);
    fs.writeFileSync(taskPath, '---\nid: TASK-999\nassignee: [claude]\n---\n');

    const { exitCode, logs, errors } = await captureExit(() => {
      // dryRun: true prevents it from trying to poll Forgejo or launch agents
      // It should still fail eventually because there's no PR, but we want to see the auto-derive log
      return startReviewLoop(slug, {
        eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini'],
        dryRun: true
      });
    });

    // We expect it to reach the dryRun return point if auto-derivation worked
    assert.ok(
      logs.some(l => l.includes('Auto-derived implementer from backlog task: claude')),
      `Expected auto-derive log; got: ${logs.join(' | ')}`
    );
  });
});

test('startReviewLoop prioritizes explicit implementer over backlog task', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  await withTempRepo(async root => {
    const slug = 'task-999';
    const taskPath = path.join(root, 'backlog', 'tasks', `${slug} - test.md`);
    fs.writeFileSync(taskPath, '---\nid: TASK-999\nassignee: [claude]\n---\n');

    const { logs } = await captureExit(() => {
      return startReviewLoop(slug, {
        implementer: 'gemini',
        eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini'],
        workflowLauncherStatusFn: () => ({ supported: true, detail: 'mock' }),
        selectAgentFn: () => 'claude',
        dryRun: true
      });
    });

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
