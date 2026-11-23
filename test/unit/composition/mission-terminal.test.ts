import { ActivityRecorderFixture } from '../../fixtures/execution-activity.js';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { agentFamily } from '../../../src/domain/agents.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { captureMissionCommand, hostMissionCommand, correlateMissionCapture, hostWorkflowExecutor } from '../../../src/composition/mission-terminal.js';
import { executionActivityIntent } from '../../../src/application/recording/execution-activity-recorder.js';
import { createMissionTerminalResources } from '../../../src/adapters/cli/commands/mission-terminal-resources.js';
import { missionSocketPath } from '../../../src/adapters/process/tmux-host.js';
import type { TmuxLaunch } from '../../../src/adapters/process/tmux-host.js';
import { bulkStorageProbe } from '../../../src/adapters/process/bulk-storage.js';
import { readProcessStat, runNativeStartIdentity } from '../../../src/adapters/process/process-liveness.js';
import { resolveCanonicalRepositoryId } from '../../../src/adapters/git/repository-identity.js';
import { openRunCapture, missionRunsDir } from '../../../src/adapters/filesystem/run-history-store.js';

const cli = { command: process.execPath, args: ['-e', 'process.exit(99)'] };

test('mission terminal host leaves headless and ineligible commands to the pipe dispatcher (TASK-2643)', async () => {
  const root = mkdtemp('px-mission-terminal-host-');
  const log: string[] = [];

  assert.equal(await hostMissionCommand('active', ['task-2643'], root, line => log.push(line), cli, { configuration: resolveConfiguration({}), interactive: false }), null);
  assert.equal(await hostMissionCommand('stats', ['task-2643'], root, line => log.push(line), cli, { configuration: resolveConfiguration({}), interactive: true }), null);
  assert.deepEqual(log, []);
});

test('mission terminal host honours the configured pipe override before probing tmux (TASK-2643)', async () => {
  const root = mkdtemp('px-mission-terminal-pipe-');
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { terminal: { host: 'pipe' } } }));
  const log: string[] = [];

  const result = await hostMissionCommand('active', ['task-999999'], root, line => log.push(line), cli, { configuration: resolveConfiguration({}), interactive: true });

  assert.equal(result, null);
  assert.deepEqual(log, []);
});

test('a pipe-executed mission operation is retained as one attributed, partial-capture history record (TASK-2749)', async () => {
  const root = mkdtemp('px-mission-terminal-capture-');
  const configuration = resolveConfiguration({});
  const recorder = new ActivityRecorderFixture({ append: async () => {}, list: async () => [] } as never, {
    onPublication: work => correlateMissionCapture(root, configuration, work),
  });
  const code = await captureMissionCommand('active', ['task-999999.7'], root, configuration, async () => {
    const foreign = executionActivityIntent({ slug: 'task-other', operationId: 'foreign', phase: 'execute', summary: 'other Mission' })!;
    await recorder.running(foreign);
    const work = executionActivityIntent({ slug: 'task-999999.7', operationId: 'existing-work-operation', phase: 'execute', summary: 'coordinator work' })!;
    await recorder.running(work);
    await recorder.ended(work);
    process.stdout.write('HARNESS-PREFLIGHT-LINE\n');
    process.stderr.write(Buffer.from('GATE-DIAGNOSTIC\n'));
    return 3;
  });
  assert.equal(code, 3);
  const runsDir = missionRunsDir(root, 'task-999999.7');
  const [runId] = fs.readdirSync(runsDir);
  const record = JSON.parse(fs.readFileSync(path.join(runsDir, runId, 'run.json'), 'utf8'));
  assert.equal(record.captureKind, 'coordinator');
  assert.equal(record.attempt, null, 'coordinator work is not an agent attempt');
  assert.match(runId, /^workflow-/);
  assert.equal(record.operationId, 'existing-work-operation', 'correlates the existing CurrentWork id, ignoring another Mission');
  assert.equal(record.repositoryKey, undefined, 'native storage keys are absent from new logical records');
  assert.deepEqual([record.missionId, record.role, record.family, record.terminalHost, record.exitCode, record.state], ['task-999999.7', 'active', null, 'pipe', 3, 'exited']);
  assert.match(fs.readFileSync(path.join(runsDir, runId, 'stdout', '000000000000.log'), 'utf8'), /HARNESS-PREFLIGHT-LINE/);
  assert.match(fs.readFileSync(path.join(runsDir, runId, 'stderr', '000000000000.log'), 'utf8'), /GATE-DIAGNOSTIC/, 'stream attribution is kept');
  assert.ok(record.omissions.some((line: string) => /not captured in pipe execution/.test(line)), 'partial capture is explicit');
  assert.equal(record.sources[0].complete, false);

  const hosted = await captureMissionCommand('active', ['task-999999.7'], root, resolveConfiguration({ PARALLIX_OPERATION_CAPTURE: 'active-parallix-a1-x' }), async () => 0);
  const other = await captureMissionCommand('stats', [], root, configuration, async () => 0);
  assert.deepEqual([hosted, other, fs.readdirSync(runsDir).length], [0, 0, 1], 'a supervised operation and non-mission commands add no second record');
});

