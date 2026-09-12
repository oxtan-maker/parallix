// @ts-nocheck -- focused regression for task-2495: the hallucinated `px mission-start`
// command is removed from the CLI surface and can never reach startup preflight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { main, KNOWN_COMMANDS, suggestCommand } from '../src/interfaces/cli/runtime.js';

// The command is gone from the canonical command table, so help and the
// "did you mean" suggestion can no longer advertise it.
test('KNOWN_COMMANDS no longer registers mission-start', () => {
  assert.equal(KNOWN_COMMANDS.includes('mission-start'), false);
});

test('suggestCommand never proposes mission-start', () => {
  assert.equal(suggestCommand('missionstart'), null);
  assert.equal(suggestCommand('mission-start'), null);
});

// Dispatching `px mission-start` must fall through to the unknown-command path:
// it reports "Unknown command: mission-start", prints usage, and exits 1 without
// ever invoking the startup-preflight implementation.
test('px mission-start resolves to Unknown command and never reaches preflight', async () => {
  const errors = [];
  let exitedWith = 'unset';
  let usagePrinted = false;

  await main(['mission-start'], {
    commandFns: {},
    loadAliasesFn: () => ({}),
    cwdFn: () => '/tmp/nowhere',
    errorFn: (msg) => errors.push(String(msg)),
    printUsageFn: () => { usagePrinted = true; },
    exitFn: (code) => { exitedWith = code; },
  });

  assert.equal(exitedWith, 1, 'unknown command must exit non-zero');
  assert.ok(usagePrinted, 'usage must be printed for an unknown command');
  assert.ok(
    errors.some((line) => /Unknown command: mission-start/.test(line)),
    'dispatch must report mission-start as unknown',
  );
  // No USABLE verdict means the startup preflight never ran.
  assert.ok(!errors.some((line) => /Environment verdict: USABLE/.test(line)));
  assert.ok(!errors.some((line) => /Running mission startup preflight/.test(line)));
});

// A near-miss spelling must not silently resolve to the removed command.
test('px mission-startx does not resolve to a removed command', async () => {
  const errors = [];
  let exitedWith = 'unset';

  await main(['mission-startx'], {
    commandFns: {},
    loadAliasesFn: () => ({}),
    cwdFn: () => '/tmp/nowhere',
    errorFn: (msg) => errors.push(String(msg)),
    printUsageFn: () => {},
    exitFn: (code) => { exitedWith = code; },
  });

  assert.equal(exitedWith, 1);
  assert.ok(errors.some((line) => /Unknown command: mission-startx/.test(line)));
});
