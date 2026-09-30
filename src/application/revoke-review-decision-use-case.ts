import { completed, failure, type ApplicationOutcome } from './contracts.js';
import type { MissionStore } from './domain-ports.js';
import type { MissionLifecycleService } from './mission-lifecycle-service.js';
import { missionId } from '../domain/mission.js';
import { revokeApprovedDecision, reviewStatus, type Review } from '../domain/review.js';
import { recordApprovalSuperseded } from '../domain/approval-coverage.js';
import { missionApprovalCoverage, type ChangeIdentityPort } from './approval-coverage.js';

export interface RevokeReviewDecisionRequest {
  readonly slug: string;
  readonly round: number;
  readonly reason: string;
  readonly operator: string;
  readonly occurredAt: string;
  readonly expectedVersion: number;
}

export interface ReviewProviderRevocationPort {
  dismissApproval(_mission: import('../domain/mission.js').Mission, _round: number, _reason: string): Promise<void>;
}

export interface RevokeReviewDecisionResult {
  readonly providerUpdated: boolean;
  readonly providerDiagnostic: string | null;
}

/**
 * Human-only corrective path for an effective approval: one an operator judges
 * unfounded, and one that no longer covers the branch (TASK-2555).  The second
 * opens its new round on the revision that superseded the approval.
 */
export class RevokeReviewDecisionUseCase {
  constructor(
    private readonly _store: MissionStore,
    private readonly _lifecycle: MissionLifecycleService,
    private readonly _provider: ReviewProviderRevocationPort | null = null,
    private readonly _changeIdentity: ChangeIdentityPort | null = null,
  ) {}

  /** A staleness observed but never recorded (the branch moved outside px rebase) is recorded now. */
  private withObservedSupersession(review: Review, occurredAt: string): Review {
    if (!this._changeIdentity) { return review; }
    const coverage = missionApprovalCoverage(review, this._changeIdentity);
    if (coverage?.kind !== 'stale' || coverage.recorded) { return review; }
    return recordApprovalSuperseded(review, {
      supersededAt: occurredAt, supersedingRevision: coverage.landedRevision, recordedBy: 'px revoke-review',
    });
  }

  async execute(request: RevokeReviewDecisionRequest): Promise<ApplicationOutcome<RevokeReviewDecisionResult>> {
    if (!request.reason.trim()) { return failure('validation', 'Revocation requires --reason <text> from the operator'); }
    if (!request.operator.trim()) { return failure('validation', 'Revocation requires --operator <name>; it is an operator-only command'); }
    if (!Number.isSafeInteger(request.round) || request.round < 1) { return failure('validation', 'Revocation requires --decision <round-number>'); }
    const loaded = await this._store.load(missionId(request.slug));
    if (loaded.kind !== 'found') { return failure('validation', `Mission ${request.slug} has no recorded review decision`); }
    if (loaded.mission.status === 'done') { return failure('validation', `Mission ${request.slug} is closed and cannot be reopened by revocation`); }
    const strandedApproval = loaded.mission.status === 'active' && loaded.mission.review
      && reviewStatus(loaded.mission.review) === 'approved';
    if (loaded.mission.status !== 'integration' && !strandedApproval) {
      return failure('validation', `Mission ${request.slug} is ${loaded.mission.status}; revocation requires its current effective approval in integration or a stranded active lane`);
    }
    if (!loaded.mission.review) { return failure('validation', `Mission ${request.slug} has no recorded review decision`); }

    let review;
    try {
      review = revokeApprovedDecision(this.withObservedSupersession(loaded.mission.review, request.occurredAt), request.round, {
        revokedAt: request.occurredAt,
        revokedBy: request.operator,
        reason: request.reason,
        cause: { kind: 'operator' },
      });
    } catch (error) {
      return failure('validation', error instanceof Error ? error.message : 'Review decision cannot be revoked');
    }
    const transition = await this._lifecycle.transition({
      operationId: `revoke-review:${request.slug}:${request.round}`,
      missionId: missionId(request.slug),
      expectedVersion: request.expectedVersion as import('./domain-ports.js').MissionVersion,
      capabilities: new Set(['mission:transition']),
      command: { type: 'revoke-approval', review },
      actor: request.operator,
      occurredAt: request.occurredAt,
      idempotencyKey: `revoke-review:${request.slug}:${request.round}:${request.occurredAt}`,
    });
    if (transition.status !== 'completed') {
      return failure('validation', transition.error?.message ?? 'Revocation was not recorded');
    }
    if (!this._provider) {
      return completed({ providerUpdated: false, providerDiagnostic: 'review provider is disabled; local revocation was recorded' });
    }
    try {
      await this._provider.dismissApproval(transition.value!.mission, request.round, request.reason);
      return completed({ providerUpdated: true, providerDiagnostic: null });
    } catch (error) {
      return completed({ providerUpdated: false, providerDiagnostic: `provider was not updated: ${error instanceof Error ? error.message : 'unreachable'}` });
    }
  }
}