test('an idle console beside newer pipe history is retained output, not current activity (TASK-2861.04)', t => {
  const root = mkdtemp('px-mission-terminal-idle-console-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mission = 'task-999999.8';
  const repositoryId = resolveCanonicalRepositoryId(root);
  const configuration = resolveConfiguration({ PARALLIX_TERMINAL_STATE_DIR: path.join(root, 'terminal') });
  const capture = openRunCapture({
    worktree: root,
    identity: { repositoryId, missionId: mission, role: 'active', family: null, attempt: null },
    runId: 'workflow-active-a1-pipe',
    captureKind: 'coordinator',
    terminalHost: 'pipe',
  });
  capture.write('stdout', Buffer.from('NEWER-PIPE-HISTORY\n'));
  capture.finish({ exitCode: 0, signal: null });
  const socket = missionSocketPath({ repositoryKey: 'abc123', missionId: mission }, configuration);
  fs.mkdirSync(path.dirname(socket), { recursive: true });
  fs.writeFileSync(socket, '');
  const capability = createMissionTerminalResources(root, {
    configuration,
    repositoryKeyFn: () => 'abc123',
    resolveWorktreeFn: () => null,
    spawnSyncFn: ((_cmd: string, args: string[]) => {
      if (args.includes('list-sessions')) { return { status: 0, stdout: 'task-999999_8\n' }; }
      if (args.includes('list-windows')) { return { status: 0, stdout: 'console\t\t\t\n' }; }
      if (args.includes('capture-pane')) { return { status: 0, stdout: 'OLDER-IDLE-CONSOLE\n' }; }
      throw new Error(`unexpected tmux command: ${args.join(' ')}`);
    }) as never,
  });

  const result = capability.live(mission);
  assert.ok('kind' in result);
  assert.equal(result.kind, 'idle-console');
  assert.ok('output' in result);
  assert.equal(result.output, 'OLDER-IDLE-CONSOLE\n');
});


test('retained operations and readable output survive failed and timed out probes (TASK-2764)', async () => {
  const root = mkdtemp('px-retained-probe-');
  const configuration = resolveConfiguration({ PARALLIX_TERMINAL_STATE_DIR: path.join(root, 'terminal') });
  await captureMissionCommand('active', ['task-999999.7'], root, configuration, async () => {
    process.stdout.write('RETAINED-OBSERVATION-MARKER\n');
    return 0;
  });
  const [runId] = fs.readdirSync(missionRunsDir(root, 'task-999999.7'));
  const socket = missionSocketPath({ repositoryKey: 'abc123', missionId: 'task-999999.7' }, configuration);
  fs.mkdirSync(path.dirname(socket), { recursive: true });
  fs.writeFileSync(socket, '');
  for (const reason of ['failed', 'timeout'] as const) {
    const calls: string[][] = [];
    const capability = createMissionTerminalResources(root, { configuration, repositoryKeyFn: () => 'abc123', resolveWorktreeFn: () => null,
      spawnSyncFn: ((_cmd: string, args: string[]) => {
        calls.push(args);
        return reason === 'timeout' ? { status: null, error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }
          : { status: 1, stderr: 'error connecting to socket (Permission denied)' };
      }) as never });
    const result = capability.overview('task-999999.7');
    assert.ok('state' in result);
    assert.equal(result.state, reason === 'timeout' ? 'probe-timeout' : 'probe-failed');
    assert.equal(result.operations[0].runId, runId);
    const page = capability.page('task-999999.7', { runId, stream: 'stdout' });
    assert.ok(page.ok);
    assert.match(page.text, /RETAINED-OBSERVATION-MARKER/);
    assert.ok(fs.existsSync(path.join(missionRunsDir(root, 'task-999999.7'), runId, 'run.json')));
    assert.ok(calls.every(args => args.includes('list-sessions')), 'observation never retires history or mutates tmux');
  }
});

test('terminal resources use only attributed recorded execution identity (TASK-2764)', t => {
  const root = mkdtemp('px-retained-identity-');
  const configuration = resolveConfiguration({ PARALLIX_TERMINAL_STATE_DIR: path.join(root, 'terminal') });
  const mission = 'task-999999.7';
  const runId = 'execute-claude-a1-abc';
  const repositoryId = resolveCanonicalRepositoryId(root);
  const capture = openRunCapture({ worktree: root, identity: { repositoryId, missionId: mission, role: 'execute', family: agentFamily('claude'), attempt: 1 }, runId, terminalHost: 'tmux' });
  const startId = process.platform === 'linux' ? '123' : '2026-01-01T00:00:00.000Z';
  capture.observeExecution(12, startId);
  const socket = missionSocketPath({ repositoryKey: 'abc123', missionId: mission }, configuration);
  fs.mkdirSync(path.dirname(socket), { recursive: true });
  fs.writeFileSync(socket, '');
  t.mock.method(process, 'kill', () => true);
  let matches = true;
  t.mock.method(readProcessStat, 'sync', () => `12 (command) ${Array(19).fill('0').join(' ')} ${matches ? '123' : '456'}`);
  t.mock.method(runNativeStartIdentity, 'execFileSync', () => matches ? startId : '2026-01-02T00:00:00.000Z');
  const capability = createMissionTerminalResources(root, { configuration, repositoryKeyFn: () => 'abc123', resolveWorktreeFn: () => null,
    spawnSyncFn: ((_cmd: string, args: string[]) => ({ status: 0, stdout: args.includes('list-sessions') ? 'task-999999_7\n' : `window\t11\t12\t${runId}\n` })) as never });
  const execution = () => { const probe = capability.probe(mission); assert.ok('kind' in probe); return probe.kind === 'live' ? probe.execution : probe.kind; };
  assert.equal(execution(), true);
  matches = false;
  assert.equal(execution(), 'idle', 'a reused PID does not leave the mission live');
  matches = true;
  const file = path.join(capture.dir, 'run.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...record, repositoryId: 'foreign-repository' }));
  assert.equal(execution(), null, 'foreign identity does not establish liveness');
  fs.writeFileSync(file, JSON.stringify({ ...record, execution: null }));
  assert.equal(execution(), null, 'legacy records without identity remain unknown');
});


test('pipe workflow executor inherits one capture and combines observed stream order (TASK-2771)', async t => {
  const root = mkdtemp('px-workflow-pipe-');
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { terminal: { host: 'pipe' } } }));
  const original = childProcess.spawn;
  t.after(() => { childProcess.spawn = original; syncBuiltinESMExports(); fs.rmSync(root, { recursive: true, force: true }); });
  let environment: NodeJS.ProcessEnv | undefined;
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  childProcess.spawn = ((_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
    environment = options.env;
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('first\n'));
      child.stderr.emit('data', Buffer.from('second\n'));
      child.stdout.emit('data', Buffer.from('third\n'));
      child.emit('close', 0, null);
    });
    return child;
  }) as unknown as typeof childProcess.spawn;
  syncBuiltinESMExports();
  const output: Array<[string, string]> = [];
  const capture = { setTerminalHost() {}, write: (stream: string, bytes: Buffer) => output.push([stream, bytes.toString()]) } as unknown as import('../../../src/adapters/filesystem/run-history-store.js').RunCapture;
  const operation = { id: 'owned', missionId: 'task-one', command: 'review:submit' } as import('../../../src/domain/workflow-operation.js').WorkflowOperation;
  assert.deepEqual(await hostWorkflowExecutor(cli, operation, root, 'workflow-capture', capture, resolveConfiguration({})), { exitCode: 0, signal: null });
  assert.equal(environment?.PARALLIX_OPERATION_CAPTURE, 'workflow-capture', 'executor cannot create a duplicate coordinator capture');
  assert.deepEqual(output, [['stdout', 'first\n'], ['stdout', 'second\n'], ['stdout', 'third\n']]);
});

