import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from '../../../helpers/temp-dir.js';
import { openRunSession, TerminalHostUnavailableError } from '../../../../src/adapters/agents/run-session.js';
import { missionRunsDir } from '../../../../src/adapters/filesystem/run-history-store.js';

// Doubles for the tmux probe, config and repository key; no real tmux or git.

function setup(host: 'pipe' | 'tmux', whenUnavailable: 'fallback' | 'fail' = 'fallback', available = false) {
  const worktree = mkdtemp('px-run-session-');
  const logs: string[] = [];
  const deps = {
    interactive: true,
    config: () => ({ host, whenUnavailable }),
    probe: () => ({ available, version: available ? 'tmux 3.7c' : null, reason: available ? null : 'tmux is not runnable (ENOENT)' }),
    repositoryKey: () => 'abc123',
    env: { PARALLIX_TERMINAL_STATE_DIR: path.join(worktree, '.term') },
    now: () => new Date('2026-10-05T12:00:00Z'),
    spawnSyncFn: (() => ({ status: 0, stdout: '', stderr: '' })) as never,
  };
  const input = { worktree, slug: 'task-7', role: 'execute', family: 'codex', attempt: 1, log: (line: string) => logs.push(line) };
  return { worktree, logs, deps, input };
}

function record(worktree: string, runId: string) {
  return JSON.parse(fs.readFileSync(path.join(missionRunsDir(worktree, 'task-7'), runId, 'run.json'), 'utf8'));
}

test('a launch without a Mission worktree records no run history (TASK-2643)', () => {
  const { deps, input } = setup('pipe');
  assert.equal(openRunSession({ ...input, slug: null }, deps), null);
  assert.equal(openRunSession({ ...input, worktree: undefined }, deps), null);
});

test('the pipe host captures durably and reports what is not covered (TASK-2643)', () => {
  const { worktree, deps, input } = setup('pipe');
  const session = openRunSession(input, deps)!;
  assert.equal(session.teeOptions.terminalHost, undefined, 'pipe is the existing headless launch');
  assert.equal(record(worktree, session.runId).state, 'running', 'the record exists before any output');
  session.teeOptions.capture!.write('stderr', Buffer.from('npm ERR! code E401\n'));
  session.finish({ status: 1, signal: null, sessionId: null });
  const finished = record(worktree, session.runId);
  assert.equal(finished.state, 'exited');
  assert.equal(finished.exitCode, 1);
  assert.equal(finished.streams.stderr.bytes, 19);
  assert.ok(finished.omissions.some((line: string) => /No codex provider-native transcript/.test(line)));
  assert.ok(finished.omissions.some((line: string) => /reasoning/.test(line)));
});

test('configured tmux falls back to pipe with a stated reason when tmux is missing (TASK-2643)', () => {
  const { worktree, logs, deps, input } = setup('tmux', 'fallback', false);
  const session = openRunSession(input, deps)!;
  assert.equal(session.teeOptions.terminalHost, undefined);
  assert.ok(logs.some(line => /tmux terminal host unavailable .*ENOENT.*pipe host/.test(line)));
  assert.match(record(worktree, session.runId).hostFallbackReason, /ENOENT/);
});

test('configured tmux with whenUnavailable fail refuses the launch with an actionable error (TASK-2643)', () => {
  const { deps, input } = setup('tmux', 'fail', false);
  assert.throws(() => openRunSession(input, deps), (err: unknown) => err instanceof TerminalHostUnavailableError && /Install tmux/.test((err as Error).message));
});

test('an in-process family is never tmux-hosted and its rendered output is captured (TASK-2643)', () => {
  const { worktree, deps, input } = setup('tmux', 'fallback', true);
  const session = openRunSession({ ...input, family: 'pi' }, deps)!;
  assert.equal(session.teeOptions.terminalHost, undefined);
  assert.match(record(worktree, session.runId).hostFallbackReason, /outer mission command/);
  assert.ok(session.teeOptions.stdoutSink, 'pi renders through a sink, so the sink is captured');
});

test('available tmux hosts the launch and records the attach target (TASK-2643)', () => {
  const { worktree, logs, deps, input } = setup('tmux', 'fallback', true);
  const session = openRunSession(input, deps)!;
  assert.ok(session.teeOptions.terminalHost);
  const hosted = session.teeOptions.terminalHost!.host({ command: 'codex', args: ['exec'] }, { cwd: worktree, env: {} });
  try {
    const rec = record(worktree, session.runId);
    assert.equal(rec.terminalHost, 'tmux');
    assert.equal(rec.tmux.sessions.length, 1);
    assert.equal(rec.tmux.sessions[0], 'task-7');
    assert.ok(logs.some(line => line.includes('px attach task-7')));
  } finally {
    hosted.cleanup();
  }
});

