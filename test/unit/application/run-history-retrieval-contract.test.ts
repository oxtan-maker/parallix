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
import { createRunHistoryStore, correlateRunOperation, missionRunsDir, openRunCapture, preserveWorktreeRunHistory, runHistoryFileSystem, runHistoryRoot } from '../../../src/adapters/filesystem/run-history-store.js';
import { getRun, listRuns, searchRuns, showRun, stripTerminalControl } from '../../../src/application/run-history.js';
import { MAX_RUN_SEARCH_HITS, MAX_RUN_SHOW_BYTES, MAX_RUNS_PER_MISSION, parseRunHistoryRef } from '../../../src/application/run-history-types.js';
import { scrubCredentials } from '../../../src/application/recovery-evidence.js';
import { createMissionTerminalService } from '../../../src/application/mission-terminal.js';
import type { MissionHistoryError, MissionTerminalHostPort, MissionTerminalSessionsResult } from '../../../src/application/ports/mission-terminal.js';

let clock = 1_790_000_000_000;

function open(worktree: string, options: Partial<Parameters<typeof openRunCapture>[0]> = {}, missionId = 'task-9') {
  clock += 1000;
  const identity = agentRunIdentity({ repositoryId: 'abc123', missionId, role: 'execute', family: 'codex', attempt: 1, startedAtMs: clock });
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

function hostDouble(sessions: MissionTerminalSessionsResult = { ok: true, sessions: null }) {
  const calls: string[] = [];
  const host: MissionTerminalHostPort & { result: MissionTerminalSessionsResult } = {
    result: sessions,
    sessions() { return this.result; },
    capture(_identity, session, window) { calls.push(`capture ${session}:${window ?? 'console'}`); return { ok: true, output: 'live pane text\n' }; },
    attach(_identity, session, readOnly) { calls.push(`attach ${session} ${readOnly}`); return 0; },
    close(_identity, session) { calls.push(`close ${session}`); },
    retire(_identity, session) { calls.push(`retire ${session}`); },
  };
  return { host, calls };
}

function service(repositoryRoot: string, options: { host?: MissionTerminalHostPort; worktree?: string | null; repositoryKey?: string; isAlive?: (_pid: number) => boolean; renderer?: { render: (_family: string, _text: string) => string }; fs?: typeof runHistoryFileSystem; executionAlive?: (_execution: { pid: number; processIdentity: string | null }) => boolean | null } = {}) {
  const store = createRunHistoryStore({ repositoryRoot, repositoryKey: options.repositoryKey ?? 'abc123', resolveWorktree: () => options.worktree ?? null });
  return createMissionTerminalService({
    repositoryId: options.repositoryKey ?? 'abc123', host: options.host ?? hostDouble().host,
    store: { ...store, ...(options.fs ? { fs: options.fs } : {}), isAlive: options.isAlive ?? (() => true), executionAlive: options.executionAlive },
    ...(options.renderer ? { renderer: options.renderer } : {}),
  });
}

function ok<T>(value: T): Exclude<T, MissionHistoryError> {
  assert.notEqual((value as { ok?: unknown }).ok, false, (value as { detail?: string }).detail ?? 'history operation failed');
  return value as Exclude<T, MissionHistoryError>;
}

/** A run exactly as a pre-TASK-2749 release wrote it: token-named directory and record. */
function legacyRun(checkout: string, token: string, text: string, repositoryKey = 'abc123'): string {
  const capture = open(checkout, {}, 'task-legacy');
  capture.write('stdout', Buffer.from(text));
  const record = capture.finish({ exitCode: 3, signal: null });
  const from = path.join(missionRunsDir(checkout, 'task-legacy'), record.runId);
  const to = path.join(runHistoryRoot(checkout), token, record.runId);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  fs.writeFileSync(path.join(to, 'run.json'), JSON.stringify({ ...record, repositoryId: undefined, missionId: token, repositoryKey }));
  return record.runId;
}

test('history is resolved by repository and lossless Mission id, survives worktree loss and attributes legacy records (TASK-2749)', () => {
  const repository = mkdtemp('px-history-repo-');
  const otherRepository = mkdtemp('px-history-other-repo-');
  const worktree = mkdtemp('px-history-worktree-');
  try {
    const current = open(worktree, {}, 'task-2622.18');
    current.write('stdout', Buffer.from('CURRENT-RUN\n'));
    current.finish({ exitCode: 0, signal: null });
    assert.equal(fs.existsSync(path.join(missionRunsDir(worktree, 'task-2622.18'))), true, 'the canonical id names the store directory');
    // Simulate a worktree-local store from an earlier release, then a repository-wide one.
    const legacyId = legacyRun(worktree, 'task-2622_18', 'LEGACY-WORKTREE-RUN\n');
    const foreignId = legacyRun(worktree, 'task-2622_18', 'FOREIGN-REPOSITORY-RUN\n', 'zzz999');
    const otherMission = open(repository, {}, 'task-2622-18');
    otherMission.write('stdout', Buffer.from('HYPHENATED-MISSION\n'));
    otherMission.finish({ exitCode: 0, signal: null });
    const elsewhere = open(otherRepository, {}, 'task-2622.18');
    elsewhere.write('stdout', Buffer.from('OTHER-REPOSITORY\n'));
    elsewhere.finish({ exitCode: 0, signal: null });

    const withWorktree = service(repository, { worktree });
    const before = ok(withWorktree.overview('TASK-2622.18'));
    assert.equal(before.missionId, 'task-2622.18', 'an accepted uppercase alias normalizes at the boundary');
    const runIds = before.operations.map(entry => entry.runId);
    assert.ok(runIds.includes(legacyId) && !runIds.includes(foreignId), 'legacy token records attribute; another repository record does not');
    assert.ok(before.unattributed.some(line => line.startsWith(foreignId) && /repository/.test(line)), 'unattributable records are reported');
    assert.equal(ok(withWorktree.search('task-2622.18', { pattern: 'HYPHENATED-MISSION' })).totalHits, 0, 'task-2622-18 is another Mission');
    assert.equal(ok(withWorktree.search('task-2622.18', { pattern: 'OTHER-REPOSITORY' })).totalHits, 0, 'another repository never resolves');
    assert.equal(ok(withWorktree.search('task-2622-18', { pattern: 'HYPHENATED-MISSION' })).totalHits, 1);

    // Cleanup preserves the worktree store into the repository before removal.
    const moved = preserveWorktreeRunHistory(worktree, repository, { repositoryKey: 'abc123', missionId: 'task-2622.18' });
    assert.ok(moved.includes(legacyId) && !moved.includes(foreignId));
    fs.rmSync(worktree, { recursive: true, force: true });
    const after = ok(service(repository, { worktree: null }).overview('task-2622.18'));
    assert.ok(after.operations.some(entry => entry.runId === legacyId), 'the legacy transcript survives worktree removal');
    assert.equal(ok(service(repository).search('task-2622.18', { pattern: 'LEGACY-WORKTREE-RUN' })).totalHits, 1);
    for (const invalid of ['task-2622_18', '../task-1', 'task-1:2', '']) {
      assert.equal((service(repository).overview(invalid) as { error?: string }).error, 'invalid');
    }
  } finally {
    for (const dir of [repository, otherRepository, worktree]) { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('history pages are bounded, line-aligned, incremental and report retention gaps (TASK-2749)', () => {
  const repository = mkdtemp('px-history-pages-');
  try {
    const capture = open(repository, { segmentBytes: 1024, maxStreamBytes: 4096, supervisorPid: 7 }, 'task-9');
    capture.write('stdout', Buffer.from('FIRST-LINE\n'));
    for (let i = 0; i < 40; i += 1) { capture.write('stdout', Buffer.from(`${String(i).padStart(4, '0')}${'.'.repeat(59)}\n`)); }
    let reads = 0;
    const counted = { ...runHistoryFileSystem, readBytes: (target: string, offset: number, length: number) => { reads += 1; return runHistoryFileSystem.readBytes(target, offset, length); } };
    const history = service(repository, { fs: counted, isAlive: pid => pid === 7 });
    const runId = ok(history.overview('task-9')).operations[0].runId;
    const tail = ok(history.page('task-9', { runId, stream: 'stdout', limit: 200 }));
    assert.equal(tail.running, true);
    assert.equal(tail.atEnd, true);
    assert.match(tail.text, /^0\d{3}\.+\n/, 'an earlier-history page starts on a whole line');
    assert.ok(tail.to - tail.from <= 200 && reads <= 2, 'a page reads only the segments it touches');
    capture.write('stdout', Buffer.from('ARRIVING-OUTPUT\npartial'));
    const next = ok(history.page('task-9', { runId, stream: 'stdout', after: tail.to }));
    assert.equal(next.text, 'ARRIVING-OUTPUT\n', 'incremental pages end on a line break; the partial line follows later');
    capture.write('stdout', Buffer.from(' line done\nLAST-LINE\n'));
    const record = capture.finish({ exitCode: 2, signal: null });
    const rest = ok(history.page('task-9', { runId, stream: 'stdout', after: next.to }));
    assert.equal(rest.text, 'partial line done\nLAST-LINE\n');
    assert.equal(rest.atEnd, true);
    assert.equal(rest.running, false);
    // Walk back to the start: the dropped middle is a reported gap, never silently joined.
    let page = tail;
    const seen: Array<{ from: number; to: number }> = [];
    while (page.hasEarlier) { page = ok(history.page('task-9', { runId, stream: 'stdout', before: page.from, limit: 900 })); seen.push(...page.gaps); }
    assert.match(page.text, /^FIRST-LINE\n/);
    assert.deepEqual(seen.find(gap => gap.from === record.streams.stdout.omitted[0].from), record.streams.stdout.omitted[0]);
    assert.equal((history.page('task-9', { runId: '../../etc', stream: 'stdout' }) as { error?: string }).error, 'invalid');
    assert.equal((history.page('task-9', { runId: 'execute-codex-a1-none', stream: 'stdout' }) as { error?: string }).error, 'missing');
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
});

test('typed view states keep retained history through probe failures, pipe execution and restart (TASK-2749)', () => {
  const repository = mkdtemp('px-history-states-');
  try {
    const { host, calls } = hostDouble();
    const history = service(repository, { host });
    assert.equal(ok(history.overview('task-9')).state, 'missing');
    const pipe = open(repository, { supervisorPid: 99 }, 'task-9');
    pipe.write('stdout', Buffer.from('PIPE-OUTPUT\n'));
    assert.equal(ok(history.overview('task-9')).state, 'capture-only');
    pipe.finish({ exitCode: 0, signal: null });
    const hosted = open(repository, { terminalHost: 'tmux', tmuxSocketPath: '/private/socket' }, 'task-9');
    hosted.write('stdout', Buffer.from('HOSTED-OUTPUT\n'));
    assert.equal(ok(history.overview('task-9')).state, 'starting', 'an open hosted record before its window exists');
    host.result = { ok: true, sessions: { owned: 'native', others: [], operations: [{ name: 'execute-codex-a1-x-s0-1', started: false }] } };
    assert.equal(ok(history.overview('task-9')).state, 'starting');
    host.result = { ok: true, sessions: { owned: 'native', others: [], operations: [{ name: 'execute-codex-a1-x-s0-1', started: true }] } };
    const live = ok(history.overview('task-9'));
    assert.deepEqual([live.state, live.probe], ['live', { kind: 'live', operation: 'execute-codex-a1-x-s0-1' }]);
    assert.equal(JSON.stringify(live).includes('native') || JSON.stringify(live).includes('/private/socket'), false, 'no native handle reaches the view');
    assert.deepEqual(history.live('task-9'), { kind: 'live', operation: 'execute-codex-a1-x-s0-1', output: 'live pane text\n' });
    host.result = { ok: false, reason: 'timeout', detail: 'tmux did not answer within 1000 ms' };
    const timedOut = ok(history.overview('task-9'));
    assert.equal(timedOut.state, 'probe-timeout');
    assert.equal(timedOut.operations.length, 2, 'a timed-out probe never wipes retained history');
    host.result = { ok: false, reason: 'host-missing', detail: 'tmux is not installed' };
    assert.equal(ok(history.overview('task-9')).state, 'probe-failed', 'missing tmux is not reported as absence');
    assert.throws(() => history.attach('task-9', { readOnly: true }), /Cannot attach/);
    host.result = { ok: true, sessions: { owned: null, others: ['stranger'], operations: [] } };
    assert.equal(ok(history.overview('task-9')).state, 'ambiguous');
    assert.throws(() => history.attach('task-9', { readOnly: false }), /Ambiguous mission terminal/);
    assert.throws(() => history.close('task-9'), /Ambiguous mission terminal/);
    assert.throws(() => history.retire('task-9'), /Ambiguous mission terminal/);
    assert.deepEqual(calls.filter(call => !call.startsWith('capture')), [], 'ambiguous sessions are never attached, closed or retired');
    host.result = { ok: true, sessions: null };
    // Host restart: a new service over the same repository, the hosted supervisor gone.
    const restarted = service(repository, { host, isAlive: pid => pid !== process.pid });
    const afterRestart = ok(restarted.overview('task-9'));
    assert.equal(afterRestart.state, 'ended');
    assert.equal(afterRestart.operations[0].state, 'interrupted', 'an unfinished capture is reported interrupted, with its bytes');
    assert.equal(ok(restarted.search('task-9', { pattern: 'HOSTED-OUTPUT' })).totalHits, 1);
    assert.throws(() => restarted.attach('task-9', { readOnly: true }), /Nothing to attach.*px history task-9 list/);
    assert.ok(afterRestart.notices.some(line => /at most \d+ operations/.test(line)), 'retention limits are explicit');
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
});

test('mission search is literal by default, bounded by a scan budget, and renders provider streams (TASK-2661, TASK-2749)', () => {
  const repository = mkdtemp('px-history-search-');
  try {
    for (let i = 0; i < 3; i += 1) {
      const capture = open(repository, {}, 'task-9');
      capture.write('stdout', Buffer.from(`needle ${i}\n${'x'.repeat(4000)}\n`));
      capture.finish({ exitCode: 0, signal: null });
    }
    const history = service(repository);
    assert.equal(ok(history.search('task-9', { pattern: 'needle' })).totalHits, 3);
    assert.equal(ok(history.search('task-9', { pattern: 'n.edle' })).totalHits, 0, 'patterns are literal unless the CLI asks for a regex');
    const limited = searchRuns(scope(repository), { pattern: 'needle', maxScanBytes: 5000 });
    assert.equal(limited.scanLimited, true);
    assert.equal(limited.totalHits, 1, 'the newest run is scanned first and the budget stops the rest');
    assert.ok(limited.coverage.some(line => /scan budget/.test(line)));
    const rendered: string[] = [];
    const claude = open(repository, { identity: agentRunIdentity({ repositoryId: 'abc123', missionId: 'task-9', role: 'review', family: 'claude', attempt: 1, startedAtMs: clock + 5000 }) });
    claude.write('stdout', Buffer.from('{"message":"final progress"}\n'));
    claude.finish({ exitCode: 0, signal: null });
    const renderedHistory = service(repository, { renderer: { render: (_family, text) => { rendered.push(text); return 'readable Claude progress'; } } });
    const runId = ok(renderedHistory.overview('task-9')).operations[0].runId;
    assert.equal(ok(renderedHistory.page('task-9', { runId, stream: 'stdout' })).text, 'readable Claude progress');
    assert.deepEqual(rendered, ['{"message":"final progress"}\n']);
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
});


test('agent execution observation correlates to its run, independently of coordinator and capture liveness (TASK-2749)', () => {
  const repository = mkdtemp('px-run-observation-');
  const capture = open(repository, { supervisorPid: 7 });
  const terminal = hostDouble({ ok: true, sessions: { owned: 'task-9', others: [], operations: [
    { name: 'native-window', started: true, runId: capture.runId, execution: true },
  ] } });
  const view = () => ok(service(repository, { host: terminal.host }).overview('task-9'));
  assert.equal(view().operations[0].execution, 'live', 'a confirmed terminal command identifies this exact invocation');
  terminal.host.result = { ok: true, sessions: { owned: 'task-9', others: [], operations: [
    { name: 'first-other-window', started: true, runId: 'execute-codex-a1-other', execution: true },
    { name: 'native-window', started: true, runId: capture.runId, execution: false },
  ] } };
  assert.equal(view().operations[0].execution, 'stopped', 'all terminal windows correlate independently, including a stopped command behind a live one');
  terminal.host.result = { ok: true, sessions: { owned: 'task-9', others: [], operations: [
    { name: 'other-window', started: true, runId: 'execute-codex-a1-other', execution: true },
  ] } };
  assert.equal(view().operations[0].execution, 'unknown', 'another run of the same family cannot establish execution');
  assert.equal(view().operations[0].state, 'running', 'an open capture alone is not execution proof');
  capture.observeExecution(process.pid, 'captured-process-start');
  let probedPid: number | null = null;
  const observed = (alive: boolean | null) => ok(service(repository, { executionAlive: execution => { probedPid = execution.pid; assert.equal(execution.processIdentity, 'captured-process-start'); return alive; } }).overview('task-9')).operations[0];
  assert.equal(observed(true).execution, 'live');
  assert.equal(probedPid, process.pid);
  assert.equal(observed(false).execution, 'stopped', 'dead or reused child pid does not inherit its live supervisor');
  assert.equal(observed(null).execution, 'unknown', 'an inconclusive process probe is not absence');
  capture.finish({ exitCode: 0, signal: null });
  assert.equal(observed(true).execution, 'stopped', 'recorded completion wins over process liveness');
});

test('legacy coordinator captures remain readable without becoming agent families or attempts (TASK-2749)', () => {
  const repository = mkdtemp('px-legacy-coordinator-');
  const capture = open(repository);
  const record = capture.finish({ exitCode: 0, signal: null });
  fs.writeFileSync(path.join(capture.dir, 'run.json'), JSON.stringify({ ...record, captureKind: undefined, family: 'parallix', attempt: 1 }));
  const projected = ok(service(repository).overview('task-9')).operations[0];
  assert.equal(projected.captureKind, 'coordinator');
  assert.equal(projected.family, null);
  assert.equal(projected.attempt, null);
  assert.equal(projected.runId, capture.runId, 'retained references remain stable');
});


test('hosted coordinator correlation survives supervisor refresh and completion (TASK-2749)', () => {
  const repository = mkdtemp('px-hosted-correlation-');
  const runId = 'workflow-11111111-1111-4111-8111-111111111111';
  const capture = openRunCapture({ worktree: repository, identity: { missionId: 'task-9', repositoryId: 'abc123', role: 'review', family: null, attempt: null }, runId, captureKind: 'coordinator', terminalHost: 'tmux', segmentBytes: 32 });
  correlateRunOperation(repository, 'task-other', runId, 'foreign-mission');
  correlateRunOperation(repository, 'task-9', runId, 'existing-current-work');
  capture.write('stdout', Buffer.from('x'.repeat(100)));
  correlateRunOperation(repository, 'task-9', runId, 'nested-operation');
  const finished = capture.finish({ exitCode: 0, signal: null });
  assert.equal(finished.operationId, 'existing-current-work', 'refresh and nested publication retain the outer operation correlation');
  capture.observeExecution(123, 'late');
  capture.correlateOperation('late');
  assert.equal(getRun(scope(repository), runId).run!.state, 'exited', 'late observation cannot reopen completed capture');
});


test('hyphenated families retain canonical attribution and old encoded history remains readable (TASK-2749)', () => {
  const repository = mkdtemp('px-family-compat-');
  const identity = agentRunIdentity({ repositoryId: 'abc123', missionId: 'task-9', role: 'execute', family: 'custom-pi', attempt: 1, startedAtMs: clock + 1000 });
  const capture = openRunCapture({ worktree: repository, identity, runId: agentRunId(identity), terminalHost: 'pipe' });
  const record = capture.finish({ exitCode: 0, signal: null });
  assert.equal(record.family, 'custom-pi', 'new records persist the existing family identity');
  const file = path.join(capture.dir, 'run.json');
  fs.writeFileSync(file, JSON.stringify({ ...record, captureKind: undefined, family: 'custom_pi' }));
  const history = ok(service(repository).overview('task-9'));
  assert.equal(history.operations[0].family, 'custom-pi', 'old encoded families resolve through the compatibility reader');
  assert.equal(history.operations[0].runId, record.runId, 'retained references do not change');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).family, 'custom_pi', 'reading never rewrites legacy evidence');
  fs.writeFileSync(file, JSON.stringify({ ...record, family: '../other' }));
  assert.equal(getRun(scope(repository), record.runId).error, 'malformed');
});

test('terminal sequences preserve text around CSI, OSC and incomplete escapes (TASK-2746)', () => {
  const fixtures = [
    ['a\x1b[31mb\x1b[0mc', 'abc'],
    ['a\x1b]title\x07b', 'ab'],
    ['a\x1b]title\x1b\\b', 'ab'],
    ['a\x1bMb', 'ab'],
    ['a\x1b[12', 'a[12'],
    ['a\x1b]title', 'atitle'],
    ['a\x1b[  mb', 'ab'],
    ['a\x1b[0;? mb', 'ab'],
    ['a\x1bxb', 'axb'],
    ['\x00a\t\nb\r\n\x7f', 'a\t\nb\n'],
  ];
  for (const [input, expected] of fixtures) { assert.equal(stripTerminalControl(input), expected); }
});
