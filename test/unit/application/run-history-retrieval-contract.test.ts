/**
 * Agent-run history capture and bounded retrieval contract (TASK-2643).
 *
 * The writer (src/adapters/filesystem/run-history-store.ts) and the
 * application reader (src/application/run-history.ts) are exercised together
 * over an isolated temporary worktree, because the contract is what a later
 * agent can retrieve from what an earlier run wrote.
 */
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { agentRunId, agentRunIdentity } from '../../../src/domain/agent-run.js';
import { missionRunsDir, openRunCapture, runHistoryFileSystem, runHistoryRoot } from '../../../src/adapters/filesystem/run-history-store.js';
import { getRun, listRuns, searchRuns, showRun, stripTerminalControl } from '../../../src/application/run-history.js';
import { MAX_RUN_SEARCH_HITS, MAX_RUN_SHOW_BYTES, MAX_RUNS_PER_MISSION, parseRunHistoryRef } from '../../../src/application/run-history-types.js';
import { scrubCredentials } from '../../../src/application/recovery-evidence.js';

let clock = 1_790_000_000_000;

function open(worktree: string, options: Partial<Parameters<typeof openRunCapture>[0]> = {}, missionId = 'task-9') {
  clock += 1000;
  const identity = agentRunIdentity({ repositoryKey: 'abc123', missionId, role: 'execute', family: 'codex', attempt: 1, startedAtMs: clock });
  const at = clock;
  return openRunCapture({ worktree, identity, runId: agentRunId(identity), terminalHost: 'pipe', now: () => new Date(at), ...options });
}

function scope(worktree: string, missionId = 'task-9', isAlive = (_pid: number) => true) {
  return { runsDir: missionRunsDir(worktree, missionId), fs: runHistoryFileSystem, isAlive };
}

test('overflow keeps the start and the end of the run and reports the dropped middle (TASK-2643)', () => {
  const worktree = mkdtemp('px-runs-overflow-');
  const capture = open(worktree, { segmentBytes: 1024, maxStreamBytes: 4096 });
  capture.write('stdout', Buffer.from('BEGIN-MARKER\n'));
  for (let i = 0; i < 40; i += 1) { capture.write('stdout', Buffer.from(`${String(i).padStart(4, '0')}${'.'.repeat(251)}\n`)); }
  capture.write('stdout', Buffer.from('FINAL-FAILURE E401\n'));
  const record = capture.finish({ exitCode: 1, signal: null });
  const stdout = record.streams.stdout;
  assert.equal(stdout.bytes, 13 + 40 * 256 + 19);
  assert.ok(stdout.retainedBytes <= 4096 && stdout.omitted.length === 1, 'one merged omitted range');
  const s = scope(worktree);
  assert.equal(searchRuns(s, { pattern: 'BEGIN-MARKER' }).totalHits, 1, 'the first segment is kept');
  const tail = searchRuns(s, { pattern: 'FINAL-FAILURE' });
  assert.equal(tail.totalHits, 1);
  assert.equal(tail.hits[0].offset, stdout.bytes - 19, 'offsets index the whole stream, not the retained bytes');
  assert.ok(tail.coverage.some(line => /omitted byte ranges/.test(line)));
  const dropped = showRun(s, { runId: record.runId, stream: 'stdout', offset: stdout.omitted[0].from + 10, length: 20 });
  assert.equal(dropped.ok, false);
  assert.equal(dropped.error, 'truncated');
  const exact = showRun(s, parseRunHistoryRef(tail.hits[0].ref)!);
  assert.equal(exact.text, 'FINAL-FAILURE', 'the reference names exactly the matched bytes');
});

test('alternate-screen and redraw output is searchable and cited at its raw byte offset (TASK-2643)', () => {
  const worktree = mkdtemp('px-runs-ansi-');
  const capture = open(worktree);
  const raw = 'progress 10%\r\x1b[2Kprogress 99%\r\n\x1b[?1049h\x1b[1;1H\x1b[31mtool failed: ENOENT ./scripts/x.sh\x1b[0m\x1b[?1049l\n';
  capture.write('stdout', Buffer.from(raw));
  const record = capture.finish({ exitCode: 1, signal: null });
  const result = searchRuns(scope(worktree), { pattern: 'failed: ENOENT' });
  assert.equal(result.totalHits, 1);
  assert.equal(result.hits[0].offset, Buffer.byteLength(raw.slice(0, raw.indexOf('failed'))));
  assert.doesNotMatch(result.hits[0].preview, /\x1b/, 'previews never carry terminal control');
  assert.equal(stripTerminalControl('\x1b]0;title\x07a\x1b[1mb\x1b[0m\r\n'), 'ab\n');
  assert.ok(record.sources.length === 0 && result.coverage.some(line => /stdout: \d+ of \d+ bytes retained/.test(line)));
});