/** Operations recorded before TASK-2861.03 carry interactive=false for board- and agent-initiated workflows; hosting ignores it and follows the terminal-host policy alone. */
const backgroundOperation = { id: 'owned', missionId: 'task-999999.3', command: 'review:submit', invocation: { command: 'review', args: ['task-999999.3'], interactive: false } } as unknown as import('../../../src/domain/workflow-operation.js').WorkflowOperation;

test('a background workflow executor hosts in the mission terminal when auto selects an available tmux (TASK-2861.03)', async t => {
  t.mock.method(bulkStorageProbe, 'statfs', () => ({ type: 0xef53 }));
  t.mock.method(bulkStorageProbe, 'writable', () => true);
  const root = terminalRoot('px-workflow-background-', { host: 'auto' });
  const configuration = resolveConfiguration({ PARALLIX_TERMINAL_STATE_DIR: path.join(root, 'terminal') });
  const launches: TmuxLaunch[] = [];
  const hosts: unknown[][] = [];
  const output: string[] = [];
  const capture = { setTerminalHost: (...args: unknown[]) => hosts.push(args), addTmuxSession() {}, observeExecution() {}, write: (_stream: string, bytes: Buffer) => output.push(bytes.toString()) } as unknown as import('../../../src/adapters/filesystem/run-history-store.js').RunCapture;
  const paneEnvironments: string[] = [];
  const supervise = (async (launch: TmuxLaunch) => { launches.push(launch); paneEnvironments.push(fs.readFileSync(path.join(path.dirname(launch.args[0]), 'pane.env'), 'utf8')); fs.writeFileSync(path.join(path.dirname(launch.args[0]), 'command.pid'), '1'); return { exitCode: 5, signal: null }; }) as never;
  const exit = await hostWorkflowExecutor(cli, backgroundOperation, root, 'workflow-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', capture, configuration, () => ({ available: true, reason: null }), supervise);
  assert.deepEqual([exit, launches.length, hosts.map(host => host[0]), output], [{ exitCode: 5, signal: null }, 1, ['tmux'], []]);
  // Agent descendants inherit this terminal through these markers instead of creating another host.
  assert.match(paneEnvironments[0], /export PARALLIX_MISSION_TERMINAL='task-999999\.3'/);
  assert.match(paneEnvironments[0], /export PARALLIX_MISSION_SOCKET='[^']+'/);
});

