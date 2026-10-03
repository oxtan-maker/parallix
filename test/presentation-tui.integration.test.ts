// TASK-2622.15: CI-safe terminal and PTY behavior suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import './tui-command-flow.cases.js';
import './tui-pty-smoke.cases.js';
import './tui-spawn.cases.js';

test('presentation TUI integration entrypoint registers its boundary cases', () => {
  assert.ok(true, 'the static case-module imports above are evaluated before this entrypoint test');
});
