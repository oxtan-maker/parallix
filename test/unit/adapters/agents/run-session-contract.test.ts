import { resolveConfiguration } from '../../../../src/composition/config.js';
import fs from 'node:fs';
import path from 'node:path';
import test, { mock, type TestContext } from 'node:test';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import type { PiWorkerChild } from '../../../../src/adapters/agents/pi-worker-client.js';
import { mkdtemp } from '../../../helpers/temp-dir.js';
import { openRunSession, TerminalHostUnavailableError } from '../../../../src/adapters/agents/run-session.js';
import { missionRunsDir } from '../../../../src/adapters/filesystem/run-history-store.js';
import { claudeProjectDir } from '../../../../src/adapters/config/state-homes.js';
import { bulkStorageProbe } from '../../../../src/adapters/process/bulk-storage.js';

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
    spawnSyncFn: (() => ({ status: 0, stdout: '', stderr: '' })),
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
  assert.equal(record(worktree, session.runId).execution, null, 'an open capture is not proof of agent execution');
  session.observeExecution(process.pid);
  assert.equal(record(worktree, session.runId).execution.pid, process.pid, 'the actual launch callback records execution identity');
  assert.deepEqual(session.teeOptions.resourceBoundary, { boundary: session.runId, parent: null });
  session.teeOptions.onProcessTreeCpu?.({ userUs: 12_000, systemUs: 3_000, provenance: 'bash-time-waited-tree',
    boundary: session.runId, parent: null });
  session.teeOptions.capture!.write('stderr', Buffer.from('npm ERR! code E401\n'));
  session.finish({ status: 1, signal: null, sessionId: null, telemetry: { provider: 'openai', model: 'gpt-6.1-sol',
    inputTokens: 42, toolCalls: 2, usagePercent: 17.5, cost_usd: 0.125 } });
  const finished = record(worktree, session.runId);
  assert.equal(finished.state, 'exited');
  assert.equal(finished.exitCode, 1);
  assert.equal(finished.streams.stderr.bytes, 19);
  assert.deepEqual(finished.resources.localProcessTreeCpu, { userUs: 12_000, systemUs: 3_000,
    provenance: 'bash-time-waited-tree', boundary: session.runId, parent: null });
  assert.deepEqual(finished.resources.provider, { provenance: 'provider-reported', provider: 'openai', model: 'gpt-6.1-sol', values: [
    { name: 'input', value: 42, unit: 'tokens' }, { name: 'tool-calls', value: 2, unit: 'count' },
    { name: 'provider-usage', value: 17.5, unit: 'percent' }, { name: 'cost', value: 0.125, unit: 'usd' },
  ] });
  assert.ok(finished.omissions.some((line: string) => /No codex provider-native transcript/.test(line)));
  assert.ok(finished.omissions.some((line: string) => /reasoning/.test(line)));
});

test('run history retains an observed provider and model when usage telemetry is unavailable (px-0036.01)', () => {
  const { worktree, deps, input } = setup('pipe');
  const session = openRunSession({ ...input, family: 'pi' }, deps)!;
  session.finish({ status: 1, signal: null, sessionId: 'worker-session', provider: 'pi', model: 'fixture-model', telemetry: null });
  const finished = record(worktree, session.runId);

  assert.deepEqual(finished.resources.provider, {
    provenance: 'provider-reported', provider: 'pi', model: 'fixture-model', values: [],
  }, 'resolved provider identity remains durable even when the provider reported no usage snapshot');
});

