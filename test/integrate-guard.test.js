const test = require('node:test');
const assert = require('node:assert/strict');
// Set PRIMARY_WORKTREE to avoid module load time error
process.env.PRIMARY_WORKTREE = process.env.PRIMARY_WORKTREE || '/tmp/visualBoard';
const integrate = require('../lib/commands/integrate');

test('integrate guard', async (t) => {
  const originalExit = process.exit;
  const originalError = console.error;
  const originalLog = console.log;

  let exitCode = null;
  let errorOutput = '';

  const stubExit = (code) => {
    exitCode = code;
    throw new Error('process.exit called');
  };

  const stubError = (...args) => {
    errorOutput += args.join(' ') + '\n';
  };

  const stubLog = () => {};

  t.after(() => {
    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
  });

  await t.test('blocks FORGEJO_USER=gemini', async () => {
    process.exit = stubExit;
    console.error = stubError;
    console.log = stubLog;

    const oldUser = process.env.FORGEJO_USER;
    const oldAgent = process.env.WORKFLOW_AGENT;
    process.env.FORGEJO_USER = 'gemini';
    delete process.env.WORKFLOW_AGENT;

    exitCode = null;
    errorOutput = '';

    try {
      await integrate(['task-1086']);
    } catch (err) {
      if (err.message !== 'process.exit called') throw err;
    } finally {
      process.env.FORGEJO_USER = oldUser;
      process.env.WORKFLOW_AGENT = oldAgent;
      process.exit = originalExit;
      console.error = originalError;
      console.log = originalLog;
    }

    assert.strictEqual(exitCode, 1);
    assert.ok(errorOutput.includes('[FAIL] Gemini is not authorized to run integrate. Post a handoff comment on the PR and stop.'));
  });

  await t.test('blocks WORKFLOW_AGENT=gemini', async () => {
    process.exit = stubExit;
    console.error = stubError;
    console.log = stubLog;

    const oldUser = process.env.FORGEJO_USER;
    const oldAgent = process.env.WORKFLOW_AGENT;
    delete process.env.FORGEJO_USER;
    process.env.WORKFLOW_AGENT = 'gemini';

    exitCode = null;
    errorOutput = '';

    try {
      await integrate(['task-1086']);
    } catch (err) {
      if (err.message !== 'process.exit called') throw err;
    } finally {
      process.env.FORGEJO_USER = oldUser;
      process.env.WORKFLOW_AGENT = oldAgent;
      process.exit = originalExit;
      console.error = originalError;
      console.log = originalLog;
    }

    assert.strictEqual(exitCode, 1);
    assert.ok(errorOutput.includes('[FAIL] Gemini is not authorized to run integrate. Post a handoff comment on the PR and stop.'));
  });

  await t.test('does not block other agents (e.g. codex)', async () => {
    process.exit = stubExit;
    console.error = stubError;
    console.log = stubLog;

    const oldUser = process.env.FORGEJO_USER;
    const oldAgent = process.env.WORKFLOW_AGENT;
    process.env.FORGEJO_USER = 'codex';
    delete process.env.WORKFLOW_AGENT;

    exitCode = null;
    errorOutput = '';

    try {
      await integrate(['task-1086', '--dry-run']);
    } catch (err) {
      // It might call process.exit for other reasons (preflight fail), which is fine
    } finally {
      process.env.FORGEJO_USER = oldUser;
      process.env.WORKFLOW_AGENT = oldAgent;
      process.exit = originalExit;
      console.error = originalError;
      console.log = originalLog;
    }

    assert.ok(!errorOutput.includes('[FAIL] Gemini is not authorized to run integrate. Post a handoff comment on the PR and stop.'));
  });
});
