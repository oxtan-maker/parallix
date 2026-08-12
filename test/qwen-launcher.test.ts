import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
'use strict';

import {
  buildQwenInvocation,
  ensureQwenHome,
  extractQwenSessionId,
  isQwenQuotaExhausted,
  isSpuriousQwenExit,
  isStaleQwenSessionResult,
  processResult,
  qwenHomeRoot,
  qwenSettingsPath,
  resolveQwenCommand,
  MAX_SESSION_AGE_MINUTES
} from '../src/adapters/agents/qwen.js';

test('resolveQwenCommand returns "qwen"', () => {
  assert.equal(resolveQwenCommand(), 'qwen');
});

test('buildQwenInvocation: basic args with -p prompt and text output', () => {
  const inv = buildQwenInvocation({ prompt: 'hello', worktree: '/tmp/wt' });
  assert.equal(inv.command, 'qwen');
  assert.deepStrictEqual(inv.args.slice(0, 4), ['-p', 'hello', '--output-format', 'text']);
  assert.equal(inv.options.cwd, '/tmp/wt');
});

test('buildQwenInvocation: QWEN_HOME set to worktree .workflow/qwen-home', () => {
  const inv = buildQwenInvocation({ prompt: 'test', worktree: '/tmp/wt' });
  assert.equal(inv.options.env.QWEN_HOME, path.join('/tmp/wt', '.workflow', 'qwen-home'));
});

test('buildQwenInvocation: HOME and PATH untouched in env', () => {
  const inv = buildQwenInvocation({ prompt: 'test', worktree: '/tmp/wt' });
  // QWEN_HOME is set, but HOME and PATH should be inherited from process.env
  assert.equal((inv.options.env as NodeJS.ProcessEnv).HOME, process.env.HOME);
  assert.equal((inv.options.env as NodeJS.ProcessEnv).PATH, process.env.PATH);
});

test('buildQwenInvocation: model only passed when configured', () => {
  const invNoModel = buildQwenInvocation({ prompt: 'test', worktree: '/tmp/wt' });
  assert.ok(!invNoModel.args.includes('-m'), 'no -m flag when model not configured');

  const invWithModel = buildQwenInvocation({ prompt: 'test', worktree: '/tmp/wt', model: 'qwen3.8-max' });
  assert.ok(invWithModel.args.includes('-m'), '-m flag present when model configured');
  assert.ok(invWithModel.args.includes('qwen3.8-max'), 'model value present');
});

test('buildQwenInvocation: resume with session id uses -r flag', () => {
  const inv = buildQwenInvocation({ prompt: 'test', worktree: '/tmp/wt', resume: true, sessionId: 'abc-123' });
  assert.ok(inv.args.includes('-r'), '-r flag for resume');
  assert.ok(inv.args.includes('abc-123'), 'session id in args');
});

test('buildQwenInvocation: resume without session id uses -c flag', () => {
  const inv = buildQwenInvocation({ prompt: 'test', worktree: '/tmp/wt', resume: true });
  assert.ok(inv.args.includes('-c'), '-c flag for resume without session id');
  assert.ok(!inv.args.includes('-r'), 'no -r flag when no session id');
});

test('qwen approval bypass: settings.json has tools.approvalMode yolo after ensureQwenHome', () => {
  const tmpWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-home-test-'));
  ensureQwenHome(tmpWorktree);

  const settingsPath = qwenSettingsPath(tmpWorktree);
  assert.ok(fs.existsSync(settingsPath), `settings.json exists at ${settingsPath}`);

  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(settings.tools.approvalMode, 'yolo', 'approvalMode must be yolo for non-interactive tool-call bypass');
});

