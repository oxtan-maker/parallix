'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stats = require('../lib/commands/stats');
const { resolveStageTelemetry } = require('../lib/agents/stage-telemetry');

// task-1285 review F8: the unit tests cover renderMissionPhaseReport() in
// isolation; these exercise the `stats()` command function end-to-end so the
// mission-slug routing (positional slug detection, --mission flag, CSV-path
// fallback) is covered, not just the renderer.

function writeCsv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-route-'));
  const file = path.join(dir, 'stats.csv');
  fs.writeFileSync(file, [
    'date,mission,classification,implementer,pr_fix_rounds,provider,model,implementer_agent,reviewer_agent,stage,input_tokens,output_tokens,cached_tokens,context_tokens,tool_calls,openai_usage_before,openai_usage_after,openai_usage_delta,duration_minutes,cost_usd',
    '2026-06-13,task-1285,ai_sdlc,claude,0,anthropic,claude-opus-4-8,claude,,active,4000,900,300,5200,18,0,0,0,22,0',
  ].join('\n') + '\n', 'utf8');
  return { dir, file };
}

function capture(args) {
  const lines = [];
  let exitCode = null;
  stats(args, {
    log: msg => lines.push(String(msg)),
    error: msg => lines.push(String(msg)),
    exit: code => { exitCode = code; },
  });
  return { out: lines.join('\n'), exitCode };
}

test('stats command routes a positional mission slug to the phase report', () => {
  const { file } = writeCsv();
  const { out, exitCode } = capture(['task-1285', '--csv-file', file]);
  assert.equal(exitCode, null, 'should not exit with error');
  assert.match(out, /Mission telemetry by phase: task-1285/);
  assert.match(out, /\bexecute\b/);
  assert.match(out, /claude-opus-4-8/);
});

test('stats command routes the --mission flag to the phase report', () => {
  const { file } = writeCsv();
  const { out } = capture(['--mission', 'task-1285', '--csv-file', file]);
  assert.match(out, /Mission telemetry by phase: task-1285/);
});

test('stats command still treats an existing file positional as a CSV path', () => {
  const { file } = writeCsv();
  // A real file path (not a bare slug) must keep routing to the weekly/range
  // report path, not mission mode.
  const { out } = capture([file, '--today', '2026-06-13']);
  assert.doesNotMatch(out, /Mission telemetry by phase/);
  assert.match(out, /Current week/);
});

test('resolveStageTelemetry returns null when the launcher attached no telemetry', () => {
  assert.equal(resolveStageTelemetry({ worktree: os.tmpdir(), result: { startedAt: 'x' } }), null);
  assert.equal(resolveStageTelemetry({ worktree: os.tmpdir(), result: null }), null);
});

test('resolveStageTelemetry falls back to launcher telemetry when no codex rollout exists', () => {
  // os.tmpdir() has no codex rollout, so extractCodexTelemetry returns null and
  // the launcher-attached telemetry is used unchanged.
  const telemetry = { inputTokens: 42, provider: 'anthropic' };
  assert.deepEqual(resolveStageTelemetry({ worktree: os.tmpdir(), result: { telemetry }, sinceMs: 0 }), telemetry);
});
