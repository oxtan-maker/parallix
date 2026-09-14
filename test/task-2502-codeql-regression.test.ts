// TASK-2502: regression tests for the two high-risk CodeQL findings fixed in this
// mission. Each test fails against the pre-fix code and passes after the fix, so
// the security boundary stays closed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { workflowLauncherStatus, setCommandPathProbe } from '../src/adapters/agents/launcher-selection.js';
import { buildEventFrontmatter } from '../src/adapters/review/review-events.js';

test('command path probe does not shell-inject the agent name', () => {
  // Force the real spawn path (no injected probe) so the shell command built by
  // commandInPath actually runs. A payload that would succeed only if the name
  // were interpolated into the shell string must leave no trace behind.
  const marker = path.join(os.tmpdir(), `task-2502-inject-${process.pid}-${Date.now()}`);
  setCommandPathProbe(null);
  try {
    const payload = `x" && touch "${marker} && echo "`;
    // Unknown family -> resolver returns the raw name -> commandInPath(name).
    workflowLauncherStatus(payload);
    assert.equal(fs.existsSync(marker), false, 'agent name reached the shell and was interpreted');
  } finally {
    setCommandPathProbe(null);
    try { fs.rmSync(marker, { force: true }); } catch (_) { /* ignore */ }
  }
});

test('buildEventFrontmatter round-trips a backslash and quote in blockedReason', () => {
  const event = {
    eventType: 'blocked_publication',
    timestamp: '2026-05-25T14:30:22.000Z',
    content: '',
    blockedReason: 'injection"; rm -rf / #',
  };

  const front = buildEventFrontmatter(event);

  // The quote is escaped to \" so the field does not terminate early; the value
  // survives verbatim inside the double-quoted field.
  assert.ok(front.includes('blocked_reason: "injection\\"; rm -rf / #"'), front);
});
