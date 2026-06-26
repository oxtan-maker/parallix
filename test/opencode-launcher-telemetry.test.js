'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const opencode = require('../lib/agents/opencode');
const { captureOpencodeExport } = require('../lib/agents/opencode-export');
const stats = require('../lib/commands/stats');

// Captured from a real `opencode export` (opencode v2.0.0, session
// ses_132f470d8ffexge85esdX0nzCs, model cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit,
// provider vllm). Reduced to what the parser reads: info.{id,tokens,model} plus
// the message/part skeleton (bulky tool input/output/preview payloads stripped),
// so the real export schema and the 59 tool-part count are preserved without
// committing a ~565 KB blob.
const FIXTURE = path.join(__dirname, 'fixtures', 'opencode-export-v2.json');

function resetInjections() {
  opencode.__setSpawnAndTeeForTest(null);
  opencode.__setExportCaptureForTest(null);
}

test.afterEach(resetInjections);

test('startOpencodeAgent attaches telemetry from the captured export', async () => {
  const exportJson = fs.readFileSync(FIXTURE, 'utf8');
  opencode.__setSpawnAndTeeForTest(async () => ({
    status: 0,
    stdout: 'Continue  opencode -s ses_132f470d8ffexge85esdX0nzCs\n',
    stderr: '',
  }));
  opencode.__setExportCaptureForTest(async () => exportJson);

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.ok(result.telemetry, 'telemetry must be attached');
  assert.equal(result.telemetry.provider, 'opencode');
  assert.ok(result.telemetry.inputTokens > 0);
  assert.ok(result.telemetry.outputTokens > 0);
  assert.equal(result.telemetry.toolCalls, 59);
});

test('startOpencodeAgent recovers the session id from opencode v2.0.0 JSON stdout', async () => {
  // Regression for task-1339: opencode v2.0.0 `run` no longer prints the
  // "Continue  opencode -s ses_..." footer, so the launcher must recover the
  // session id from the streamed `--format json` events (each line carries a
  // "sessionID":"ses_..." field). Without that recovery telemetry is dropped
  // and every custom stats row is zero.
  const exportJson = fs.readFileSync(FIXTURE, 'utf8');
  const jsonStdout = [
    '{"type":"step_start","timestamp":1,"sessionID":"ses_132f470d8ffexge85esdX0nzCs","part":{"type":"step-start"}}',
    '{"type":"text","timestamp":2,"sessionID":"ses_132f470d8ffexge85esdX0nzCs","part":{"type":"text","text":"Hi"}}',
    '{"type":"step_finish","timestamp":3,"sessionID":"ses_132f470d8ffexge85esdX0nzCs","part":{"type":"step-finish"}}',
    '',
  ].join('\n');
  let exportedSessionId = null;
  opencode.__setSpawnAndTeeForTest(async () => ({ status: 0, stdout: jsonStdout, stderr: '' }));
  opencode.__setExportCaptureForTest(async (sessionId) => { exportedSessionId = sessionId; return exportJson; });

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.equal(result.sessionId, 'ses_132f470d8ffexge85esdX0nzCs');
  assert.equal(exportedSessionId, 'ses_132f470d8ffexge85esdX0nzCs', 'export must be called with the recovered id');
  assert.ok(result.telemetry, 'telemetry must be attached from JSON-stdout session id');
  assert.ok(result.telemetry.inputTokens > 0);
  assert.ok(result.telemetry.outputTokens > 0);
});

test('startOpencodeAgent leaves telemetry unset when no session id is found', async () => {
  opencode.__setSpawnAndTeeForTest(async () => ({ status: 0, stdout: 'no marker here', stderr: '' }));
  let exportCalled = false;
  opencode.__setExportCaptureForTest(async () => { exportCalled = true; return null; });

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.equal(result.telemetry, undefined);
  assert.equal(exportCalled, false, 'export should be skipped without a session id');
});

test('startOpencodeAgent does not hang when the real export capture times out', async () => {
  // Use the REAL captureOpencodeExport with an injected child that never
  // exits, proving the launcher cannot block on a non-exiting `opencode export`.
  opencode.__setSpawnAndTeeForTest(async () => ({
    status: 0,
    stdout: 'opencode -s ses_neverexits\n',
    stderr: '',
  }));
  const hangingChild = new EventEmitter();
  hangingChild.stdout = new EventEmitter();
  hangingChild.kill = () => { hangingChild.killed = true; };
  opencode.__setExportCaptureForTest((sessionId, opts) =>
    captureOpencodeExport(sessionId, { ...opts, timeoutMs: 50, spawn: () => hangingChild }));

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.equal(result.sessionId, 'ses_neverexits');
  assert.equal(result.telemetry, undefined, 'timed-out export must not fabricate telemetry');
  assert.equal(hangingChild.killed, true, 'the hung export child must be killed');
});

test('startOpencodeAgent telemetry flows through to a non-zero stats CSV row', async () => {
  // End-to-end (criterion 6): launcher export attachment -> telemetry ->
  // stats-row creation, asserting durable non-zero token columns.
  const exportJson = fs.readFileSync(FIXTURE, 'utf8');
  opencode.__setSpawnAndTeeForTest(async () => ({
    status: 0,
    stdout: 'opencode -s ses_132f470d8ffexge85esdX0nzCs\n',
    stderr: '',
  }));
  opencode.__setExportCaptureForTest(async () => exportJson);

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-stats-'));
  const csv = path.join(dir, 'stats.csv');
  try {
    const fields = stats.telemetryToStatsFields(result.telemetry, {
      agentFamily: 'custom',
      durationMinutes: 5,
    });
    stats.upsertStatsRow(
      {
        date: '2026-06-15',
        mission: 'task-1316',
        classification: 'ai_sdlc',
        stage: 'active',
        implementer: 'custom',
        ...fields,
      },
      { filePath: csv, rootDir: dir },
    );

    const lines = fs.readFileSync(csv, 'utf8').trim().split('\n');
    const header = lines[0].split(',');
    const row = lines[1].split(',');
    const cell = (name) => row[header.indexOf(name)];

    assert.ok(Number(cell('input_tokens')) > 0, 'input_tokens must be non-zero in the CSV');
    assert.ok(Number(cell('output_tokens')) > 0, 'output_tokens must be non-zero in the CSV');
    assert.equal(cell('tool_calls'), '59');
    assert.equal(cell('provider'), 'opencode');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