test('configured redaction scrubs a credential split across chunks and is disclosed (TASK-2643)', () => {
  const worktree = mkdtemp('px-runs-redact-');
  const capture = open(worktree, { redactor: scrubCredentials });
  capture.write('stdout', Buffer.from('token: sk-abcdefghij'));
  capture.write('stdout', Buffer.from('klmnopqrstuvwxyz0123\nnext line\n'));
  const record = capture.finish({ exitCode: 0, signal: null });
  assert.equal(record.redacted, true);
  const s = scope(worktree);
  assert.equal(searchRuns(s, { pattern: 'sk-abcdefghij' }).totalHits, 0);
  assert.equal(searchRuns(s, { pattern: '<redacted-key>' }).totalHits, 1);
  assert.ok(getRun(s, record.runId).run!.coverage.some(line => /redaction ran/.test(line)));
});

test('a run whose supervisor died reads as interrupted and keeps the bytes it wrote (TASK-2643)', () => {
  const worktree = mkdtemp('px-runs-interrupted-');
  const capture = open(worktree, { supervisorPid: 4242, segmentBytes: 64, maxStreamBytes: 4096 });
  capture.write('stdout', Buffer.from(`${'x'.repeat(100)}\npartial failure before crash\n`));
  // No finish(): the harness was killed mid-run.
  const [run] = listRuns(scope(worktree, 'task-9', pid => pid !== 4242));
  assert.equal(run.state, 'interrupted');
  assert.ok(run.coverage.some(line => /interrupted/.test(line)));
  assert.equal(searchRuns(scope(worktree, 'task-9', () => false), { pattern: 'partial failure' }).totalHits, 1);
  assert.equal(listRuns(scope(worktree))[0].state, 'running', 'a live supervisor means the run is still live');
});

test('retrieval is confined to one Mission and refuses traversal or malformed records (TASK-2643)', () => {
  const worktree = mkdtemp('px-runs-scope-');
  const mine = open(worktree);
  mine.write('stdout', Buffer.from('mine\n'));
  mine.finish({ exitCode: 0, signal: null });
  const theirs = open(worktree, {}, 'task-10');
  theirs.write('stdout', Buffer.from('SECRET-OF-OTHER-MISSION\n'));
  const theirRecord = theirs.finish({ exitCode: 0, signal: null });
  const s = scope(worktree);
  assert.equal(searchRuns(s, { pattern: 'SECRET-OF-OTHER-MISSION' }).totalHits, 0);
  assert.equal(getRun(s, theirRecord.runId).error, 'missing', 'another Mission run id does not resolve here');
  assert.equal(getRun(s, '../task-10').error, 'access-denied');
  const bad = path.join(missionRunsDir(worktree, 'task-9'), 'execute-codex-a1-zzz');
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, 'run.json'), '{not json');
  assert.equal(getRun(s, 'execute-codex-a1-zzz').error, 'malformed');
  assert.equal(fs.readFileSync(path.join(runHistoryRoot(worktree), '.gitignore'), 'utf8'), '*\n', 'history never dirties the tree');
});

test('search and show stay bounded (TASK-2643)', () => {
  const worktree = mkdtemp('px-runs-bounds-');
  const capture = open(worktree);
  capture.write('stdout', Buffer.from('hit\n'.repeat(100) + 'y'.repeat(MAX_RUN_SHOW_BYTES * 2)));
  const record = capture.finish({ exitCode: 0, signal: null });
  const s = scope(worktree);
  const result = searchRuns(s, { pattern: 'hit', maxHits: 1000 });
  assert.equal(result.totalHits, 100);
  assert.equal(result.hits.length, MAX_RUN_SEARCH_HITS);
  const shown = showRun(s, { runId: record.runId, stream: 'stdout', offset: 0, length: MAX_RUN_SHOW_BYTES * 3 });
  assert.equal(shown.clamped, true);
  assert.ok(Buffer.byteLength(shown.text!) <= MAX_RUN_SHOW_BYTES);
});

test('retention keeps at most the TASK-2642 record budget per Mission, oldest retired first (TASK-2643)', () => {
  const worktree = mkdtemp('px-runs-retention-');
  const runsDir = missionRunsDir(worktree, 'task-9');
  for (let i = 0; i < MAX_RUNS_PER_MISSION; i += 1) {
    const dir = path.join(runsDir, `execute-codex-a1-old${i}`);
    fs.mkdirSync(dir, { recursive: true });
    const when = new Date(clock - (MAX_RUNS_PER_MISSION - i) * 1000);
    fs.utimesSync(dir, when, when);
  }
  open(worktree).finish({ exitCode: 0, signal: null });
  const remaining = fs.readdirSync(runsDir);
  assert.equal(remaining.length, MAX_RUNS_PER_MISSION);
  assert.equal(remaining.includes('execute-codex-a1-old0'), false, 'the oldest run is retired');
});
