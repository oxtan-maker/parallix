import { agentFamily } from '../../../src/domain/agents.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { captureMissionCommand, hostMissionCommand, correlateMissionCapture } from '../../../src/composition/mission-terminal.js';
import { CurrentWorkRecorder, currentWorkPublication } from '../../../src/application/recording/current-work-recorder.js';
import { createMissionTerminalResources } from '../../../src/adapters/cli/commands/mission-terminal-resources.js';
import { missionSocketPath } from '../../../src/adapters/process/tmux-host.js';
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
  const recorder = new CurrentWorkRecorder({ append: async () => {}, list: async () => [] } as never, {
    onPublication: work => correlateMissionCapture(root, configuration, work),
  });
  const code = await captureMissionCommand('active', ['task-999999.7'], root, configuration, async () => {
    const foreign = currentWorkPublication({ slug: 'task-other', operationId: 'foreign', phase: 'execute', summary: 'other Mission' })!;
    await recorder.running(foreign);
    const work = currentWorkPublication({ slug: 'task-999999.7', operationId: 'existing-work-operation', phase: 'execute', summary: 'coordinator work' })!;
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
