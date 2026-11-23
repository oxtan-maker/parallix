import test from 'node:test';
import assert from 'node:assert/strict';
import { missionTerminalRequest } from '../../../../src/interfaces/cli/mission-terminal-policy.js';
import { selectTerminalHost, selectionAfterLaunchFailure } from '../../../../src/application/ports/terminal-host-selection.js';

// Boundary: CLI registry hosting eligibility and its mission positional slot.
test('only declared mission operations can enter a terminal (TASK-2643)', () => {
  for (const command of ['active', 'review', 'integrate', 'recover']) {
    assert.deepEqual(missionTerminalRequest(command, ['task-1']), { slug: 'task-1' });
  }
  for (const command of ['diff', 'stats', 'rebase', 'resolve', 'verdict', 'unassign', 'future-command']) {
    assert.equal(missionTerminalRequest(command, ['task-1']), null);
  }
  assert.equal(missionTerminalRequest('active', ['task-1', '--json']), null);
  assert.equal(missionTerminalRequest('active', ['--help']), null);
});

test('flag values and verification areas cannot become mission selectors (TASK-2643)', () => {
  assert.deepEqual(missionTerminalRequest('active', ['--depends', 'task-1']), {});
  assert.deepEqual(missionTerminalRequest('review', ['--comment', 'task-1']), {});
  assert.deepEqual(missionTerminalRequest('verify', ['docs']), {});
});

// One selection owner for foreground, workflow-executor and standalone agent launches (TASK-2861.01).
const unavailable = { available: false, reason: 'tmux is not runnable (ENOENT)' };
const available = { available: true, reason: null };
const probeMustNotRun = () => { throw new Error('policy must not probe tmux here'); };
const select = (overrides: Partial<Parameters<typeof selectTerminalHost>[0]> = {}) => selectTerminalHost({
  config: { host: 'auto', whenUnavailable: 'fallback' }, inherited: false, interactive: true, probe: () => available, ...overrides,
});

test('an inherited mission terminal wins over every configuration and never hosts again (TASK-2861.01)', () => {
  for (const host of ['auto', 'pipe', 'tmux'] as const) {
    assert.deepEqual(select({ config: { host, whenUnavailable: 'fail' }, inherited: true, probe: probeMustNotRun }), { kind: 'inherited' });
  }
});

test('an explicit pipe override or a missing interactive terminal selects the pipe host before any restriction or probe (TASK-2861.01)', () => {
  const noConsult = { probe: probeMustNotRun, restriction: probeMustNotRun };
  assert.deepEqual(select({ config: { host: 'pipe', whenUnavailable: 'fail' }, ...noConsult }), { kind: 'pipe', reason: null, notify: false });
  assert.deepEqual(select({ interactive: false, config: { host: 'tmux', whenUnavailable: 'fail' }, ...noConsult }), { kind: 'pipe', reason: null, notify: false });
});

test('an available host is selected unless a provider or input-contract restriction names a reason (TASK-2861.01)', () => {
  assert.deepEqual(select(), { kind: 'hosted' });
  assert.deepEqual(select({ restriction: () => null }), { kind: 'hosted' });
  assert.deepEqual(select({ restriction: () => 'pi needs an outer mission command terminal', probe: probeMustNotRun }),
    { kind: 'pipe', reason: 'pi needs an outer mission command terminal', notify: false });
});

test('an unavailable host falls back with its reason, notifying only an explicit tmux request (TASK-2861.01)', () => {
  assert.deepEqual(select({ probe: () => unavailable }), { kind: 'pipe', reason: 'tmux is not runnable (ENOENT)', notify: false });
  assert.deepEqual(select({ probe: () => unavailable, config: { host: 'tmux', whenUnavailable: 'fallback' } }), { kind: 'pipe', reason: 'tmux is not runnable (ENOENT)', notify: true });
  assert.deepEqual(select({ probe: () => ({ available: false, reason: null }) }), { kind: 'pipe', reason: 'tmux is not available', notify: false });
});

test('an explicit tmux request with whenUnavailable fail refuses instead of falling back (TASK-2861.01)', () => {
  const config = { host: 'tmux', whenUnavailable: 'fail' } as const;
  assert.deepEqual(select({ config, probe: () => unavailable }), { kind: 'refused', reason: 'tmux is not runnable (ENOENT)' });
  assert.deepEqual(select({ config, restriction: () => 'socket too long' }), { kind: 'refused', reason: 'socket too long' });
  assert.equal(select({ config: { host: 'auto', whenUnavailable: 'fail' }, probe: () => unavailable }).kind, 'pipe');
  assert.deepEqual(selectionAfterLaunchFailure(config, 'prepare failed'), { kind: 'refused', reason: 'prepare failed' });
  assert.deepEqual(selectionAfterLaunchFailure({ host: 'auto', whenUnavailable: 'fail' }, 'prepare failed'), { kind: 'pipe', reason: 'prepare failed', notify: true });
});
