import test from 'node:test';
import assert from 'node:assert/strict';
import { RevokeReviewDecisionUseCase } from '../src/application/revoke-review-decision-use-case.js';
import { getLatestReviewForPr } from '../src/adapters/forgejo/forgejo.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { decideMission } from '../src/domain/mission-workflow.js';
import { repositoryId } from '../src/domain/repository.js';
import { applyReviewerCommand, changeRevision, ConfiguredReviewerEligibility, reviewFindingId, startReview } from '../src/domain/review.js';

const id = missionId('task-2543');
const review = applyReviewerCommand(startReview(
  { change: { kind: 'local-branch', sourceBranch: 'mission/task-2543', targetBranch: 'main' }, revision: changeRevision('abc') },
  agentFamily('custom'), agentFamily('codex'), '2026-01-01T00:00:00Z',
  ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('custom')], strategy: 'random' }),
), { type: 'approve', decidedAt: '2026-01-01T00:01:00Z', comment: null, source: { kind: 'local' } });
const mission: Mission = { id, repositoryId: repositoryId('repo'), title: 'revoke', labels: missionLabels([]), assignee: null, checkpoints: [], review, netEngineeringLines: null, status: 'integration', closedAt: null };

test('refused revocation does not read or mutate its store', async () => {
  let reads = 0;
  const useCase = new RevokeReviewDecisionUseCase({
    async load() { reads++; throw new Error('must not load'); },
    async save() { throw new Error('must not save'); },
  } as never, {} as never);
  const result = await useCase.execute({
    slug: 'task-2543', round: 1, reason: '', operator: 'operator',
    occurredAt: '2026-09-25T00:00:00Z', expectedVersion: 1,
  });
  assert.equal(result.status, 'failed');
  assert.equal(reads, 0);
});

test('an active mission without approval leaves its store, lifecycle, and provider untouched', async () => {
  let transitions = 0;
  let providerCalls = 0;
  const activeMission = { ...mission, status: 'active' as const, review: null };
  const store = { async load() { return { kind: 'found' as const, mission: activeMission, version: 1 as never }; } };
  const lifecycle = { async transition() { transitions++; throw new Error('must not transition'); } };
  const useCase = new RevokeReviewDecisionUseCase(store as never, lifecycle as never, {
    async dismissApproval() { providerCalls++; },
  });
  const result = await useCase.execute({ slug: 'task-2543', round: 1, reason: 'unfounded', operator: 'operator', occurredAt: '2026-01-01T00:02:00Z', expectedVersion: 1 });
  assert.equal(result.status, 'failed');
  assert.equal(transitions, 0);
  assert.equal(providerCalls, 0);
  assert.equal(activeMission.status, 'active');
  assert.equal(activeMission.review, null);
});

test('provider failure leaves local revocation durable', async () => {
  let saved: Mission | null = null;
  const store = { async load() { return { kind: 'found' as const, mission, version: 1 as never }; }, async save() { throw new Error('unused'); } };
  const lifecycle = { async transition(request: any) { saved = { ...mission, status: 'review', review: request.command.review }; return { status: 'completed', value: { mission: saved } }; } };
  const useCase = new RevokeReviewDecisionUseCase(store as never, lifecycle as never, { async dismissApproval() { throw new Error('offline'); } });
  const result = await useCase.execute({ slug: 'task-2543', round: 1, reason: 'unfounded', operator: 'operator', occurredAt: '2026-01-01T00:02:00Z', expectedVersion: 1 });
  assert.equal(result.status, 'completed');
  assert.match(result.value!.providerDiagnostic!, /provider was not updated/);
  assert.equal(saved?.status, 'review');
  assert.equal(saved?.review?.rounds.length, 2);
});

test('provider REQUEST_CHANGES after an agent approval keeps the mission reviewable', async () => {
  const providerReview = await getLatestReviewForPr(41, 'codex', '2026-01-01T00:00:00Z', 'fake-token', {
    apiCall: async () => ({ ok: true, data: [
      { user: { login: 'codex' }, submitted_at: '2026-01-01T00:01:00Z', state: 'APPROVED' },
      { user: { login: 'human' }, submitted_at: '2026-01-01T00:02:00Z', state: 'REQUEST_CHANGES' },
    ] }),
  });
  assert.deepEqual(providerReview, { state: 'REQUEST_CHANGES', submittedAt: '2026-01-01T00:02:00Z' });
  const requested = applyReviewerCommand(startReview(
    { change: { kind: 'local-branch', sourceBranch: 'mission/task-2543', targetBranch: 'main' }, revision: changeRevision('provider') },
    agentFamily('custom'), agentFamily('codex'), '2026-01-01T00:00:00Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('custom')], strategy: 'random' }),
  ), {
    type: 'request-changes', decidedAt: providerReview!.submittedAt, comment: null,
    findings: [{ id: reviewFindingId('provider-finding'), summary: 'Human review wins', location: 'provider' }],
  });
  const resulting = decideMission({ ...mission, status: 'review', review: requested }, { type: 'request-changes', review: requested });
  assert.equal(resulting.status, 'active');
});
