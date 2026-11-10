

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';
const resolveStageTelemetryModule = mockModule<typeof import('../../../../src/adapters/agents/stage-telemetry.js')>('../../../../src/adapters/agents/stage-telemetry.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { resolveStageTelemetry } = resolveStageTelemetryModule;
'use strict';

// task-1285 review F8: the unit tests cover renderMissionPhaseReport() in
// isolation; these exercise the `stats.default()` command function end-to-end so the
// mission-slug routing is covered, not just the renderer.

test('resolveStageTelemetry returns null when the launcher attached no telemetry', () => {
  assert.equal(resolveStageTelemetry({ worktree: os.tmpdir(), result: {} }), null);
  assert.equal(resolveStageTelemetry({ worktree: os.tmpdir(), result: null }), null);
});

test('resolveStageTelemetry falls back to launcher telemetry when no codex rollout exists', () => {
  // os.tmpdir() has no codex rollout, so extractCodexTelemetry returns null and
  // the launcher-attached telemetry is normalized through the named owner.
  const telemetry = { inputTokens: 42, provider: 'anthropic' };
  assert.deepEqual(resolveStageTelemetry({ worktree: os.tmpdir(), result: { telemetry }, sinceMs: 0 }), {
    provenance: 'provider-reported', provider: 'anthropic', model: null,
    values: [{ name: 'input', value: 42, unit: 'tokens' }],
  });
});