test('a provider-native transcript named by the session id is retained with its source (TASK-2643)', () => {
  const { worktree, deps, input } = setup('pipe');
  const sessionId = '0199a1b2-c3d4-7e8f-9a0b-c1d2e3f4a5b6';
  const sessions = path.join(worktree, '.workflow', 'codex-home', 'sessions', '2026', '10', '05');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, `rollout-2026-10-05T12-00-00-${sessionId}.jsonl`), '{"type":"function_call_output","output":"exit 1: npm ERR! E401"}\n');
  const session = openRunSession(input, deps)!;
  session.finish({ status: 0, signal: null, sessionId });
  const rec = record(worktree, session.runId);
  const transcript = rec.sources.find((source: { kind: string }) => source.kind === 'provider-transcript');
  assert.ok(transcript, 'the codex rollout is preserved');
  assert.equal(transcript.complete, true);
  const kept = fs.readFileSync(path.join(missionRunsDir(worktree, 'task-7'), session.runId, transcript.path), 'utf8');
  assert.match(kept, /npm ERR! E401/);
  assert.equal(rec.providerSessionId, sessionId);
  assert.equal(rec.omissions.some((line: string) => /provider-native transcript was retained/.test(line)), false);
});

test('Claude output is recorded as the provider stream that carries tool results (TASK-2643)', () => {
  const { worktree, deps, input } = setup('pipe');
  const session = openRunSession({ ...input, family: 'claude' }, deps)!;
  session.finish({ status: 0, signal: null, sessionId: null });
  const [primary] = record(worktree, session.runId).sources;
  assert.equal(primary.kind, 'provider-stream');
  assert.match(primary.covers, /tool calls and tool results/);
});


test('agent attempts inherit the whole mission terminal without creating another host (TASK-2643)', () => {
  const { worktree, deps, input } = setup('tmux', 'fail', false);
  const session = openRunSession({ ...input, family: 'pi' }, { ...deps, env: {
    ...deps.env, PARALLIX_MISSION_TERMINAL: 'task-7', PARALLIX_MISSION_SOCKET: '/private/task-7.sock',
  } })!;
  assert.equal(session.teeOptions.terminalHost, undefined);
  assert.equal(record(worktree, session.runId).terminalHost, 'tmux');
  assert.deepEqual(record(worktree, session.runId).tmux.sessions, ['task-7']);
  assert.ok(session.teeOptions.stdoutSink);
  session.finish({ status: 0 });
  assert.doesNotMatch(record(worktree, session.runId).sources[0].covers, /pane bytes|stderr merged/);
  const piped = openRunSession({ ...input, family: 'codex' }, { ...deps, env: {
    ...deps.env, PARALLIX_MISSION_TERMINAL: 'task-7', PARALLIX_MISSION_SOCKET: '/private/task-7.sock',
  } })!;
  piped.finish({ status: 0 });
  assert.match(record(worktree, piped.runId).sources[0].covers, /stdout and stderr/);
  assert.doesNotMatch(record(worktree, piped.runId).sources[0].covers, /pane bytes|stderr merged/);
});

test('automatic hosting silently keeps pipes when tmux is absent (TASK-2643)', () => {
  const { logs, deps, input } = setup('pipe');
  const session = openRunSession(input, { ...deps, interactive: true, config: () => ({ host: 'auto', whenUnavailable: 'fail' }) })!;
  assert.equal(session.teeOptions.terminalHost, undefined);
  assert.deepEqual(logs, []);
});

test('automatic headless launches keep attributable pipe capture without probing tmux (TASK-2643)', () => {
  const { worktree, deps, input } = setup('pipe');
  const session = openRunSession(input, { ...deps, interactive: false,
    config: () => ({ host: 'auto', whenUnavailable: 'fail' }),
    probe: () => { throw new Error('headless launch must not probe'); },
  })!;
  assert.equal(session.teeOptions.terminalHost, undefined);
  assert.ok(session.teeOptions.capture);
  session.finish({ status: 0 });
  assert.equal(record(worktree, session.runId).terminalHost, 'pipe');
});