test('a tmux-hosted background executor reports signal termination like the pipe host (TASK-2861.03)', async t => {
  t.mock.method(bulkStorageProbe, 'statfs', () => ({ type: 0xef53 }));
  t.mock.method(bulkStorageProbe, 'writable', () => true);
  const root = terminalRoot('px-workflow-signal-', { host: 'auto' });
  const configuration = resolveConfiguration({ PARALLIX_TERMINAL_STATE_DIR: path.join(root, 'terminal') });
  const capture = { setTerminalHost() {}, addTmuxSession() {}, observeExecution() {}, write() {} } as unknown as import('../../../src/adapters/filesystem/run-history-store.js').RunCapture;
  const outcome = async (exit: { exitCode: number | null; signal: NodeJS.Signals | null }) => {
    const supervise = (async (launch: TmuxLaunch) => { fs.writeFileSync(path.join(path.dirname(launch.args[0]), 'command.pid'), '1'); return exit; }) as never;
    return hostWorkflowExecutor(cli, backgroundOperation, root, 'workflow-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', capture, configuration, () => ({ available: true, reason: null }), supervise);
  };
  assert.deepEqual(await outcome({ exitCode: 143, signal: null }), { exitCode: 143, signal: null }, 'a deliberate 128-plus exit stays numeric');
  assert.deepEqual(await outcome({ exitCode: null, signal: 'SIGTERM' }), { exitCode: null, signal: 'SIGTERM' });
  assert.deepEqual(await outcome({ exitCode: null, signal: 'SIGINT' }), { exitCode: null, signal: 'SIGINT' });
  assert.deepEqual(await outcome({ exitCode: null, signal: 'SIGKILL' }), { exitCode: null, signal: 'SIGKILL' });
  assert.deepEqual(await outcome({ exitCode: 1, signal: null }), { exitCode: 1, signal: null });
  assert.deepEqual(await outcome({ exitCode: 0, signal: null }), { exitCode: 0, signal: null });
});

