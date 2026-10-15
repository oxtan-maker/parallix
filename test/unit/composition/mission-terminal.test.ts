import { resolveConfiguration } from '../../../src/composition/config.js';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { captureMissionCommand, hostMissionCommand, correlateMissionCapture } from '../../../src/composition/mission-terminal.js';
import { CurrentWorkRecorder, currentWorkPublication } from '../../../src/application/recording/current-work-recorder.js';
import { missionRunsDir } from '../../../src/adapters/filesystem/run-history-store.js';

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
