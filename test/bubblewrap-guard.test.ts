import test from 'node:test';
import assert from 'node:assert/strict';
import * as fmt from '../src/application/presentation/cli-format.js';
import {
  isBubblewrapAvailable,
  isBubblewrapDisabled,
  setBubblewrapProbeForTest
} from '../src/adapters/process/bubblewrap.js';

test.afterEach(() => {
  setBubblewrapProbeForTest(null);
  delete process.env.PARALLIX_NO_BUBBLEWRAP;
});

function captureLogs<T>(fn: () => T): { result: T; lines: string[] } {
  const lines: string[] = [];
  const previous = fmt.setLogger({
    log: (...args: unknown[]) => lines.push(args.join(' ')),
    error: (...args: unknown[]) => lines.push(args.join(' '))
  });
  try {
    return { result: fn(), lines };
  } finally {
    fmt.setLogger(previous);
  }
}

test('isBubblewrapAvailable returns true when bwrap is executable', () => {
  setBubblewrapProbeForTest(() => true);
  assert.equal(isBubblewrapAvailable(), true);
});

test('isBubblewrapAvailable caches the probe result after the first check', () => {
  let calls = 0;
  setBubblewrapProbeForTest(() => { calls += 1; return false; });
  isBubblewrapAvailable();
  isBubblewrapAvailable();
  isBubblewrapAvailable();
  assert.equal(calls, 1);
});

test('isBubblewrapAvailable warns once that the agent runs unsandboxed', () => {
  setBubblewrapProbeForTest(() => false);
  const { lines } = captureLogs(() => {
    isBubblewrapAvailable();
    isBubblewrapAvailable();
  });
  const warnings = lines.filter(line => line.includes('UNSANDBOXED'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /bubblewrap \(bwrap\) not found or not executable/);
});

test('isBubblewrapDisabled honors PARALLIX_NO_BUBBLEWRAP', () => {
  assert.equal(isBubblewrapDisabled({}), false);
  assert.equal(isBubblewrapDisabled({ PARALLIX_NO_BUBBLEWRAP: '' }), false);
  assert.equal(isBubblewrapDisabled({ PARALLIX_NO_BUBBLEWRAP: '0' }), false);
  assert.equal(isBubblewrapDisabled({ PARALLIX_NO_BUBBLEWRAP: '1' }), true);
});
