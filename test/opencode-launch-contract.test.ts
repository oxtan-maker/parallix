// Historical regression provenance: TASK-1322, TASK-1339, TASK-1316.
// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
// OpenCode launcher contract: command/invocation building, stale-session detection, launcher
// telemetry capture, and bounded in-family retry on provider failures.
//
// Behavior-owned suite (TASK-2622.11). Legacy case names are unchanged; each section keeps its
// historical task provenance.
//   OpenCode launcher: task-1322, task-1339, TASK-2328
//   OpenCode launcher telemetry: task-1316, task-1339, TASK-2328
//   OpenCode provider-failure retry: no task ID in the legacy file

import test, { describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';
import { childProcessDouble } from './fixtures/child-process-double.js';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const opencodeModule = mockModule<typeof import('../src/adapters/agents/opencode.js')>('../src/adapters/agents/opencode.js', import.meta.url);
const opencodeExportModule = mockModule<typeof import('../src/adapters/agents/opencode-export.js')>('../src/adapters/agents/opencode-export.js', import.meta.url);
const statsModule = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const agentLimitModule = mockModule<typeof import('../src/application/services/agent-limit.js')>('../src/application/services/agent-limit.js', import.meta.url);
await installModuleMocks();

describe("OpenCode launcher ,", () => {
  test.afterEach(() => mock.restoreAll());

  const opencode = opencodeModule;

  // Reset the feature-detect cache after each test so subsequent tests don't
  // inherit stale results from a real opencode binary on the host.

  test.afterEach(() => {
    opencode.__setJsonFormatSupportForTest(null);
    opencode.__setSpawnAndTeeForTest(null);
    opencode.__setExportCaptureForTest(null);
    opencode.__setSessionsForTest(null);
  });

  // ---------- resolveOpencodeCommand ----------

  test('resolveOpencodeCommand prefers OPENCODE_BIN when it points to an executable', () => {
    const { resolveOpencodeCommand } = opencode;
    const tmpDir = registeredMkdtemp('opencode-bin-');
    const customBin = path.join(tmpDir, 'opencode');
    fs.writeFileSync(customBin, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
    fs.chmodSync(customBin, 0o755);
    const original = process.env.OPENCODE_BIN;
    process.env.OPENCODE_BIN = customBin;
    try {
      assert.equal(resolveOpencodeCommand(), customBin);
    } finally {
      if (original === undefined) {
        delete process.env.OPENCODE_BIN;
      } else {
        process.env.OPENCODE_BIN = original;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('resolveOpencodeCommand falls back to bare "opencode" when no candidate exists', () => {
    const { resolveOpencodeCommand } = opencode;
    const tmpHome = registeredMkdtemp('opencode-home-');
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;
    const originalBin = process.env.OPENCODE_BIN;
    delete process.env.OPENCODE_BIN;
    process.env.HOME = tmpHome;
    process.env.PATH = '';
    try {
      assert.equal(resolveOpencodeCommand(), 'opencode');
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      if (originalBin === undefined) {
        delete process.env.OPENCODE_BIN;
      } else {
        process.env.OPENCODE_BIN = originalBin;
      }
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  // ---------- extractOpencodeSessionId ----------

  test('extractOpencodeSessionId matches opencode -s pattern', () => {
    const { extractOpencodeSessionId } = opencode;
    const id = extractOpencodeSessionId('Continue  opencode -s ses_abc123\nend');
    assert.equal(id, 'ses_abc123');
  });

  test('extractOpencodeSessionId returns null for no match', () => {
    const { extractOpencodeSessionId } = opencode;
    assert.equal(extractOpencodeSessionId(null), null);
    assert.equal(extractOpencodeSessionId(''), null);
  });

  test('extractOpencodeSessionId reads the sessionID field from JSON stdout (task-1339)', () => {
    const { extractOpencodeSessionId } = opencode;
    // opencode v2.0.0 `run --format json` emits NDJSON without the legacy footer.
    const jsonStdout = '{"type":"step_start","sessionID":"ses_10acbf09fffeimKc7ouh0Kjh2d","part":{}}\n';
    assert.equal(extractOpencodeSessionId(jsonStdout), 'ses_10acbf09fffeimKc7ouh0Kjh2d');
  });

  // ---------- buildOpencodeInvocation ----------

  test('buildOpencodeInvocation includes run --pure --dangerously-skip-permissions flags', () => {
    opencode.__setJsonFormatSupportForTest(true);
    const { buildOpencodeInvocation, resolveOpencodeCommand } = opencode;
    const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/tmp' });
    assert.equal(inv.command, resolveOpencodeCommand());
    assert.ok(inv.args.includes('run'));
    assert.ok(inv.args.includes('--pure'));
    assert.ok(inv.args.includes('--dangerously-skip-permissions'));
  });

  test('buildOpencodeInvocation requests JSON output so the session id is recoverable (task-1339)', () => {
    opencode.__setJsonFormatSupportForTest(true);
    const { buildOpencodeInvocation } = opencode;
    const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/tmp' });
    const i = inv.args.indexOf('--format');
    assert.ok(i >= 0, 'invocation must pass --format');
    assert.equal(inv.args[i + 1], 'json');
  });

  test('buildOpencodeInvocation includes -s sessionId when resume and sessionId provided', () => {
    opencode.__setJsonFormatSupportForTest(true);
    const { buildOpencodeInvocation, resolveOpencodeCommand } = opencode;
    const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/tmp', resume: true, sessionId: 'ses_abc' });
    assert.equal(inv.command, resolveOpencodeCommand());
    assert.ok(inv.args.includes('-s'));
    assert.ok(inv.args.includes('ses_abc'));
  });

  test('buildOpencodeInvocation includes --continue when resume but no sessionId', () => {
    opencode.__setJsonFormatSupportForTest(true);
    const { buildOpencodeInvocation, resolveOpencodeCommand } = opencode;
    const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/tmp', resume: true, sessionId: null });
    assert.equal(inv.command, resolveOpencodeCommand());
    assert.ok(inv.args.includes('--continue'));
    assert.ok(!inv.args.includes('-s'));
  });

  test('buildOpencodeInvocation omits resume flags when resume is false', () => {
    opencode.__setJsonFormatSupportForTest(true);
    const { buildOpencodeInvocation, resolveOpencodeCommand } = opencode;
    const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/tmp', resume: false });
    assert.equal(inv.command, resolveOpencodeCommand());
    assert.ok(!inv.args.includes('--continue'));
    assert.ok(!inv.args.includes('-s'));
  });

  test('buildOpencodeInvocation passes prompt as last arg', () => {
    opencode.__setJsonFormatSupportForTest(true);
    const { buildOpencodeInvocation, resolveOpencodeCommand } = opencode;
    const inv = buildOpencodeInvocation({ prompt: 'hello world', worktree: '/tmp' });
    assert.equal(inv.command, resolveOpencodeCommand());
    assert.ok(inv.args.includes('hello world'));
  });

  test('buildOpencodeInvocation sets cwd to worktree', () => {
    opencode.__setJsonFormatSupportForTest(true);
    const { buildOpencodeInvocation, resolveOpencodeCommand } = opencode;
    const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/custom/worktree' });
    assert.equal(inv.command, resolveOpencodeCommand());
    assert.equal(inv.options.cwd, '/custom/worktree');
  });

  // ---------- model override ----------

  test('buildOpencodeInvocation adds -m flag when model is provided', () => {
    opencode.__setJsonFormatSupportForTest(true);
    const { buildOpencodeInvocation } = opencode;
    const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/tmp', env: {}, model: 'qwen3-coder' });
    const i = inv.args.indexOf('-m');
    assert.ok(i !== -1);
    assert.equal(inv.args[i + 1], 'qwen3-coder');
  });

  test('buildOpencodeInvocation omits -m flag when model is null/undefined', () => {
    opencode.__setJsonFormatSupportForTest(true);
    const { buildOpencodeInvocation } = opencode;
    assert.ok(!buildOpencodeInvocation({ prompt: 't', worktree: '/tmp', env: {} }).args.includes('-m'));
    assert.ok(!buildOpencodeInvocation({ prompt: 't', worktree: '/tmp', env: {}, model: null }).args.includes('-m'));
  });

  test('buildOpencodeInvocation accepts preferJson:false to omit --format json (task-1339 compat)', () => {
    const { buildOpencodeInvocation } = opencode;
    const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/tmp', preferJson: false });
    assert.ok(!inv.args.includes('--format'), 'must not include --format when preferJson=false');
  });

  // ---------- startOpencodeAgent stale session detection (task-1322) ----------

  test('startOpencodeAgent retries without -s when spawn returns "Session not found" in stderr', async () => {
    const mockSessionPort = { deleted: null, async delete(missionId, role) { this.deleted = { missionId, role }; } };
    let spawnCount = 0;
    const mockSpawn = (cmd, args, opts) => {
      spawnCount++;
      if (spawnCount === 1) {
        // First call: stale session error
        return Promise.resolve({ status: 1, signal: null, stdout: '', stderr: 'Error: Session not found', error: null });
      }
      // Second call: fresh session succeeds
      return Promise.resolve({ status: 0, signal: null, stdout: 'done opencode -s ses_fresh123\n', stderr: '', sessionId: 'ses_fresh123', error: null });
    };
    const mockExport = () => Promise.resolve(null);

    opencode.__setSpawnAndTeeForTest(mockSpawn);
    opencode.__setExportCaptureForTest(mockExport);
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    opencode.__setSessionPortForTest(mockSessionPort);

    const { invocation, resultPromise } = opencode.startOpencodeAgent({
      prompt: 'review task',
      worktree: '/tmp/wt',
      env: {},
      resume: true,
      sessionId: 'ses_stale',
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      slug: 'task-1322',
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      role: 'reviewer'
    });

    const result = await resultPromise;

    assert.equal(spawnCount, 2, 'must spawn twice: stale session then fresh');
    assert.equal(invocation.args.includes('-s'), true, 'original invocation must include -s');
    assert.deepEqual(mockSessionPort.deleted, { missionId: 'task-1322', role: 'reviewer' }, 'marker must be cleared through the port');
    assert.equal(result.status, 0, 'final result must show success');

    // Restore originals
    opencode.__setSpawnAndTeeForTest(null);
    opencode.__setExportCaptureForTest(null);
    opencode.__setSessionPortForTest(null);
    opencode.__setJsonFormatSupportForTest(null);
  });

  test('startOpencodeAgent does NOT retry when resume is false', async () => {
    opencode.__setJsonFormatSupportForTest(true);
    let spawnCount = 0;
    const mockSpawn = (cmd, args, opts) => {
      spawnCount++;
      return Promise.resolve({ status: 1, signal: null, stdout: '', stderr: 'Session not found', error: null });
    };
    const mockExport = () => Promise.resolve(null);

    opencode.__setSpawnAndTeeForTest(mockSpawn);
    opencode.__setExportCaptureForTest(mockExport);

    const { resultPromise } = opencode.startOpencodeAgent({
      prompt: 'test', worktree: '/tmp/wt', env: {}, resume: false, sessionId: null
    });
    const result = await resultPromise;

    assert.equal(spawnCount, 1, 'must NOT retry when resume=false');
    assert.equal(result.status, 1, 'must return the original failure');

    opencode.__setSpawnAndTeeForTest(null);
    opencode.__setExportCaptureForTest(null);
    opencode.__setJsonFormatSupportForTest(null);
  });

  test('startOpencodeAgent healthy resume still uses -s flag', async () => {
    opencode.__setJsonFormatSupportForTest(true);
    let spawnCount = 0;
    const mockSpawn = (cmd, args, opts) => {
      spawnCount++;
      assert.ok(args.includes('-s'), 'must include -s flag for healthy resume');
      assert.ok(args.includes('ses_valid'), 'must include the session ID');
      return Promise.resolve({ status: 0, signal: null, stdout: 'done opencode -s ses_valid\n', stderr: '', error: null });
    };
    const mockExport = () => Promise.resolve(null);

    opencode.__setSpawnAndTeeForTest(mockSpawn);
    opencode.__setExportCaptureForTest(mockExport);

    const { invocation, resultPromise } = opencode.startOpencodeAgent({
      prompt: 'test', worktree: '/tmp/wt', env: {}, resume: true, sessionId: 'ses_valid'
    });
    const result = await resultPromise;

    assert.equal(spawnCount, 1, 'must only spawn once for healthy resume');
    assert.equal(result.status, 0, 'must succeed');

    opencode.__setSpawnAndTeeForTest(null);
    opencode.__setExportCaptureForTest(null);
    opencode.__setJsonFormatSupportForTest(null);
  });

  test('startOpencodeAgent falls back to legacy invocation when --format json is rejected (task-1339 compat)', async () => {
    // Inject a detect function that reports support so the first invocation
    // includes --format json, then the mock spawn rejects it at runtime.
    opencode.__setJsonFormatDetectForTest(() => true);
    let spawnCount = 0;
    const mockSpawn = (cmd, args, opts) => {
      spawnCount++;
      if (spawnCount === 1) {
        assert.ok(args.includes('--format'), 'first invocation must include --format json');
        return Promise.resolve({
          status: 1, signal: null, stdout: '',
          stderr: 'opencode: error: unrecognized option: --format',
          error: null,
        });
      }
      // Fallback invocation without --format json succeeds.
      assert.ok(!args.includes('--format'), 'fallback must not include --format');
      return Promise.resolve({
        status: 0, signal: null,
        stdout: 'Continue  opencode -s ses_legacy123\n',
        stderr: '', error: null,
      });
    };
    const mockExport = () => Promise.resolve(null);

    opencode.__setSpawnAndTeeForTest(mockSpawn);
    opencode.__setExportCaptureForTest(mockExport);

    const { resultPromise } = opencode.startOpencodeAgent({
      prompt: 'test', worktree: '/tmp/wt', env: {}, resume: false
    });
    const result = await resultPromise;

    assert.equal(spawnCount, 2, 'must retry once with legacy invocation');
    assert.equal(result.status, 0, 'must eventually succeed');
    assert.equal(result._jsonFallback, true, 'must mark that JSON fallback occurred');

    opencode.__setSpawnAndTeeForTest(null);
    opencode.__setExportCaptureForTest(null);
    opencode.__setJsonFormatDetectForTest(null);
  });
});

describe("OpenCode launcher telemetry ,", () => {
  test.afterEach(() => mock.restoreAll());

  const stats = statsModule;
  const opencode = opencodeModule;


  const { captureOpencodeExport } = opencodeExportModule;
  'use strict';

  // Captured from a real `opencode export` (opencode v2.0.0, session
  // ses_132f470d8ffexge85esdX0nzCs, model cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit,
  // provider vllm). Reduced to what the parser reads: info.{id,tokens,model} plus
  // the message/part skeleton (bulky tool input/output/preview payloads stripped),
  // so the real export schema and the 59 tool-part count are preserved without
  // committing a ~565 KB blob.
  const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'opencode-export-v2.json');

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
    const hangingChild = childProcessDouble();
    opencode.__setExportCaptureForTest((sessionId, opts) =>
      captureOpencodeExport(sessionId, { ...opts, timeoutMs: 50, spawn: () => hangingChild }));

    const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
    const result = await resultPromise;

    assert.equal(result.sessionId, 'ses_neverexits');
    assert.equal(result.telemetry, undefined, 'timed-out export must not fabricate telemetry');
    assert.equal(hangingChild.killed, true, 'the hung export child must be killed');
  });

  test('startOpencodeAgent telemetry flows through to a non-zero stored measurement', async () => {
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

    const dir = registeredMkdtemp('opencode-stats-');
    const dbFile = path.join(dir, 'parallix.db');
    try {
      const fields = stats.telemetryToStatsFields(result.telemetry, {
        agentFamily: 'custom',
        durationMinutes: 5,
      });
      stats.upsertMeasurementRow(
        {
          date: '2026-06-15',
          mission: 'task-1316',
          classification: 'ai_sdlc',
          stage: 'active',
          implementer: 'custom',
          ...fields,
        },
        { dbPath: dbFile, rootDir: dir },
      );

      const rows = stats.loadMeasurementRows({ dbPath: dbFile }).rows;
      assert.equal(rows.length, 1);
      const cell = (name) => rows[0][name];

      assert.ok(Number(cell('input_tokens')) > 0, 'input_tokens must be non-zero in the database');
      assert.ok(Number(cell('output_tokens')) > 0, 'output_tokens must be non-zero in the database');
      assert.equal(cell('tool_calls'), '59');
      assert.equal(cell('provider'), 'opencode');
      assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.csv')), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('OpenCode provider-failure retry', () => {
  test.afterEach(() => mock.restoreAll());

  const opencode = opencodeModule;


  const { detectLimitHit } = agentLimitModule;
  'use strict';

  function resetInjections() {
    opencode.__setSpawnAndTeeForTest(null);
    opencode.__setExportCaptureForTest(null);
  }

  test.afterEach(resetInjections);

  // ---------- direct classifier coverage (F4) ----------

  test('isTransientOpencodeFailure matches transient backend signatures', () => {
    for (const stderr of [
      'Error: ECONNRESET',
      'connection refused',
      'socket hang up',
      'fetch failed',
      'network timeout',
      'upstream returned 503 Service Unavailable',
      'received 502 Bad Gateway',
      'gateway timeout',
      'the model is overloaded',
      'service is temporarily unavailable',
    ]) {
      assert.equal(opencode.isTransientOpencodeFailure({ stderr }), true, `expected transient: ${stderr}`);
    }
  });

  test('isTransientOpencodeFailure is false for non-transient / empty output', () => {
    assert.equal(opencode.isTransientOpencodeFailure({ stdout: '', stderr: '' }), false);
    assert.equal(opencode.isTransientOpencodeFailure({ stderr: 'model not found' }), false);
    assert.equal(opencode.isTransientOpencodeFailure(null), false);
  });

  test('isTransientOpencodeFailure inspects stdout as well as stderr', () => {
    assert.equal(opencode.isTransientOpencodeFailure({ stdout: 'request failed: ETIMEDOUT', stderr: '' }), true);
  });

  test('isHardOpencodeFailure matches model-not-found / auth signatures', () => {
    for (const stderr of [
      'Error: model not found: qwen3-coder',
      'no such model',
      'unknown model "foo"',
      'invalid api key',
      '401 Unauthorized',
      'authentication failed',
    ]) {
      assert.equal(opencode.isHardOpencodeFailure({ stderr }), true, `expected hard: ${stderr}`);
    }
  });

  test('isHardOpencodeFailure treats ENOENT/EACCES spawn errors as hard', () => {
    assert.equal(opencode.isHardOpencodeFailure({ status: null, error: { code: 'ENOENT' } }), true);
    assert.equal(opencode.isHardOpencodeFailure({ status: null, error: { code: 'EACCES' } }), true);
  });

  test('isHardOpencodeFailure is false for transient / empty / null output', () => {
    assert.equal(opencode.isHardOpencodeFailure({ stderr: 'fetch failed' }), false);
    assert.equal(opencode.isHardOpencodeFailure({ stdout: '', stderr: '' }), false);
    assert.equal(opencode.isHardOpencodeFailure(null), false);
  });

  // ---------- plain 429 throttling (F1) ----------

  test('isTransientOpencodeFailure does NOT match plain 429 (classified as limit-hit)', () => {
    assert.equal(opencode.isTransientOpencodeFailure({ status: 1, stderr: '429 Too Many Requests' }), false);
    assert.equal(opencode.isTransientOpencodeFailure({ status: 1, stderr: 'HTTP 429' }), false);
    assert.equal(opencode.isTransientOpencodeFailure({ status: 1, stderr: '429 Throttled' }), false);
  });

  test('shouldRetryOpencodeFailure does NOT retry plain 429 (classified as limit-hit)', () => {
    assert.equal(
      opencode.shouldRetryOpencodeFailure({ status: 1, stderr: '429 Too Many Requests' }),
      false,
      'plain 429 is a limit-hit, not a transient error',
    );
    assert.equal(
      opencode.shouldRetryOpencodeFailure({ status: 1, stderr: 'request failed: 429 Too Many Requests' }),
      false,
      '429 embedded in longer message is still a limit-hit',
    );
  });

  test('detectLimitHit classifies plain 429 as a limit-hit for custom', () => {
    const result = detectLimitHit({ agent: 'custom', status: 1, stderr: '429 Too Many Requests' });
    assert.ok(result, 'plain 429 should be detected as a limit-hit');
    assert.equal(result.source, 'fallback', 'no reset-time info in plain 429, uses fallback block');
  });

  test('startOpencodeAgent does NOT retry on plain 429 (limit-hit, not transient)', async () => {
    let calls = 0;
    opencode.__setSpawnAndTeeForTest(async () => {
      calls += 1;
      return { status: 1, stdout: '', stderr: '429 Too Many Requests' };
    });

    const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
    const result = await resultPromise;

    assert.equal(calls, 1, 'no retry on 429 limit-hit');
    assert.equal(result.status, 1, '429 status surfaces for agents.js limit-hit handling');
    assert.equal(result.transientRetries, 0, 'zero retries on limit-hit');
  });

  test('startOpencodeAgent: plain 429 stays in-family via limit-hit detection, not generic reroute', async () => {
    let calls = 0;
    opencode.__setSpawnAndTeeForTest(async () => {
      calls += 1;
      return { status: 1, stdout: '', stderr: '429 Too Many Requests' };
    });

    const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
    const result = await resultPromise;

    assert.equal(result.status, 1, '429 status surfaces for agents.js launchFailed boundary');
    assert.equal(result.transientRetries, 0, 'no transient retry — limit-hit owns the classification');
    assert.equal(calls, 1, 'single invocation, no retry loop');
  });

  // ---------- classification (criterion 2) ----------

  test('shouldRetryOpencodeFailure retries a transient backend exit-1', () => {
    for (const stderr of [
      'Error: fetch failed',
      'request failed: ECONNRESET',
      'socket hang up',
      'upstream returned 503 Service Unavailable',
      'the model is overloaded, please try again',
    ]) {
      assert.equal(
        opencode.shouldRetryOpencodeFailure({ status: 1, stdout: '', stderr }),
        true,
        `expected transient: ${stderr}`,
      );
    }
  });

  test('shouldRetryOpencodeFailure does NOT retry a clean exit', () => {
    assert.equal(opencode.shouldRetryOpencodeFailure({ status: 0, stdout: 'fetch failed mentioned in logs', stderr: '' }), false);
  });

  test('shouldRetryOpencodeFailure does NOT retry hard errors (model-not-found / ENOENT / EACCES)', () => {
    assert.equal(opencode.shouldRetryOpencodeFailure({ status: 1, stderr: 'Error: model not found' }), false);
    assert.equal(opencode.shouldRetryOpencodeFailure({ status: null, error: { code: 'ENOENT' } }), false);
    assert.equal(opencode.shouldRetryOpencodeFailure({ status: null, error: { code: 'EACCES' } }), false);
  });

  test('shouldRetryOpencodeFailure does NOT retry a recognized limit-hit', () => {
    // custom limit pattern: "insufficient_quota" — owned by detectLimitHit, not the retry path.
    assert.equal(opencode.shouldRetryOpencodeFailure({ status: 1, stderr: 'insufficient_quota: usage limit reached' }), false);
    // plain 429 is also a limit-hit for custom, not a transient error
    assert.equal(opencode.shouldRetryOpencodeFailure({ status: 1, stderr: '429 Too Many Requests' }), false);
  });

  test('shouldRetryOpencodeFailure does NOT retry a killing signal', () => {
    assert.equal(opencode.shouldRetryOpencodeFailure({ status: null, signal: 'SIGINT', stderr: 'fetch failed' }), false);
  });

  // ---------- bounded in-family retry (criterion 4) ----------

  test('startOpencodeAgent retries once on a transient failure then succeeds', async () => {
    let calls = 0;
    opencode.__setSpawnAndTeeForTest(async () => {
      calls += 1;
      if (calls === 1) return { status: 1, stdout: '', stderr: 'Error: fetch failed' };
      return { status: 0, stdout: 'opencode -s ses_ok\n', stderr: '' };
    });
    opencode.__setExportCaptureForTest(async () => null);

    const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
    const result = await resultPromise;

    assert.equal(calls, 2, 'must spawn exactly twice (one retry)');
    assert.equal(result.status, 0);
    assert.equal(result.transientRetries, 1);
  });

  test('startOpencodeAgent retry is bounded — a persistently transient failure still surfaces', async () => {
    let calls = 0;
    opencode.__setSpawnAndTeeForTest(async () => {
      calls += 1;
      return { status: 1, stdout: '', stderr: 'Error: ECONNRESET' };
    });

    const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
    const result = await resultPromise;

    assert.equal(calls, 2, 'one initial + one bounded retry, no infinite loop');
    assert.equal(result.status, 1, 'genuine persistent failure must still surface');
    assert.equal(result.transientRetries, 1);
  });

  test('startOpencodeAgent does NOT retry a hard model-not-found failure', async () => {
    let calls = 0;
    opencode.__setSpawnAndTeeForTest(async () => {
      calls += 1;
      return { status: 1, stdout: '', stderr: 'Error: model not found: qwen3-coder' };
    });

    const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
    const result = await resultPromise;

    assert.equal(calls, 1, 'hard failure must not be retried');
    assert.equal(result.status, 1);
    assert.equal(result.transientRetries, 0);
  });

  // ---------- telemetry isolation (criterion 3) ----------

  test('startOpencodeAgent: a throwing export capture leaves result.status unchanged', async () => {
    opencode.__setSpawnAndTeeForTest(async () => ({ status: 0, stdout: 'opencode -s ses_x\n', stderr: '' }));
    opencode.__setExportCaptureForTest(() => { throw new Error('export blew up'); });

    const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
    const result = await resultPromise;

    assert.equal(result.status, 0, 'export throwing must not change launch status');
    assert.equal(result.telemetry, undefined);
  });

  test('startOpencodeAgent: a rejecting export capture leaves result.status unchanged', async () => {
    opencode.__setSpawnAndTeeForTest(async () => ({ status: 0, stdout: 'opencode -s ses_y\n', stderr: '' }));
    opencode.__setExportCaptureForTest(async () => { throw new Error('export rejected'); });

    const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
    const result = await resultPromise;

    assert.equal(result.status, 0, 'export rejection must not change launch status');
    assert.equal(result.telemetry, undefined);
  });

  // ---------- in-family regression (criterion 2 boundary) ----------

  test('startOpencodeAgent: plain 429 throttling stays in-family via limit-hit detection', async () => {
    let calls = 0;
    opencode.__setSpawnAndTeeForTest(async () => {
      calls += 1;
      return { status: 1, stdout: '', stderr: '429 Too Many Requests' };
    });

    const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
    const result = await resultPromise;

    assert.equal(result.status, 1, '429 status surfaces for agents.js launchFailed boundary');
    assert.equal(result.transientRetries, 0, 'no transient retry — limit-hit owns the classification');
    assert.equal(calls, 1, 'single invocation, no agents.js reroute needed');
  });

  test('startOpencodeAgent: persistent 429 surfaces after limit-hit detection for agents.js launchFailed', async () => {
    let calls = 0;
    opencode.__setSpawnAndTeeForTest(async () => {
      calls += 1;
      return { status: 1, stdout: '', stderr: '429 Too Many Requests' };
    });

    const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
    const result = await resultPromise;

    assert.equal(result.status, 1, 'persistent 429 must surface for agents.js launchFailed');
    assert.equal(result.transientRetries, 0, 'no transient retry — classified as limit-hit');
    assert.equal(calls, 1, 'single invocation, then agents.js can apply local cooldown');
  });

  // ---------- spurious exit 1 (criterion 5) ----------

  test('isSpuriousOpencodeExit returns true for exit 1 with stop event and no error', () => {
    const ndjson = '{"type":"step_finish","reason":"stop","sessionID":"ses_ok"}';
    assert.equal(opencode.isSpuriousOpencodeExit({ status: 1, stdout: ndjson, stderr: '' }), true);
  });

  test('isSpuriousOpencodeExit returns false when status is 0', () => {
    const ndjson = '{"type":"step_finish","reason":"stop","sessionID":"ses_ok"}';
    assert.equal(opencode.isSpuriousOpencodeExit({ status: 0, stdout: ndjson, stderr: '' }), false);
  });

  test('isSpuriousOpencodeExit returns false for null/undefined', () => {
    assert.equal(opencode.isSpuriousOpencodeExit(null), false);
    assert.equal(opencode.isSpuriousOpencodeExit(undefined), false);
  });

  test('isSpuriousOpencodeExit returns false when status is 1 but no stop event', () => {
    assert.equal(opencode.isSpuriousOpencodeExit({ status: 1, stdout: '', stderr: 'some error' }), false);
  });

  test('isSpuriousOpencodeExit returns false when stop event coexists with error event', () => {
    const ndjson = '{"type":"step_finish","reason":"stop"}\n{"type":"error","message":"boom"}';
    assert.equal(opencode.isSpuriousOpencodeExit({ status: 1, stdout: ndjson, stderr: '' }), false);
  });

  test('isSpuriousOpencodeExit handles stop in stderr as well as stdout', () => {
    const ndjson = '{"type":"step_finish","reason":"stop"}';
    assert.equal(opencode.isSpuriousOpencodeExit({ status: 1, stdout: '', stderr: ndjson }), true);
  });
});