test('nested process resources inherit the composition-resolved parent boundary (TASK-2835)', () => {
  const { deps, input } = setup('pipe');
  const configuration = resolveConfiguration({ PARALLIX_RESOURCE_BOUNDARY: 'parent-run' });
  const session = openRunSession(input, { ...deps, configuration })!;
  assert.deepEqual(session.teeOptions.resourceBoundary, { boundary: session.runId, parent: 'parent-run' });
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

test('available tmux hosts the launch and records the attach target (TASK-2643)', t => {
  // The fixture state home holds the transcript whatever backs the host's
  // temporary directory (TASK-2816 places transcripts on disk-backed storage).
  t.mock.method(bulkStorageProbe, 'statfs', () => ({ type: 0xef53 }));
  t.mock.method(bulkStorageProbe, 'writable', () => true);
  const { worktree, logs, deps, input } = setup('tmux', 'fallback', true);
  const session = openRunSession(input, deps)!;
  assert.ok(session.teeOptions.terminalHost);
  const hosted = session.teeOptions.terminalHost!.host({ command: 'codex', args: ['exec'] }, { cwd: worktree, env: {} });
  try {
    session.observeExecution(process.pid);
    const rec = record(worktree, session.runId);
    assert.equal(rec.execution, null, 'the tmux host wrapper is not the agent command');
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

test('Claude native transcript retention uses supplied home instead of process home (TASK-2724)', t => {
  const { worktree, deps, input } = setup('pipe');
  t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
  const suppliedHome = path.join(worktree, 'supplied-home');
  const processHome = path.join(worktree, 'process-home');
  const homeMock = mock.method(os, 'homedir', () => processHome);
  t.after(() => homeMock.mock.restore());
  const configuration = resolveConfiguration({ HOME: suppliedHome });
  assert.notEqual(configuration.storage.homeDirectory, os.homedir());
  const sessionId = 'isolated-claude-session';
  const expected = '{"type":"tool_result","content":"configured-home evidence"}\n';
  for (const [home, content] of [[suppliedHome, expected], [processHome, 'wrong process-home transcript\n']]) {
    const directory = claudeProjectDir(worktree, resolveConfiguration({ HOME: home }));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${sessionId}.jsonl`), content);
  }
  const session = openRunSession({ ...input, family: 'claude' }, { ...deps, configuration })!;
  session.finish({ status: 0, sessionId });
  const rec = record(worktree, session.runId);
  const transcript = rec.sources.find((source: { kind: string }) => source.kind === 'provider-transcript');
  assert.ok(transcript);
  assert.equal(transcript.complete, true);
  assert.equal(fs.readFileSync(path.join(missionRunsDir(worktree, 'task-7'), session.runId, transcript.path), 'utf8'), expected);
  assert.equal(rec.omissions.some((line: string) => /No claude provider-native transcript/.test(line)), false);
});


test('agent attempts inherit the whole mission terminal without creating another host (TASK-2643)', () => {
  const { worktree, deps, input } = setup('tmux', 'fail', false);
  const session = openRunSession({ ...input, family: 'pi' }, { ...deps, configuration: resolveConfiguration({
    ...deps.env, PARALLIX_MISSION_TERMINAL: 'task-7', PARALLIX_MISSION_SOCKET: '/private/task-7.sock',
  }) })!;
  assert.equal(session.teeOptions.terminalHost, undefined);
  assert.equal(record(worktree, session.runId).terminalHost, 'tmux');
  assert.deepEqual(record(worktree, session.runId).tmux.sessions, ['task-7']);
  assert.ok(session.teeOptions.stdoutSink);
  session.finish({ status: 0 });
  assert.doesNotMatch(record(worktree, session.runId).sources[0].covers, /pane bytes|stderr merged/);
  const piped = openRunSession({ ...input, family: 'codex' }, { ...deps, configuration: resolveConfiguration({
    ...deps.env, PARALLIX_MISSION_TERMINAL: 'task-7', PARALLIX_MISSION_SOCKET: '/private/task-7.sock',
  }) })!;
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

test('in-process preparation never records its workflow owner as provider execution (TASK-2769)', async t => {
  const { configureMissionWriteAuthorization } = await import('../../../../src/application/ports/mission-write-authorization.js');
  configureMissionWriteAuthorization({ operationId: 'workflow-owner', generation: 3, async assert() {} });
  t.after(() => configureMissionWriteAuthorization(null));
  const { worktree, deps, input } = setup('pipe');
  const session = openRunSession({ ...input, family: 'pi', model: 'model-1' }, deps)!;
  try {
    const value = record(worktree, session.runId);
    assert.equal(value.execution, null, 'SDK preparation and workflow ownership do not confirm a provider invocation');
    assert.equal(value.operationId, 'workflow-owner');
    assert.equal(value.operationGeneration, 3);
    assert.equal(value.sourceId, session.runId);
    assert.equal(value.configuredModel, 'model-1');
    assert.deepEqual(value.dependencies, []);
    assert.equal(value.revision, null);
  } finally { session.finish({ status: 0 }); }
});

test('restarted and replacement launches retain workflow generation while minting distinct run sources (TASK-2835)', async t => {
  const { configureMissionWriteAuthorization } = await import('../../../../src/application/ports/mission-write-authorization.js');
  configureMissionWriteAuthorization({ operationId: 'workflow-restart', generation: 5, async assert() {} });
  t.after(() => configureMissionWriteAuthorization(null));
  const { worktree, deps, input } = setup('pipe');
  let tick = 0;
  const timed = { ...deps, now: () => new Date(Date.parse('2026-10-05T12:00:00Z') + tick++ * 1000) };
  const first = openRunSession({ ...input, model: 'model-before' }, timed)!;
  first.finish({ status: null, signal: 'SIGTERM' });
  const replacement = openRunSession({ ...input, family: 'claude', attempt: 2, model: 'model-after' }, timed)!;
  replacement.finish({ status: 0 });
  const before = record(worktree, first.runId), after = record(worktree, replacement.runId);
  assert.notEqual(before.sourceId, after.sourceId);
  assert.deepEqual([before.operationId, before.operationGeneration], ['workflow-restart', 5]);
  assert.deepEqual([after.operationId, after.operationGeneration], ['workflow-restart', 5]);
  assert.deepEqual([before.configuredModel, after.configuredModel], ['model-before', 'model-after']);
  assert.deepEqual([before.state, before.signal, after.state, after.exitCode], ['exited', 'SIGTERM', 'exited', 0]);
});

test('a refused prepared launch settles its reservation without invoking a provider (TASK-2798)', async () => {
  const { launchPrepared } = await import('../../../../src/adapters/agents/agent-launch-process.js');
  let launches = 0; let releases = 0;
  const prepared: Parameters<typeof launchPrepared>[0] = {
    launcher: () => { launches++; return { result: { status: 0 } }; },
    agentEnv: {}, resume: false, sessionId: null, launchSessionMarkerPort: undefined, sessionRole: null,
    actualPrompt: 'fixture', model: null, watchdogConfig: null, effectiveProfile: null, nativeSandbox: false,
    customReservation: { bindChild: () => {}, release: () => { releases++; } },
  };
  await assert.rejects(launchPrepared(prepared, { configuration: resolveConfiguration({}), step: 'execute', slug: null,
    worktree: undefined, role: null, onLaunch: undefined, unrefChild: false, log: () => {},
    launchAdmission: { assert: async () => { throw new Error('stale recovery'); } },
  }, 'custom', 1), /stale recovery/);
  assert.equal(launches, 0);
  assert.equal(releases, 1);
});

test('a persisted workflow outcome stops a lingering agent without launching fallback work (TASK-2830)', async () => {
  const { awaitAgentResult } = await import('../../../../src/adapters/agents/agent-launch-process.js');
  let completionChecks = 0;
  let stopCalls = 0;
  let settle!: (result: { status: number | null; signal: string | null; stdout: string; stderr: string }) => void;
  const provider = new Promise<Parameters<typeof settle>[0]>(resolve => { settle = resolve; });
  const outcome = await awaitAgentResult(provider, () => { completionChecks += 1; return true; }, { pid: 42 }, () => {}, async () => {
    stopCalls += 1;
    settle({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' });
  });
  assert.ok(completionChecks >= 1);
  assert.equal(stopCalls, 1);
  assert.equal(outcome.status, 0);
  assert.equal(outcome.signal, null);
  assert.equal(outcome.completedAuthoritatively, true);
});

test('verdict-first signal death stays distinct from authoritative workflow success (px-0036.01)', async t => {
  const { awaitAgentResult } = await import('../../../../src/adapters/agents/agent-launch-process.js');
  const { worktree, deps, input } = setup('pipe');
  t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
  let settle!: (result: { status: number | null; signal: string | null; stdout: string; stderr: string }) => void;
  const provider = new Promise<Parameters<typeof settle>[0]>(resolve => { settle = resolve; });
  const outcome = await awaitAgentResult(provider, async () => true, { pid: 42 }, () => {}, async () => {
    settle({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' });
  });
  const session = openRunSession({ ...input, family: 'claude' }, deps)!;
  session.finish(outcome);
  const finished = record(worktree, session.runId);

  assert.equal(outcome.status, 0, 'the durable workflow verdict still owns launch success');
  assert.deepEqual(outcome.providerExit, { status: null, signal: 'SIGTERM' });
  assert.equal(finished.exitCode, null, 'a signal-stopped provider has no clean numeric exit');
  assert.equal(finished.signal, 'SIGTERM', 'run history keeps the provider process signal');
});

test('a capture finalized before any spawn stays retrievable and reads stopped without a fabricated exit (px-0027)', async () => {
  const { getRun } = await import('../../../../src/application/run-history.js');
  const { runHistoryFileSystem } = await import('../../../../src/adapters/filesystem/run-history-store.js');
  const { worktree, deps, input } = setup('pipe');
  const session = openRunSession(input, deps)!;
  session.finish({ status: null, signal: null, sessionId: null });
  const finished = record(worktree, session.runId);
  assert.equal(finished.state, 'exited');
  assert.equal(finished.exitCode, null, 'no child ran, so no exit code is invented');
  assert.equal(finished.signal, null);
  assert.equal(finished.execution, null);
  const lookup = getRun({ runsDir: missionRunsDir(worktree, 'task-7'), fs: runHistoryFileSystem, isAlive: () => false }, session.runId);
  assert.equal(lookup.ok && lookup.run?.execution, 'stopped');
});


// --- Pi result transport across verdict-first shutdown (px-0036.01) ---

const observedPiSession = {
  provider: 'pi', model: 'fixture-model', sessionId: 'worker-session',
  telemetry: { provider: 'pi', model: 'fixture-model', inputTokens: 4, outputTokens: 2, cachedTokens: 1,
    totalTokens: 7, toolCalls: 3, cost_usd: 0.25, usagePercent: null },
};

/**
 * A Pi worker double speaking the worker IPC protocol in-process, so the Pi
 * result transport and its stop path stay unit-testable without a child
 * process (ADR 0057). `drain` selects whether the worker settles when its
 * client asks it to stop, or ignores the request so the client's hard signal
 * escalation is exercised against a captured process-group signal.
 */
function piWorkerDouble(t: TestContext, drain: boolean) {
  const emitter = new EventEmitter();
  let connected = true;
  const sent: unknown[] = [];
  const settle = (code: number | null, signal: NodeJS.Signals | null) => {
    if (!connected) { return; }
    connected = false;
    emitter.emit('close', code, signal);
  };
  // A failed case must not leave the client promise, or its signal listeners,
  // hanging for the next case.
  t.after(() => settle(1, 'SIGKILL'));
  const child = {
    pid: 4_242,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    get connected() { return connected; },
    send(message: unknown) {
      sent.push(message);
      if (drain && (message as { kind?: string })?.kind === 'stop') { queueMicrotask(() => settle(1, null)); }
      return true;
    },
    on: (event: string, listener: (...args: unknown[]) => void) => emitter.on(event, listener),
    once: (event: string, listener: (...args: unknown[]) => void) => emitter.once(event, listener),
  } as unknown as PiWorkerChild;
  return {
    child,
    sent,
    settle,
    publish: (message: unknown) => { emitter.emit('message', message); },
    /** The stop request the launch makes through the client's own stop path. */
    stop: (signal: NodeJS.Signals) => { (child as { terminateTree?: (_s: NodeJS.Signals) => void }).terminateTree!(signal); },
  };
}

/** Capture process-group signals instead of delivering them to this test process. */
function captureTreeSignals(t: TestContext): NodeJS.Signals[] {
  const signals: NodeJS.Signals[] = [];
  const original = process.kill;
  process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
    if (typeof pid === 'number' && pid < 0) { signals.push((signal ?? 'SIGTERM') as NodeJS.Signals); return true; }
    return original.call(process, pid as number, signal as NodeJS.Signals | number | undefined);
  }) as typeof process.kill;
  t.after(() => { process.kill = original; });
  return signals;
}

test('verdict-first Pi shutdown retains the observed model, session and telemetry (px-0036.01)', async t => {
  const { worktree, deps, input } = setup('pipe');
  const { awaitAgentResult } = await import('../../../../src/adapters/agents/agent-launch-process.js');
  const { startPiWorker } = await import('../../../../src/adapters/agents/pi-worker-client.js');
  const worker = piWorkerDouble(t, true);
  const listenerCounts = [process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')];
  const resultPromise = startPiWorker({ prompt: 'review the branch', worktree },
    { command: 'px-pi-worker-double', args: [], options: { env: {} } }, async () => {}, { command: 'px', args: [] },
    { spawn: () => worker.child });
  worker.publish({ kind: 'observed', observation: observedPiSession });

  const stopRequests: NodeJS.Signals[] = [];
  const outcome = await awaitAgentResult(resultPromise, async () => true, worker.child, () => {},
    async () => { stopRequests.push('SIGTERM'); worker.stop('SIGTERM'); });
  const session = openRunSession({ ...input, family: 'pi', model: 'configured-model' }, deps)!;
  session.finish(outcome);
  const finished = record(worktree, session.runId);

  assert.equal(outcome.completedAuthoritatively, true);
  assert.equal(outcome.status, 0, 'the persisted workflow outcome still owns completion');
  assert.equal(outcome.model, 'fixture-model', 'the resolved model survives verdict-first shutdown');
  assert.equal(outcome.sessionId, 'worker-session', 'the provider session survives verdict-first shutdown');
  assert.equal(outcome.telemetry?.totalTokens, 7, 'provider usage survives verdict-first shutdown');
  assert.deepEqual(stopRequests, ['SIGTERM'], 'the launch stops the provider once, after the verdict is durable');
  assert.ok(worker.sent.some((message: unknown) => (message as { kind?: string })?.kind === 'stop'),
    'the client asks its worker to settle over IPC before it signals it');
  assert.equal(finished.providerSessionId, 'worker-session');
  assert.equal(finished.resources.provider?.model, 'fixture-model');
  assert.deepEqual(finished.resources.provider?.values.map((value: { name: string }) => value.name),
    ['input', 'output', 'cached', 'context', 'tool-calls', 'cost']);
  assert.equal(finished.exitCode, 1, 'the record does not report an interrupted provider as a clean exit');
  assert.deepEqual([process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')], listenerCounts,
    'the client leaves no signal listener behind');
});

test('a sparse final Pi result enriches rather than erases observed facts (px-0036.01)', async t => {
  const { startPiWorker } = await import('../../../../src/adapters/agents/pi-worker-client.js');
  const worker = piWorkerDouble(t, false);
  const resultPromise = startPiWorker({ prompt: 'review the branch', worktree: 'fixture' },
    { command: 'px-pi-worker-double', args: [], options: { env: {} } }, async () => {}, { command: 'px', args: [] },
    { spawn: () => worker.child });
  worker.publish({ kind: 'observed', observation: observedPiSession });
  worker.publish({ kind: 'result', result: {
    status: 1, signal: null, stdout: 'partial output', stderr: 'fixture aborted', error: new Error('fixture aborted'),
    sessionId: null, provider: null, model: null,
    telemetry: { provider: null, model: null, outputTokens: 9 }, transientRetries: 0,
    startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
  } });
  worker.settle(1, null);

  const outcome = await resultPromise;
  assert.equal(outcome.status, 1, 'the final provider failure remains authoritative');
  assert.equal(outcome.stderr, 'fixture aborted');
  assert.equal(outcome.provider, 'pi');
  assert.equal(outcome.model, 'fixture-model');
  assert.equal(outcome.sessionId, 'worker-session');
  assert.deepEqual(outcome.telemetry, {
    ...observedPiSession.telemetry,
    outputTokens: 9,
  }, 'non-null final fields enrich the observation without erasing its other usage fields');
});

test('a Pi worker that ignores the stop request still takes the hard signal without losing its observed facts (px-0036.01)', async t => {
  const { startPiWorker } = await import('../../../../src/adapters/agents/pi-worker-client.js');
  const worker = piWorkerDouble(t, false);
  const treeSignals = captureTreeSignals(t);
  const resultPromise = startPiWorker({ prompt: 'review the branch', worktree: 'fixture' },
    { command: 'px-pi-worker-double', args: [], options: { env: {} } }, async () => {}, { command: 'px', args: [] },
    { spawn: () => worker.child });
  worker.publish({ kind: 'observed', observation: observedPiSession });

  worker.stop('SIGTERM');
  assert.ok(worker.sent.some((message: unknown) => (message as { kind?: string })?.kind === 'stop'),
    'a graceful stop is requested over IPC first');
  assert.deepEqual(treeSignals, [], 'the graceful request does not also kill the process group');
  worker.stop('SIGKILL');
  assert.deepEqual(treeSignals, ['SIGKILL'],
    'the escalation keeps its teeth: recovering telemetry never downgrades or skips the hard signal');
  worker.settle(null, 'SIGKILL');

  const outcome = await resultPromise;
  assert.equal(outcome.model, 'fixture-model', 'even a hard reap keeps the model the worker observed');
  assert.equal(outcome.sessionId, 'worker-session');
});

test('a silent Pi worker is stopped by its liveness bound with the observed session retained (px-0036.01)', async t => {
  const { startPiWorker } = await import('../../../../src/adapters/agents/pi-worker-client.js');
  const worker = piWorkerDouble(t, true);
  const resultPromise = startPiWorker({ prompt: 'review the branch', worktree: 'fixture',
    teeOptions: { noOutputWatchdog: { maxNoOutputMs: 40 } } },
    { command: 'px-pi-worker-double', args: [], options: { env: {} } }, async () => {}, { command: 'px', args: [] },
    { spawn: () => worker.child });
  worker.publish({ kind: 'observed', observation: observedPiSession });

  const outcome = await resultPromise;
  assert.equal(outcome.status, 1, 'a liveness timeout is never reported as provider success');
  assert.equal(outcome.model, 'fixture-model', 'the resolved model survives a liveness timeout');
  assert.equal(outcome.sessionId, 'worker-session');
  assert.equal(outcome.telemetry?.totalTokens, 7);
  assert.ok(worker.sent.some((message: unknown) => (message as { kind?: string })?.kind === 'stop'),
    'the liveness stop drains the worker instead of signalling it');
});

test('operator cancellation finalizes observed run metadata before re-raising the parent signal (px-0036.01)', async t => {
  const { launchPrepared } = await import('../../../../src/adapters/agents/agent-launch-process.js');
  const { startPiWorker } = await import('../../../../src/adapters/agents/pi-worker-client.js');
  const { worktree } = setup('pipe');
  const configuration = resolveConfiguration({ PARALLIX_HOME: path.join(worktree, '.home'), PARALLIX_NO_BUBBLEWRAP: '1' });
  const worker = piWorkerDouble(t, false);
  const signal = 'SIGTERM' as const;
  const existingListeners = process.listeners(signal);
  const originalKill = process.kill;
  let stateWhenReraised: string | null = null;
  let observedRunId: string | null = null;
  let noteReraised!: () => void;
  const reraised = new Promise<void>(resolve => { noteReraised = resolve; });

  process.kill = ((pid: number, delivered?: NodeJS.Signals | number) => {
    if (pid === process.pid && delivered !== 0) {
      const runs = fs.readdirSync(missionRunsDir(worktree, 'task-7'));
      assert.equal(runs.length, 1);
      observedRunId = runs[0]!;
      stateWhenReraised = record(worktree, observedRunId).state;
      noteReraised();
      return true;
    }
    if (pid === -worker.child.pid!) {
      worker.settle(null, delivered as NodeJS.Signals);
      return true;
    }
    return originalKill.call(process, pid, delivered as NodeJS.Signals | number | undefined);
  }) as typeof process.kill;
  t.after(() => { process.kill = originalKill; });

  const prepared: Parameters<typeof launchPrepared>[0] = {
    launcher: options => {
      const resultPromise = startPiWorker({ prompt: options.prompt, worktree,
        ...(options.teeOptions ? { teeOptions: options.teeOptions as Parameters<typeof startPiWorker>[0]['teeOptions'] } : {}) },
      { command: 'pi', args: [], options: { env: {} } }, async () => {}, { command: 'px', args: [] },
      { spawn: () => worker.child });
      worker.publish({ kind: 'observed', observation: { ...observedPiSession, telemetry: null } });
      queueMicrotask(() => {
        const own = process.listeners(signal).filter(listener => !existingListeners.includes(listener));
        own.forEach(listener => (listener as (_signal: NodeJS.Signals) => void)(signal));
      });
      return { invocation: { command: 'pi', args: [], options: { cwd: worktree } }, resultPromise };
    },
    agentEnv: {}, resume: false, sessionId: null, launchSessionMarkerPort: undefined, sessionRole: null,
    actualPrompt: 'review the branch', model: 'configured-model', watchdogConfig: null,
    customReservation: null, effectiveProfile: null, nativeSandbox: false,
  };

  const launched = await launchPrepared(prepared, { configuration, step: 'execute', slug: 'task-7', worktree,
    role: null, onLaunch: undefined, unrefChild: false, log: () => {}, authoritativeCompletion: undefined,
    launchAdmission: undefined }, 'pi', 1);
  await reraised;

  assert.equal(stateWhenReraised, 'exited', 'run history is finalized before the parent receives its cancellation signal again');
  assert.ok(observedRunId);
  const finished = record(worktree, observedRunId);
  assert.equal(finished.providerSessionId, 'worker-session');
  assert.equal(finished.resources.provider?.provider, 'pi');
  assert.equal(finished.resources.provider?.model, 'fixture-model');
  assert.equal(launched.result.runId, observedRunId, 'the production launch result carries the retained run identity into stage recording');
  assert.deepEqual(launched.result.providerResources, finished.resources.provider,
    'run history and stage recording receive the same named provider observation (TASK-2846.03)');
  assert.equal(launched.result.status, 1, 'operator cancellation is not rewritten as provider success');
});
