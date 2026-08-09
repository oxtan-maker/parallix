

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const integrate = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const previousPrimaryWorktree = process.env.PRIMARY_WORKTREE;
if (previousPrimaryWorktree === undefined) {
  process.env.PRIMARY_WORKTREE = `/tmp/visualBoard-${process.pid}`;
}
if (previousPrimaryWorktree === undefined) {
  delete process.env.PRIMARY_WORKTREE;
} else {
  process.env.PRIMARY_WORKTREE = previousPrimaryWorktree;
}

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
      await integrate.default(['task-1086']);
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
      await integrate.default(['task-1086']);
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
    t.mock.method(missionUtils, 'inferSlug', () => null);
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
      // A missing slug reaches the usage guard immediately after the agent
      // authorization check. This test covers authorization only and must not
      // proceed into integration preflight or Forgejo discovery.
      await integrate.default([]);
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
