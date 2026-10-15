import type { StatsBackfillService } from '../../../../../src/application/stats-backfill-service.js';
// Statistics backfill command rendering uses typed application outcomes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { statsBackfill } from '../../../../../src/adapters/cli/commands/stats-backfill.js';

function completedOutcome(): Pick<StatsBackfillService, 'execute'> {
  return {
    async execute() {
      return {
        status: 'completed' as const,
        value: {
          sources: [],
          rows: [{ repo: 'parallix', date: '2026-05-05', mission: 'task-1', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '0', sources: { date: 'backlog-updated_date', classification: 'backlog-label', implementer: 'git-history-author' } }],
          unresolved: [{ slug: 'task-2', reason: 'missing-fields', missing: ['date'], detail: 'no date' }],
          skipped: [{ slug: 'task-3', reason: 'status=active' }],
        },
        durableEvidence: [{ id: 'row-1', source: 'stats', detail: 'one applied row' }],
      };
    },
  };
}

test('statsBackfill renders the unresolved and skipped sections in summary output', async () => {
  const logs: string[] = [];
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
  const errors: string[] = [];
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
  const logs: string[] = [];
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
  const errors: string[] = [];
  let exitCode: { value: number | undefined | null } = { value: null };
  await statsBackfill([], {
    rootDir: process.cwd(),
    service: {
      async execute() { return { status: 'failed' as const, error: { kind: 'unavailable', message: 'boom' }, durableEvidence: [] }; },
    },
    log: () => {},
    error: line => errors.push(typeof line === 'string' ? line : JSON.stringify(line)),
    exit: code => { exitCode.value = code; },
  });
  assert.equal(exitCode.value, 1);
  assert.match(errors.join('\n'), /boom/);
});

test('statsBackfill reports a missing outcome value to stderr and exits 1', async () => {
  let exitCode: { value: number | undefined | null } = { value: null };
  await statsBackfill([], {
    rootDir: process.cwd(),
    service: {
      async execute() { return { status: 'completed' as const, durableEvidence: [] }; },
    },
    log: () => {},
    error: () => {},
    exit: code => { exitCode.value = code; },
  });
  assert.equal(exitCode.value, 1);
});

test('statsBackfill throws when no service is injected', async () => {
  await assert.rejects(() => statsBackfill([], { rootDir: process.cwd(), log: () => {}, error: () => {}, exit: () => {} }), /requires an injected service/);
});
