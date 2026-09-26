import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { missionId } from '../src/domain/mission.js';
import { sessionRole } from '../src/domain/session.js';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

const pi = mockModule<typeof import('../src/adapters/agents/pi.js')>('../src/adapters/agents/pi.js', import.meta.url);
await installModuleMocks();

test.afterEach(() => {
  mock.restoreAll();
  pi.__setSdkForTest(null);
  pi.__setCreateAgentSessionForTest(null);
  pi.__setSessionPortForTest(null);
});

function fixture(events: any[] = [], overrides: any = {}) {
  const writes: string[] = [];
  const calls = { disposed: 0, unsubscribed: 0 };
  let listener: (event: any) => void;
  const session = {
    sessionId: 'pi-session', model: { id: 'local-model' },
    getActiveToolNames: () => ['bash', 'read'],
    subscribe: (next: (event: any) => void) => {
      listener = next;
      return () => { calls.unsubscribed++; };
    },
    prompt: async () => { for (const event of events) { listener(event); } },
    dispose: () => { calls.disposed++; },
    getLastAssistantText: () => '',
    getSessionStats: () => ({ assistantMessages: 1, tokens: { input: 50, output: 20, total: 70 }, cost: 0.005 }),
    ...overrides,
  };
  pi.__setSdkForTest({ SessionManager: { create: () => ({}) } });
  pi.__setCreateAgentSessionForTest(async () => ({ session }));
  const options = { prompt: 'Work', worktree: '/tmp/task-2583', teeOptions: { stdoutSink: { write: (text: string) => { writes.push(text); } } } };
  return { session, calls, writes, options, emit: (event: any) => listener(event) };
}

const delta = (type: string, text: string) => ({ type: 'message_update', assistantMessageEvent: { type, delta: text } });

test('Pi streams thinking on one line and separates text, tools, and the completion summary', async () => {
  const f = fixture([
    delta('text_delta', 'Checking.'),
    delta('thinking_delta', 'Inspecting '), delta('thinking_delta', 'the repository'),
    { type: 'tool_execution_start', toolName: 'bash', toolCallId: 'one', args: { command: 'git status --short' } },
    { type: 'tool_execution_end', toolName: 'bash', toolCallId: 'one', result: { content: [{ type: 'text', text: 'clean' }] } },
    delta('text_delta', 'Complete.'),
  ]);
  const result = await pi.startPiAgent(f.options).resultPromise;
  assert.match(f.writes.join(''), /Checking\.\n✳ Inspecting the repository\n⚒ git status --short\n  ✓ clean\nComplete\.\n● done/);
  assert.match(f.writes.join(''), /● local-model · session pi-session · 2 tools/);
  assert.match(f.writes.join(''), /50 in \/ 20 out · \$0\.0050/);
  assert.doesNotMatch(f.writes.join(''), /\bbash\b|\x1b|\r/);
  assert.equal(result.stdout, 'Checking.Complete.', 'display formatting never changes the launch result');
  assert.equal(result.telemetry.cost_usd, 0.005);
});

test('Pi renders continuous thinking immediately before prompt settles without inserting timed line breaks', async () => {
  let finish: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const f = fixture([], { prompt: async () => {
    f.emit(delta('thinking_delta', 'Inspect'));
    await pending;
    f.emit(delta('thinking_delta', 'ing'));
  } });
  const { resultPromise } = pi.startPiAgent(f.options);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(f.writes.join('').endsWith('✳ Inspect'), 'reasoning is visible while the run remains pending');
  finish();
  await resultPromise;
  assert.match(f.writes.join(''), /✳ Inspecting\n● done/);
});

test('Pi captures output and stats before disposing and always cleans up a rejected prompt', async () => {
  const f = fixture([delta('text_delta', 'Partial')], {
    prompt: async () => { f.emit(delta('text_delta', 'Partial')); throw new Error('bad request'); },
    getSessionStats: () => {
      assert.equal(f.calls.disposed, 0);
      return { tokens: { input: 10, output: 2 } };
    },
  });
  const result = await pi.startPiAgent({ ...f.options, maxTransientRetries: 0 }).resultPromise;
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'Partial');
  assert.equal(result.telemetry.inputTokens, 10);
  assert.equal(f.calls.disposed, 1);
  assert.equal(f.calls.unsubscribed, 1);
  assert.match(f.writes.join(''), /Partial\nbad request\n● failed/);
});

test('Pi retries transient failures with visible progress and cleans up each attempt', async () => {
  const f = fixture();
  let attempts = 0;
  pi.__setCreateAgentSessionForTest(async () => ({ session: { ...f.session,
    prompt: async () => { if (++attempts === 1) { throw new Error('Connection refused'); } f.emit(delta('text_delta', 'Recovered')); },
  } }));
  const result = await pi.startPiAgent(f.options).resultPromise;
  assert.equal(result.status, 0);
  assert.equal(result.transientRetries, 1);
  assert.equal(result.stdout, 'Recovered');
  assert.equal(f.calls.disposed, 2);
  assert.equal(f.calls.unsubscribed, 2);
  assert.match(f.writes.join(''), /↻ retry 1\/1 · Connection refused/);
  assert.equal((f.writes.join('').match(/● done/g) || []).length, 1);
  assert.doesNotMatch(f.writes.join(''), /● failed/);
});