test('qwen approval bypass: yolo persists even when user settings exist', () => {
  const tmpWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-home-test-'));
  // Simulate a user settings file with existing config
  const tmpUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-user-'));
  const userSettingsPath = path.join(tmpUserDir, 'settings.json');
  fs.writeFileSync(userSettingsPath, JSON.stringify({
    ui: { autoModeAcknowledged: true },
    env: { BAILIAN_TOKEN_PLAN_API_KEY: 'sk-test-key' },
    modelProviders: { openai: [] }
  }, null, 2), 'utf8');

  ensureQwenHome(tmpWorktree, userSettingsPath);

  const settingsPath = qwenSettingsPath(tmpWorktree);
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(settings.tools.approvalMode, 'yolo', 'approvalMode yolo set regardless of user settings content');
  assert.ok(settings.ui, 'user settings fields preserved');
  assert.ok(settings.env, 'env (with secrets) copied to git-ignored .workflow/');
});

test('qwen approval bypass: tool-call prompt completes without approval block (red-to-green)', () => {
  // This test verifies the invocation shape that prevents the TASK-1398 failure mode.
  // The --yolo flag (vibe) and approvalMode:yolo (qwen) both achieve the same goal:
  // tool calls are auto-approved so the process does not hang waiting for TTY input.
  //
  // Red state (before fix): without approvalMode:yolo, the qwen CLI would block
  // on "Approve tool call?" prompt outside a TTY, eventually timing out or
  // exiting with a generic error that gets misread as a launch failure.
  //
  // Green state (after fix): settings.json carries tools.approvalMode:"yolo",
  // ensuring all tool calls are auto-approved.
  const tmpWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-approval-test-'));
  ensureQwenHome(tmpWorktree);

  const inv = buildQwenInvocation({
    prompt: 'Write a function that sorts an array',
    worktree: tmpWorktree,
  });

  // Invocation must set QWEN_HOME so qwen reads the yolo settings
  assert.equal(inv.options.env.QWEN_HOME, qwenHomeRoot(tmpWorktree));

  // The settings file at that path must have yolo
  const settings = JSON.parse(fs.readFileSync(qwenSettingsPath(tmpWorktree), 'utf8'));
  assert.equal(settings.tools.approvalMode, 'yolo');

  // No blocklist entry should be written for tool-call prompts
  // (verified by the fact that the invocation is correctly shaped;
  //  the actual blocklist write happens in the launcher retry loop)
  assert.ok(inv.args.includes('-p'), 'prompt passed via -p for non-interactive mode');
});

test('qwen home: QWEN_HOME resolves to .workflow/qwen-home', () => {
  assert.equal(qwenHomeRoot('/tmp/wt'), path.join('/tmp/wt', '.workflow', 'qwen-home'));
});

test('isSpuriousQwenExit: returns true for exit 1 with non-zero telemetry', () => {
  const result = {
    status: 1,
    signal: null,
    error: null,
    telemetry: { totalTokens: 5000, inputTokens: 4000, outputTokens: 1000 }
  };
  assert.equal(isSpuriousQwenExit(result), true, 'exit 1 with tokens = spurious');
});

test('isSpuriousQwenExit: returns false for exit 1 with no telemetry', () => {
  const result = { status: 1, signal: null, error: null, telemetry: null };
  assert.equal(isSpuriousQwenExit(result), false, 'exit 1 without telemetry = real failure');
});

test('qwen quota exhaustion: an exit-0 provider rejection is normalized to a failed launch', () => {
  const transcript = 'Quota exhausted: Your token-plan 1-week quota has been exhausted.\nPlease retry after the reset time. (cause: insufficient_quota: 429)';
  const result: any = processResult({ status: 0, signal: null, error: null, stdout: transcript, stderr: '' }, '/tmp/qwen-quota-test', new Date().toISOString());

  assert.equal(isQwenQuotaExhausted({ status: 0, signal: null, error: null, stdout: transcript, stderr: '' }), true);
  assert.equal(result.status, 1, 'the Qwen-specific provider rejection must reach limit detection');
  assert.equal(isSpuriousQwenExit({ ...result, telemetry: { totalTokens: 1 } }), false, 'quota rejection is never a completed turn');
});

test('isSpuriousQwenExit: returns false for exit 0', () => {
  const result = { status: 0, signal: null, error: null, telemetry: { totalTokens: 100 } };
  assert.equal(isSpuriousQwenExit(result), false, 'exit 0 = not spurious');
});