test('a background workflow executor never bypasses an explicit pipe or tmux setting (TASK-2861.03)', async t => {
  const original = childProcess.spawn;
  t.after(() => { childProcess.spawn = original; syncBuiltinESMExports(); });
  const spawned: string[] = [];
  childProcess.spawn = ((command: string) => {
    spawned.push(command);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    queueMicrotask(() => child.emit('close', 0, null));
    return child;
  }) as unknown as typeof childProcess.spawn;
  syncBuiltinESMExports();
  const probe = () => { throw new Error('an explicit pipe host must not probe tmux'); };
  const run = async (terminal: Record<string, string>, available: () => { available: boolean; reason: string | null }) => {
    const output: string[] = [];
    const hosts: unknown[][] = [];
    const capture = { setTerminalHost: (...args: unknown[]) => hosts.push(args), write: (_stream: string, bytes: Buffer) => output.push(bytes.toString()) } as unknown as import('../../../src/adapters/filesystem/run-history-store.js').RunCapture;
    const exit = await hostWorkflowExecutor(cli, backgroundOperation, terminalRoot('px-workflow-background-setting-', terminal), 'workflow-background', capture, resolveConfiguration({}), available);
    return { exit, output, hosts };
  };
  const pipe = await run({ host: 'pipe' }, probe);
  assert.deepEqual([pipe.exit, pipe.output, pipe.hosts], [{ exitCode: 0, signal: null }, [], [['pipe', null]]], 'explicit pipe runs on the pipe host silently');
  const fallback = await run({ host: 'tmux', whenUnavailable: 'fallback' }, missingTmux);
  assert.deepEqual([fallback.exit, fallback.hosts], [{ exitCode: 0, signal: null }, [['pipe', null]]]);
  assert.match(fallback.output.join(''), /tmux is not runnable \(ENOENT\).*pipe host/, 'the fallback records its reason');
  const spawnedBeforeRefusal = spawned.length;
  await assert.rejects(run({ host: 'tmux', whenUnavailable: 'fail' }, missingTmux), /Terminal host unavailable: tmux is not runnable/);
  assert.equal(spawned.length, spawnedBeforeRefusal, 'a refused launch never reaches the pipe host');
});

// Foreground and executor hosting report why the pipe host took over (TASK-2861.01).
function terminalRoot(prefix: string, terminal: Record<string, string>): string {
  const root = mkdtemp(prefix);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { terminal } }));
  return root;
}
const missingTmux = () => ({ available: false, reason: 'tmux is not runnable (ENOENT)' });

