// External command presentation owns synchronous-hook progress independently
// of command execution. Animation and the clock are doubles in this unit tier.
import test from 'node:test';
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
