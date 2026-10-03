// TASK-2587: provider approval identity must be configured independently from authentication.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getLatestReviewDecision } from '../src/adapters/forgejo/forgejo.js';
import { evaluateTaskStatusForIntegration, recoveryEstablishesApproval } from '../src/application/integrate/approval.js';
import { recoverMissionForIntegration } from '../src/adapters/cli/commands/integrate.js';
import { reviewApprovalOwed } from '../src/domain/review.js';

const startedAt = '2026-09-27T10:00:00Z';
const approvedAt = '2026-09-27T10:30:00Z';
function decision(reviews: any[], sinceIso = startedAt) {
  return getLatestReviewDecision('mission/task-2587', {
    token: 'test-token', forgejoUser: 'magnus', reviewerUser: 'codex',
    authorizedApproverUser: 'magnus', sinceIso,
    apiCall: (_method: string, apiPath: string) => apiPath.includes('/pulls?state=')
      ? { ok: true, data: [{ number: 2587, head: { ref: 'mission/task-2587' } }] }
      : apiPath === '/pulls/2587/reviews' ? { ok: true, data: reviews } : { ok: false },
  });
}

test('task-2587: configured operator magnus approves despite default alias human and reviewer codex', () => {
  const approval = decision([{ state: 'APPROVED', submitted_at: approvedAt, user: { login: 'magnus' } }]);
  assert.equal(approval.defaultUserApproved, false);
  assert.equal(approval.reviewerApproved, false);
  assert.equal(approval.operatorApproved, true);
  assert.equal(approval.operatorApprovedAt, approvedAt);
  assert.deepEqual(recoveryEstablishesApproval({ missionStatus: 'active', approval }), {
    established: true, via: 'human-override', decidedAt: approvedAt, reason: '',
  });
});

test('task-2587: authentication alone, unauthorized, withdrawn, and stale approvals cannot recover', () => {
  const cases = [
    decision([]),
    decision([{ state: 'APPROVED', submitted_at: approvedAt, user: { login: 'gemini' } }]),
    decision([{ state: 'APPROVED', submitted_at: approvedAt, user: { login: 'magnus' } }, { state: 'REQUEST_CHANGES', submitted_at: '2026-09-27T11:00:00Z', user: { login: 'magnus' } }]),
    decision([{ state: 'APPROVED', submitted_at: approvedAt, user: { login: 'magnus' } }], '2026-09-27T11:00:00Z'),
  ];
  for (const approval of cases) {
    assert.notEqual(approval.operatorApproved, true);
    assert.equal(recoveryEstablishesApproval({ missionStatus: 'active', approval }).established, false);
  }
});

test('task-2587: active provider-approved Mission reaches integration through lifecycle recovery', async () => {
  const approval = decision([{ state: 'APPROVED', submitted_at: approvedAt, user: { login: 'magnus' } }]);
  const mission: any = { id: 'task-2587', status: 'active', assignee: 'codex', review: { rounds: [{ number: 1, startedAt, decision: { kind: 'approved', decidedAt: approvedAt } }] } };
  let version = 1;
  const store = { load: async () => ({ kind: 'found', mission, version }) };
  const lifecycle = { transition: async (request: any) => {
    mission.status = request.command.type === 'submit-for-review' ? 'review' : 'integration';
    version += 1;
    return { status: 'completed' };
  } };
  const result = await recoverMissionForIntegration({ slug: 'task-2587', approval }, { missionServices: { store, lifecycle } });
  assert.deepEqual(result, { recovered: true, status: 'integration', occurredAt: approvedAt });
});

test('task-2587: provider approval fulfils a historical approval-owed blocker without deleting it', () => {
  const review: any = {
    rounds: [{ number: 2, decision: { kind: 'approved', decidedAt: approvedAt, source: { kind: 'provider', provider: 'forgejo' } } }],
    reviewEvents: [{ blockedReason: 'external-formal-approval-owed', roundNumber: 2 }],
  };
  assert.equal(reviewApprovalOwed(review), false);
  assert.equal(review.reviewEvents.length, 1, 'the historical blocker event remains in the audit trail');
});

test('task-2587: dry-run prediction reports the same missing provider approval that recovery refuses', () => {
  const approval = decision([]);
  const missionReview = { rounds: [{ number: 1, startedAt, decision: { kind: 'approved', decidedAt: approvedAt } }] };
  assert.equal(recoveryEstablishesApproval({ missionStatus: 'active', missionReview, approval }).established, false);
  const check = evaluateTaskStatusForIntegration({ missionStatus: 'active', missionReview, approval }, {
    toVirtual: (value: string) => value,
    toActual: (value: string) => value,
  });
  assert.equal(check.ok, false);
  assert.match(check.message, /stored approval without the required qualifying provider approval/);
});