test('foreground hosting hands the pipe fallback reason to the recorded run and tells only an explicit tmux request (TASK-2861.01)', async () => {
  for (const [host, logged] of [['auto', false], ['tmux', true]] as const) {
    const root = terminalRoot('px-foreground-fallback-', { host });
    const log: string[] = [];
    const reasons: string[] = [];
    const result = await hostMissionCommand('active', ['task-999999'], root, line => log.push(line), cli,
      { configuration: resolveConfiguration({}), interactive: true, probe: missingTmux, onPipeFallback: reason => reasons.push(reason) });
    assert.equal(result, null);
    assert.deepEqual(reasons, ['tmux is not runnable (ENOENT)']);
    assert.deepEqual(log.map(line => /ENOENT.*pipe host/.test(line)), logged ? [true] : []);
  }
});

test('foreground hosting refuses when tmux is required and unavailable, and never probes inside the mission terminal (TASK-2861.01)', async () => {
  const root = terminalRoot('px-foreground-required-', { host: 'tmux', whenUnavailable: 'fail' });
  await assert.rejects(hostMissionCommand('active', ['task-999999'], root, () => {}, cli,
    { configuration: resolveConfiguration({}), interactive: true, probe: missingTmux }), /Terminal host unavailable: tmux is not runnable/);
  const inherited = await hostMissionCommand('active', ['task-999999'], root, () => {}, cli,
    { configuration: resolveConfiguration({ PARALLIX_MISSION_TERMINAL: 'task-999999' }), interactive: true, probe: () => { throw new Error('inherited terminal must not probe'); } });
  assert.equal(inherited, null);
});

test('a pipe-executed operation records the host fallback reason it was given (TASK-2861.01)', async () => {
  const root = mkdtemp('px-capture-fallback-');
  await captureMissionCommand('active', ['task-999999.8'], root, resolveConfiguration({}), async () => 0, 'tmux is not runnable (ENOENT)');
  const runsDir = missionRunsDir(root, 'task-999999.8');
  const [runId] = fs.readdirSync(runsDir);
  const record = JSON.parse(fs.readFileSync(path.join(runsDir, runId, 'run.json'), 'utf8'));
  assert.deepEqual([record.terminalHost, record.hostFallbackReason], ['pipe', 'tmux is not runnable (ENOENT)']);
});

test('a workflow executor records an unavailable tmux host once and refuses when tmux is required (TASK-2861.01)', async t => {
  const original = childProcess.spawn;
  t.after(() => { childProcess.spawn = original; syncBuiltinESMExports(); });
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  childProcess.spawn = (() => { queueMicrotask(() => child.emit('close', 0, null)); return child; }) as unknown as typeof childProcess.spawn;
  syncBuiltinESMExports();
  const output: string[] = [];
  const capture = { setTerminalHost() {}, write: (_stream: string, bytes: Buffer) => output.push(bytes.toString()) } as unknown as import('../../../src/adapters/filesystem/run-history-store.js').RunCapture;
  const operation = { id: 'owned', missionId: 'task-one', command: 'review:submit' } as unknown as import('../../../src/domain/workflow-operation.js').WorkflowOperation;
  const fallback = terminalRoot('px-workflow-fallback-', { host: 'tmux' });
  assert.deepEqual(await hostWorkflowExecutor(cli, operation, fallback, 'workflow-fallback', capture, resolveConfiguration({}), missingTmux), { exitCode: 0, signal: null });
  assert.equal(output.length, 1);
  assert.match(output[0], /tmux is not runnable \(ENOENT\).*pipe host/);
  const required = terminalRoot('px-workflow-required-', { host: 'tmux', whenUnavailable: 'fail' });
  await assert.rejects(hostWorkflowExecutor(cli, operation, required, 'workflow-required', capture, resolveConfiguration({}), missingTmux), /Terminal host unavailable/);
});