test('Pi fresh runs persist their session and ignore an old ID when resume is false', async () => {
  const f = fixture();
  const manager = {};
  let options: any;
  let createdCwd: string;
  pi.__setSdkForTest({ SessionManager: {
    create: (cwd: string) => { createdCwd = cwd; return manager; },
    list: () => { throw new Error('must not search stale session IDs on a fresh run'); },
  } });
  pi.__setCreateAgentSessionForTest(async value => { options = value; return { session: f.session }; });
  const result = await pi.startPiAgent({ ...f.options, sessionId: 'old-session', resume: false }).resultPromise;
  assert.equal(result.status, 0);
  assert.equal(createdCwd, f.options.worktree);
  assert.equal(options.sessionManager, manager);
});

test('Pi missing explicit session clears its marker and starts fresh instead of continuing another session', async () => {
  const f = fixture();
  const deleted: unknown[][] = [];
  let created = 0;
  pi.__setSdkForTest({ SessionManager: {
    list: async () => [{ id: 'unrelated', path: '/unrelated' }],
    create: () => { created++; return {}; },
    continueRecent: () => { throw new Error('must not continue an unrelated conversation'); },
  } });
  const result = await pi.startPiAgent({ ...f.options, resume: true, sessionId: 'missing',
    slug: missionId('task-2583'), role: sessionRole('execute'),
    sessionMarkerPort: { delete: async (...args: any[]) => { deleted.push(args); } } as any,
  }).resultPromise;
  assert.equal(result.status, 0);
  assert.deepEqual(deleted, [['task-2583', 'execute']]);
  assert.equal(created, 1);
  assert.match(f.writes.join(''), /stored Pi session is unavailable; starting a fresh session/);
});

test('Pi refuses stale-session recovery if the marker cannot be cleared', async () => {
  const f = fixture();
  pi.__setSdkForTest({ SessionManager: {
    list: async () => [], create: () => { throw new Error('must not launch'); },
  } });
  const result = await pi.startPiAgent({ ...f.options, resume: true, sessionId: 'missing' }).resultPromise;
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SessionMarkerPort is required/);
  assert.equal(f.calls.disposed, 0);
});

test('Pi reports setup failure, restores caller environment, and does not silently replace a missing model', async () => {
  const f = fixture();
  const before = process.env.TASK_2583_ENV;
  pi.__setSdkForTest({ SessionManager: { create: () => ({}) },
    AuthStorage: { create: () => ({}) }, ModelRegistry: { create: () => ({ find: () => undefined }) },
  });
  const result = await pi.startPiAgent({ ...f.options, model: 'provider/missing', env: { TASK_2583_ENV: 'temporary' } }).resultPromise;
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Pi model not found: provider\/missing/);
  assert.equal(process.env.TASK_2583_ENV, before);
  assert.equal(f.calls.disposed, 0);
  assert.match(f.writes.join(''), /● failed/);
});

test('Pi completion measures the actual run duration and treats abort as failure', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture([], { prompt: async () => {
    mock.timers.tick(250);
    f.emit({ type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'aborted' }], willRetry: false });
  } });
  const result = await pi.startPiAgent(f.options).resultPromise;
  assert.equal(Date.parse(result.endedAt) - Date.parse(result.startedAt), 250);
  assert.equal(result.status, 1);
  assert.match(f.writes.join(''), /● failed 250ms/);
});


test('Pi resumed usage and completion summaries exclude work billed in earlier launches', async () => {
  let prompted = false;
  const f = fixture([], {
    prompt: async () => { prompted = true; },
    getSessionStats: () => ({
      assistantMessages: prompted ? 12 : 10, toolCalls: prompted ? 8 : 5,
      tokens: { input: prompted ? 250 : 200, output: prompted ? 120 : 100, total: prompted ? 370 : 300 },
      cost: prompted ? 1.5 : 1.25,
    }),
  });
  pi.__setSdkForTest({ SessionManager: { continueRecent: () => ({}) } });
  const result = await pi.startPiAgent({ ...f.options, resume: true }).resultPromise;
  assert.equal(result.telemetry.inputTokens, 50);
  assert.equal(result.telemetry.outputTokens, 20);
  assert.equal(result.telemetry.totalTokens, 70);
  assert.equal(result.telemetry.toolCalls, 3);
  assert.equal(result.telemetry.cost_usd, 0.25);
  assert.match(f.writes.join(''), /2 turns · 50 in \/ 20 out · \$0\.2500/);
});

test('Pi telemetry getter failures do not discard successful assistant output', async () => {
  const f = fixture([delta('text_delta', 'Complete.')], { getSessionStats() { throw new Error('stats unavailable'); } });
  const result = await pi.startPiAgent(f.options).resultPromise;
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'Complete.');
  assert.equal(result.telemetry, null);
  assert.match(f.writes.join(''), /Complete\.\n● done/);
});
