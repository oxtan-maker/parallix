// External command presentation owns synchronous-hook progress independently
// of command execution. Animation and the clock are doubles in this unit tier.
import test, { mock } from 'node:test';
import * as childProcess from 'node:child_process';
import { moduleMockOptions } from '../../../lib/module-mock.js';
import { commandProgressLabel } from '../../../../src/adapters/git/command-identity.js';
import assert from 'node:assert/strict';
import { withCommandProgress } from '../../../../src/adapters/git/command-progress.js';

for (const status of [0, 7, null]) {
  test(`external command progress preserves evidence and reports status ${status}`, () => {
    const events: string[] = [];
    let time = 0;
    const evidence = { status, stdout: 'captured output', stderr: 'captured diagnostic' };
    const result = withCommandProgress('Verification', () => {
      events.push('command'); time = 1250; return evidence;
    }, {
      write: message => { events.push(message); },
      now: () => time,
      animate: () => { events.push('animate'); return () => { events.push('clear'); }; },
    });
    assert.equal(result, evidence);
    assert.deepEqual(events, ['[ ] Verification', 'animate', 'command', 'clear',
      `${status === 0 ? '[✓]' : '[✗]'} Verification (1.3s)\n`]);
  });
}

test('external command exceptions clear progress and remain errors', () => {
  const events: string[] = [];
  const failure = new Error('spawn failed');
  assert.throws(() => withCommandProgress('Hook', () => { throw failure; }, {
    now: () => 0,
    write: message => { events.push(message); },
    animate: () => () => { events.push('clear'); },
  }), error => error === failure);
  assert.deepEqual(events, ['[ ] Hook', 'clear', '[✗] Hook (0.0s)\n']);
});

for (const status of [0, 7]) {
  test(`captured command progress emits one completed row for status ${status}`, () => {
    const output: string[] = [];
    withCommandProgress('git rebase', () => ({ status }), {
      write: message => { output.push(message); },
      now: () => 0,
      animate: false,
    });
    assert.deepEqual(output, [`${status === 0 ? '[✓]' : '[✗]'} git rebase (0.0s)\n`]);
  });
}

const identities: [string, string[], string][] = [
  ['bash', ['-c', 'npm test'], 'External command: bash -c "npm test"'],
  ['/bin/bash', ['-lc', './scripts/verify-local.sh docs'], 'External command: bash -lc "./scripts/verify-local.sh docs"'],
  ['bash', ['-e', './scripts/check.sh', 'private argument'], 'External command: bash ./scripts/check.sh'],
  ['bash', ['--noprofile', '-o', 'pipefail', '--', 'my script.sh'], 'External command: bash "my script.sh"'],
  ['/usr/bin/npm', ['test'], 'External command: npm'],
  ['git', ['push', 'https://user:private@example.test/repo'], 'External command: git'],
];
for (const [command, args, expected] of identities) {
  test(`command identity identifies ${expected} (TASK-2733)`, () => {
    assert.equal(commandProgressLabel(command, args), expected);
  });
}

test('command identity retains explicit purpose and exposes invoked command', () => {
  assert.equal(commandProgressLabel('bash', ['-c', 'npm test'], 'Repository verification (unit)'),
    'Repository verification (unit): bash -c "npm test"');
  assert.equal(commandProgressLabel('npm', ['test'], 'Custom check'), 'Custom check: npm');
});

test('command identity escapes multiline payloads and terminal controls on one line', () => {
  const label = commandProgressLabel('bash', ['-lc', 'printf "hello"\nnext\r\t\x1b[2J']);
  assert.equal(label, String.raw`External command: bash -lc "printf \"hello\"\nnext\r\t\u001b[2J"`);
  assert.doesNotMatch(label, /[\n\r\t\x1b]/);
});

test('command identity escapes C1 controls, line separators and bidirectional controls', () => {
  assert.equal(commandProgressLabel('bash', ['-c', 'printf \u009b\u2028\u202e']),
    String.raw`External command: bash -c "printf \u009b\u2028\u202e"`);
});

for (const payload of [
  'git push https://user:private@example.test/repo',
  'curl --token private', 'PASSWORD="private value" npm test',
  'git -c http.extraHeader="Authorization: Bearer private" fetch',
  'curl --api-key=private', 'curl --password private',
  'curl -u user:private https://example.test', 'AWS_ACCESS_KEY_ID=private npm test',
]) {
  test(`command identity protects credentials in ${payload.split(' ')[0]}`, () => {
    const label = commandProgressLabel('bash', ['-c', payload]);
    assert.match(label, /redacted sensitive command/);
    assert.doesNotMatch(label, /private/);
    assert.doesNotMatch(commandProgressLabel('npm', [], payload), /private/);
  });
}

for (const status of [0, 7, null]) {
  test(`run labels preserve execution evidence and one completed row for status ${status}`, async () => {
    const output: string[] = [];
    const args = ['-lc', 'printf first\nprintf second'];
    const failure = status === null ? new Error('spawn failed') : undefined;
    const evidence = { status, signal: null, stdout: 'captured output', stderr: 'captured diagnostic', error: failure };
    let calls = 0;
    mock.module('node:child_process', moduleMockOptions({ ...childProcess, spawnSync: (command: string, actual: string[], options: Record<string, unknown>) => {
      calls++;
      assert.equal(command, 'bash');
      assert.equal(actual, args);
      assert.equal(options.cwd, '/isolated');
      assert.equal(options.progressLabel, undefined);
      return evidence;
    } }) as Parameters<typeof mock.module>[1]);
    mock.method(process.stderr, 'write', (message: string) => { output.push(message); return true; });
    try {
      const { run } = await import(`../../../../src/adapters/git/git.js?progress=${status}`);
      const invoke = () => run('bash', args, { stdio: 'inherit', cwd: '/isolated', progressLabel: 'Hook' });
      if (failure) { assert.throws(invoke, error => error === failure); }
      else { assert.deepEqual(invoke(), evidence); }
      assert.equal(calls, 1);
      assert.equal(output.length, 1);
      assert.match(output[0], status === 0 ? /^\[✓\]/ : /^\[✗\]/);
      assert.match(output[0], /Hook: bash -lc "printf first\\nprintf second" \(\d+\.\ds\)\n$/);
    } finally { mock.restoreAll(); }
  });
}

test('run retains help and ignored-output progress suppression', async () => {
  let calls = 0;
  mock.module('node:child_process', moduleMockOptions({ ...childProcess, spawnSync: () => {
    calls++; return { status: 0, signal: null, stdout: 'help', stderr: '' };
  } }) as Parameters<typeof mock.module>[1]);
  const output: string[] = [];
  mock.method(process.stderr, 'write', (message: string) => { output.push(message); return true; });
  try {
    const { run } = await import('../../../../src/adapters/git/git.js' + '?progress=suppression');
    assert.equal(run('bash', ['--help']).stdout, 'help');
    assert.equal(run('bash', ['-c', 'printf ignored'], { stdio: 'ignore' }).status, 0);
    assert.equal(calls, 2);
    assert.deepEqual(output, []);
  } finally { mock.restoreAll(); }
});