test('a hosted launch that cannot be prepared falls back with its reason, or refuses when tmux is required (TASK-2861.01)', async () => {
  const blocked = mkdtemp('px-blocked-state-');
  fs.writeFileSync(path.join(blocked, 'state'), '');
  const configuration = resolveConfiguration({ PARALLIX_TERMINAL_STATE_DIR: path.join(blocked, 'state', 'terminal') });
  const ready = () => ({ available: true, reason: null });
  const root = terminalRoot('px-prepare-fallback-', { host: 'auto' });
  const log: string[] = [];
  const reasons: string[] = [];
  assert.equal(await hostMissionCommand('active', ['task-999999'], root, line => log.push(line), cli,
    { configuration, interactive: true, probe: ready, onPipeFallback: reason => reasons.push(reason) }), null);
  assert.equal(reasons.length, 1);
  assert.deepEqual(log, [`Mission terminal unavailable; running through the pipe host: ${reasons[0]}`]);
  const required = terminalRoot('px-prepare-required-', { host: 'tmux', whenUnavailable: 'fail' });
  await assert.rejects(hostMissionCommand('active', ['task-999999'], required, () => {}, cli, { configuration, interactive: true, probe: ready }));

  const output: string[] = [];
  const capture = { setTerminalHost() {}, write: (_stream: string, bytes: Buffer) => output.push(bytes.toString()) } as unknown as import('../../../src/adapters/filesystem/run-history-store.js').RunCapture;
  const operation = { id: 'owned', missionId: 'task-one', command: 'review:submit' } as unknown as import('../../../src/domain/workflow-operation.js').WorkflowOperation;
  await assert.rejects(hostWorkflowExecutor(cli, operation, required, 'workflow-prepare', capture, configuration, ready));
});

type StartupFailure = 'tmux-missing' | 'unsafe-state-directory';
const POLICIES = [
  { adapters: { terminal: { host: 'auto' } }, outcome: 'silent handover' },
  { adapters: { terminal: { host: 'tmux', whenUnavailable: 'fallback' } }, outcome: 'one report then handover' },
  { adapters: { terminal: { host: 'tmux', whenUnavailable: 'fail' } }, outcome: 'refusal' },
] as const;

/** One startup failure before any command exists, observed through both hosted callers (TASK-2861.02). */
for (const failure of ['tmux-missing', 'unsafe-state-directory'] as StartupFailure[]) {
  for (const policy of POLICIES) {
    test(`foreground and workflow hosting share startup-failure handling: ${failure}, ${policy.outcome} (TASK-2861.02)`, async t => {
      const root = mkdtemp('px-hosted-startup-');
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: policy.adapters }));
      const stateFile = path.join(root, 'state-is-a-file');
      fs.writeFileSync(stateFile, '');
      const configuration = resolveConfiguration(failure === 'unsafe-state-directory' ? { PARALLIX_TERMINAL_STATE_DIR: stateFile } : {});
      t.mock.method(childProcess, 'spawnSync', (command: string, args: string[]) => command === 'tmux' && args[0] === '-V'
        ? (failure === 'tmux-missing' ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout: 'tmux 3.4\n', stderr: '' })
        : { status: 1, stdout: '', stderr: '' });
      const log: string[] = [];
      const reasons: string[] = [];
      const output: string[] = [];
      const executor = path.join(root, 'executor.cjs');
      fs.writeFileSync(executor, 'process.exit(7);');
      const capture = { setTerminalHost() {}, addTmuxSession() { assert.fail('no session exists before the launch is prepared'); }, write: (_stream: string, bytes: Buffer) => output.push(bytes.toString()) } as unknown as import('../../../src/adapters/filesystem/run-history-store.js').RunCapture;
      const operation = { id: 'owned', missionId: 'task-999999.7', command: 'review:submit' } as import('../../../src/domain/workflow-operation.js').WorkflowOperation;
      const foreground = hostMissionCommand('active', ['task-999999.7'], root, line => log.push(line), cli, { configuration, interactive: true, onPipeFallback: reason => reasons.push(reason) });
      const workflow = hostWorkflowExecutor({ command: process.execPath, args: [executor] }, operation, root, 'workflow-startup', capture, configuration);
      const reason = failure === 'tmux-missing' ? /tmux is not runnable/ : /state|terminal|ENOTDIR|EEXIST/i;
      if (policy.outcome === 'refusal') {
        await assert.rejects(foreground, reason);
        await assert.rejects(workflow, reason);
        assert.deepEqual([log, reasons, output], [[], [], []], 'a refusal throws instead of reporting');
        return;
      }
      assert.equal(await foreground, null, 'the operation is handed to the pipe host');
      // The foreground tells the operator unless tmux was never explicitly requested and merely missing; the reason is always handed to the recorded run.
      const told = policy.outcome === 'silent handover' && failure === 'tmux-missing' ? 0 : 1;
      assert.equal(log.length, told, 'a startup failure is reported once');
      if (told) { assert.match(log[0], reason); assert.match(log[0], /running through the pipe host/); }
      assert.equal(reasons.length, 1);
      assert.match(reasons[0], reason);
      // The workflow handover spawns the real executor command; this fixture command exits at once.
      assert.equal((await workflow).exitCode, 7);
      assert.equal(output.length, 1, 'the coordinator transcript carries one report');
      assert.match(output[0], reason);
    });
  }
}