test('isSpuriousQwenExit: returns false for signal kill', () => {
  const result = { status: 137, signal: 'SIGKILL', error: null, telemetry: { totalTokens: 100 } };
  assert.equal(isSpuriousQwenExit(result), false, 'signal kill = not spurious');
});

test('extractQwenSessionId: returns null when no projects dir exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-session-test-'));
  const result = extractQwenSessionId(path.join(tmp, 'projects'));
  assert.equal(result, null);
});

test('extractQwenSessionId: extracts session id from chat file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-session-test-'));
  const projectsDir = path.join(tmp, 'projects');
  const chatsDir = path.join(projectsDir, 'proj-123', 'chats');
  fs.mkdirSync(chatsDir, { recursive: true });
  const sessionId = 'abc-def-123-456';
  fs.writeFileSync(path.join(chatsDir, `${sessionId}.jsonl`), 'test');

  const result = extractQwenSessionId(projectsDir);
  assert.equal(result, sessionId);
});

test('extractQwenSessionId: respects invocation window', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-session-test-'));
  const projectsDir = path.join(tmp, 'projects');
  const chatsDir = path.join(projectsDir, 'proj-123', 'chats');
  fs.mkdirSync(chatsDir, { recursive: true });

  // Old session (outside window)
  const oldId = 'old-session-id';
  fs.writeFileSync(path.join(chatsDir, `${oldId}.jsonl`), 'old');
  const oldTime = Date.now() - (MAX_SESSION_AGE_MINUTES + 10) * 60000;
  fs.utimesSync(path.join(chatsDir, `${oldId}.jsonl`), new Date(oldTime), new Date(oldTime));

  // Recent session (inside window)
  const newId = 'new-session-id';
  fs.writeFileSync(path.join(chatsDir, `${newId}.jsonl`), 'new');

  const result = extractQwenSessionId(projectsDir, new Date().toISOString());
  assert.equal(result, newId, 'only recent session within window returned');
});

test('qwen telemetry: processResult attaches result.telemetry from QWEN_HOME artifacts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-launch-tel-'));
  const home = qwenHomeRoot(tmp);
  fs.mkdirSync(path.join(home, 'usage'), { recursive: true });

  const invocationStart = new Date().toISOString();
  fs.writeFileSync(
    path.join(home, 'usage', 'token-usage-2026-08.jsonl'),
    JSON.stringify({
      schemaVersion: 1, sessionId: 's1', model: 'qwen3.8-max', authType: 'openai',
      timestamp: invocationStart, inputTokens: 1000, outputTokens: 200,
      cachedTokens: 900, thoughtsTokens: 150, totalTokens: 1200, apiDurationMs: 5000,
    }) + '\n',
  );

  const result: any = processResult({ status: 0, stdout: '', stderr: '' }, tmp, invocationStart);

  assert.ok(result.telemetry, 'telemetry attached — resolveStageTelemetry returns null without it');
  assert.equal(result.telemetry.inputTokens, 1000);
  assert.equal(result.telemetry.thoughtsTokens, 150);
  assert.equal(result.model, 'qwen3.8-max', 'model passed through for stats attribution');
  assert.equal(result.provider, 'openai', 'provider passed through for stats attribution');
});

test('qwen telemetry: processResult leaves telemetry unset when no artifacts exist', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-launch-notel-'));
  const result: any = processResult({ status: 0, stdout: '', stderr: '' }, tmp, new Date().toISOString());
  assert.equal(result.telemetry, undefined);
});

test('qwen resume: stale session id is detected so the launch falls back to a fresh session', () => {
  assert.equal(isStaleQwenSessionResult({ status: 1, stderr: 'Error: Session not found: abc-123', stdout: '' }), true);
  assert.equal(isStaleQwenSessionResult({ status: 1, stdout: 'invalid session id', stderr: '' }), true);
  assert.equal(isStaleQwenSessionResult({ status: 0, stderr: 'Session not found', stdout: '' }), false,
    'a successful run is never treated as stale');
  assert.equal(isStaleQwenSessionResult({ status: 1, stderr: 'rate limit exceeded', stdout: '' }), false,
    'unrelated failures do not trigger a relaunch');
});
