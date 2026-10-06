import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { hostMissionCommand } from '../../../src/composition/mission-terminal.js';

const cli = { command: process.execPath, args: ['-e', 'process.exit(99)'] };

test('mission terminal host leaves headless and ineligible commands to the pipe dispatcher (TASK-2643)', async () => {
  const root = mkdtemp('px-mission-terminal-host-');
  const log: string[] = [];

  assert.equal(await hostMissionCommand('active', ['task-2643'], root, line => log.push(line), cli, { interactive: false }), null);
  assert.equal(await hostMissionCommand('stats', ['task-2643'], root, line => log.push(line), cli, { interactive: true }), null);
  assert.deepEqual(log, []);
});

test('mission terminal host honours the configured pipe override before probing tmux (TASK-2643)', async () => {
  const root = mkdtemp('px-mission-terminal-pipe-');
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { terminal: { host: 'pipe' } } }));
  const log: string[] = [];

  const result = await hostMissionCommand('active', ['task-999999'], root, line => log.push(line), cli, { interactive: true });

  assert.equal(result, null);
  assert.deepEqual(log, []);
});