/** The post-prepare boundary: host.sh exits 70 before the command exists, but a started command may itself exit 70 (TASK-2861.02). */
for (const caller of ['foreground', 'workflow'] as const) {
  test(`${caller} hosting replays nothing that started and hands over or refuses only what never started (TASK-2861.02)`, async t => {
    t.mock.method(bulkStorageProbe, 'statfs', () => ({ type: 0xef53 }));
    t.mock.method(bulkStorageProbe, 'writable', () => true);
    const ready = () => ({ available: true, reason: null });
    const supervised = (exitCode: number, started: boolean) => { const calls: TmuxLaunch[] = []; return { calls, supervise: (async (launch: TmuxLaunch) => {
      calls.push(launch);
      if (started) { fs.writeFileSync(path.join(path.dirname(launch.args[0]), 'command.pid'), '1'); }
      return { exitCode, signal: null };
    }) as never }; };
    const run = async (adapters: Record<string, string>, exitCode: number, started: boolean) => {
      const root = terminalRoot(`px-${caller}-post-prepare-`, adapters);
      const configuration = resolveConfiguration({ PARALLIX_TERMINAL_STATE_DIR: path.join(root, 'terminal') });
      const { calls, supervise } = supervised(exitCode, started);
      const log: string[] = [];
      const reasons: string[] = [];
      const output: string[] = [];
      const capture = { setTerminalHost() {}, addTmuxSession() {}, observeExecution() {}, write: (_stream: string, bytes: Buffer) => output.push(bytes.toString()) } as unknown as import('../../../src/adapters/filesystem/run-history-store.js').RunCapture;
      const operation = { id: 'owned', missionId: 'task-999999.9', command: 'review:submit' } as unknown as import('../../../src/domain/workflow-operation.js').WorkflowOperation;
      const exit = caller === 'foreground'
        ? await hostMissionCommand('active', ['task-999999.9'], root, line => log.push(line), cli, { configuration, interactive: true, probe: ready, supervise, onPipeFallback: reason => reasons.push(reason) })
        : (await hostWorkflowExecutor(cli, operation, root, 'workflow-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', capture, configuration, ready, supervise)).exitCode;
      assert.equal(calls.length, 1, 'the prepared launch is supervised exactly once and never replayed');
      return { exit, told: [...log.filter(line => !line.startsWith('Mission terminal: px attach')), ...output, ...reasons] };
    };
    const auto = { host: 'auto' };
    assert.equal((await run(auto, 70, true)).exit, 70, 'a started command keeps its own exit code');
    const other = await run(auto, 3, false);
    assert.deepEqual([other.exit, other.told], [3, []], 'only the host-failure code hands over');
    const handover = await run(auto, 70, false);
    // The foreground hands the operation to the pipe dispatcher; the executor runs it on pipes itself and returns that run's exit.
    if (caller === 'foreground') { assert.equal(handover.exit, null); } else { assert.notEqual(handover.exit, 70); }
    assert.ok(handover.told.some(line => /Terminal host failed before the command started/.test(line)), 'the handover carries its reason');
    await assert.rejects(run({ host: 'tmux', whenUnavailable: 'fail' }, 70, false), /Terminal host failed before the command started/);
  });
}
