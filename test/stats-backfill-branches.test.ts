// @ts-nocheck -- TASK-2535: partial test doubles for the stats-backfill branches;
// mirrors the established mockModule/@ts-nocheck pattern in test/stats-backfill.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { statsBackfill } from '../src/adapters/cli/commands/stats-backfill.js';

function completedOutcome(extra = {}) {
  return {
    async execute() {
      return {
        status: 'completed',
        value: {
          rows: [{ date: '2026-05-05', mission: 'task-1', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '0', sources: { date: 'backlog-updated_date', classification: 'backlog-label', implementer: 'git-history-author' } }],
          unresolved: [{ slug: 'task-2', reason: 'missing-fields', missing: ['date'], detail: 'no date' }],
          skipped: [{ slug: 'task-3', reason: 'status=active' }],
        },
        durableEvidence: [/* one applied row */ {}],
        ...extra,
      };
    },
  };
}

test('statsBackfill renders the unresolved and skipped sections in summary output', async () => {
  const logs = [];
  await statsBackfill([], {
    rootDir: process.cwd(),
    service: completedOutcome(),
    log: line => logs.push(typeof line === 'string' ? line : JSON.stringify(line)),
    error: line => logs.push(`ERR:${typeof line === 'string' ? line : JSON.stringify(line)}`),
    exit: () => {},
  });
  const out = logs.join('\n');
  assert.match(out, /Resolved rows: 1/);
  assert.match(out, /Unresolved missions: 1/);
  assert.match(out, /- task-2 reason=missing-fields missing=date/);
  assert.match(out, /Skipped:\n- task-3 status=active/);
});

test('statsBackfill reports unresolved missions as an error when applying', async () => {
  const errors = [];
  await statsBackfill(['--apply'], {
    rootDir: process.cwd(),
    service: completedOutcome(),
    log: () => {},
    error: line => errors.push(typeof line === 'string' ? line : JSON.stringify(line)),
    exit: () => {},
  });
  assert.match(errors.join('\n'), /1 missions remain unresolved and were not written/);
});

test('statsBackfill json output includes unresolved and skipped items', async () => {
  const logs = [];
  await statsBackfill(['--json'], {
    rootDir: process.cwd(),
    service: completedOutcome(),
    log: line => logs.push(typeof line === 'string' ? line : JSON.stringify(line)),
    error: () => {},
    exit: () => {},
  });
  const payload = JSON.parse(logs.join('\n'));
  assert.equal(payload.resolved, 1);
  assert.equal(payload.unresolved, 1);
  assert.equal(payload.skipped, 1);
  assert.equal(payload.rows[0].mission, 'task-1');
});

test('statsBackfill reports a non-completed outcome to stderr and exits 1', async () => {
  const errors = [];
  let exitCode = null;
  await statsBackfill([], {
    rootDir: process.cwd(),
    service: {
      async execute() { return { status: 'failed', error: { message: 'boom' }, durableEvidence: [] }; },
    },
    log: () => {},
    error: line => errors.push(typeof line === 'string' ? line : JSON.stringify(line)),
    exit: code => { exitCode = code; },
  });
  assert.equal(exitCode, 1);
  assert.match(errors.join('\n'), /boom/);
});

test('statsBackfill reports a missing outcome value to stderr and exits 1', async () => {
  let exitCode = null;
  await statsBackfill([], {
    rootDir: process.cwd(),
    service: {
      async execute() { return { status: 'completed', value: null, durableEvidence: [] }; },
    },
    log: () => {},
    error: () => {},
    exit: code => { exitCode = code; },
  });
  assert.equal(exitCode, 1);
});

test('statsBackfill throws when no service is injected', async () => {
  await assert.rejects(() => statsBackfill([], { rootDir: process.cwd(), log: () => {}, error: () => {}, exit: () => {} }), /requires an injected service/);
});
