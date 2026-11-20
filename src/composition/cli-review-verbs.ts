import { missionVersion, type MissionStore } from '../application/domain-ports.js';
import type { MissionLifecycleService } from '../application/mission-lifecycle-service.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { Command } from '../interfaces/cli/runtime.js';
import { createResolveCommand, createVerdictCommand, type ReviewerVerdictOutput, type ReviewVerbPorts } from '../interfaces/cli/review-verbs.js';
import { inferSlug } from '../adapters/filesystem/mission-paths.js';
import { resolveMissionExecutionContext } from '../adapters/git/mission-execution-context.js';
import { readReviewState } from '../adapters/review/review-state.js';
import { bindReviewPersistence } from './review-persistence.js';
import { createMissionAuthority } from './mission-authority.js';
import { authorizeMissionWrite, authorizedOperationId, inheritedMissionWrite } from '../application/ports/mission-write-authorization.js';
import { promptArtifacts } from '../adapters/agents/prompt-artifacts.js';
import { liveMissionExecutionContext } from '../application/ports/mission-execution-context.js';
import { missionId } from '../domain/mission.js';
import { fixedVerificationNextAction, type FixedVerificationNextAction } from '../application/verification-policy/fixed-next-action.js';
import { currentReviewRound, reviewStatus, type Review } from '../domain/review.js';
import { RevokeReviewDecisionUseCase } from '../application/revoke-review-decision-use-case.js';
import { createGitChangeIdentity } from '../adapters/git/change-identity.js';
import { dismissProviderApproval } from '../adapters/review/review-adapter.js';

type VerdictContinuation = (_slug: string, _action: FixedVerificationNextAction) => Promise<void>;
type ReviewRevocation = Pick<RevokeReviewDecisionUseCase, 'execute'>;

interface StandingApprovalResult {
  readonly approvedReviewerVerdict: boolean;
  readonly decisionVersion: ReturnType<typeof missionVersion> | undefined;
  readonly providerDiagnostic: string | null;
  readonly failure?: string;
}

function hasStandingApproval(loaded: Awaited<ReturnType<MissionStore['load']>>): loaded is
  Extract<typeof loaded, { kind: 'found' }> & { mission: { review: Review } } {
  return loaded.kind === 'found' && Boolean(loaded.mission.review)
    && reviewStatus(loaded.mission.review!) === 'approved';
}

function correctionReason(output: ReviewerVerdictOutput): string {
  return output.comment?.trim()
    || `Human requested changes: ${output.findings.map(finding => finding.summary).join('; ')}`;
}

async function reconcileStandingApproval(input: {
  slug: string;
  reviewer: string;
  output: ReviewerVerdictOutput;
  expectedVersion?: number;
  missionStore: MissionStore;
  operatorVerdict: boolean;
  revokeDecision: ReviewRevocation | null;
}): Promise<StandingApprovalResult> {
  const initial = {
    approvedReviewerVerdict: false,
    decisionVersion: input.expectedVersion === undefined ? undefined : missionVersion(input.expectedVersion),
    providerDiagnostic: null,
  };
  if (input.output.verdict !== 'request-changes') { return initial; }
  const loaded = await input.missionStore.load(missionId(input.slug));
  if (!hasStandingApproval(loaded)) { return initial; }
  if (!input.operatorVerdict) { return { ...initial, approvedReviewerVerdict: true }; }
  if (!input.revokeDecision) { return initial; }
  const round = currentReviewRound(loaded.mission.review);
  const outcome = await input.revokeDecision.execute({
    slug: input.slug, round: round.number, operator: input.reviewer, occurredAt: new Date().toISOString(),
    reason: correctionReason(input.output),
    expectedVersion: input.expectedVersion,
    correction: { findings: input.output.findings, comment: input.output.comment },
  });
  if (outcome.status !== 'completed') {
    return { ...initial, failure: outcome.error?.message ?? 'Approval revocation was not recorded' };
  }
  const corrected = await input.missionStore.load(missionId(input.slug));
  if (corrected.kind !== 'found') {
    return { ...initial, failure: `Mission ${input.slug} disappeared after approval revocation` };
  }
  return { ...initial, decisionVersion: corrected.version, providerDiagnostic: outcome.value?.providerDiagnostic ?? null };
}

export function createReviewDecisionRevocationUseCase(rootDir: string, store: MissionStore, lifecycle: MissionLifecycleService): RevokeReviewDecisionUseCase {
  return new RevokeReviewDecisionUseCase(store, lifecycle, {
    async dismissApproval(mission, round, reason) {
      const decision = mission.review?.rounds.find(entry => entry.number === round)?.decision;
      if (decision?.kind !== 'approved') { throw new Error('matching approval is not recorded'); }
      await dismissProviderApproval(`mission/${mission.id}`, decision.decidedAt, reason, { rootDir });
    },
  }, createGitChangeIdentity(rootDir));
}

export function reviewVerbPorts(services: { rootDir: string; configuration: ParallixConfiguration; mission?: { store: MissionStore; lifecycle: MissionLifecycleService } | null; sourceRound?: number; continueVerificationAction?: VerdictContinuation; operatorInvocation?: boolean; revokeDecision?: ReviewRevocation }): ReviewVerbPorts {
  const missionStore = services.mission?.store ?? null;
  const lifecycleService = services.mission?.lifecycle ?? null;
  const persistence = bindReviewPersistence(missionStore, lifecycleService);
  const operatorVerdict = services.operatorInvocation === true
    && services.sourceRound === undefined
    && !services.configuration.runtime.workflowOperation && !inheritedMissionWrite();
  const revokeDecision = services.revokeDecision ?? (missionStore && lifecycleService
    ? createReviewDecisionRevocationUseCase(services.rootDir, missionStore, lifecycleService) : null);
  return {
    verdictAuthority: operatorVerdict ? 'operator' : 'reviewer',
    retainRejectedVerdict: input => promptArtifacts(input.worktree).retain(JSON.stringify({
      kind: 'rejected-review-verdict', accepted: false, ...input,
      workflowId: authorizedOperationId(), retainedAt: new Date().toISOString(),
    }, null, 2)),
    resolveSlug: (explicit) => inferSlug(explicit),
    resolveExecutionContext: slug => liveMissionExecutionContext(slug, resolveMissionExecutionContext(slug, services.rootDir, services.configuration)),
    readReviewState: async (slug, worktree) => {
      const state = await Promise.resolve(readReviewState(slug, worktree, missionStore));
      return state ? { round: state.round, phase: state.phase, sourceRound: services.sourceRound } : null;
    },
    consumeReviewerOutput: async (slug, reviewer, output, executionContext, expectedVersion) => {
      await authorizeMissionWrite(slug);
      const boundOutput = { ...output, authority: operatorVerdict ? 'operator' as const : 'reviewer' as const };
      const approval: StandingApprovalResult = missionStore && lifecycleService
        ? await reconcileStandingApproval({ slug, reviewer, output, expectedVersion, missionStore, operatorVerdict, revokeDecision })
        : { approvedReviewerVerdict: false,
          decisionVersion: expectedVersion === undefined ? undefined : missionVersion(expectedVersion), providerDiagnostic: null };
      if (approval.failure) { return { consumed: true, ok: false, diagnostic: approval.failure }; }
      const consumed = await persistence.consumeReviewerArtifacts(slug, reviewer, { configuration: services.configuration, executionContext, output: boundOutput, expectedVersion: approval.decisionVersion });
      if (approval.approvedReviewerVerdict && consumed.ok) {
        return { ...consumed, ok: false, diagnostic: 'the standing approval remains authoritative; only a direct operator invocation may withdraw it (late reviewer evidence was retained)' };
      }
      return approval.providerDiagnostic ? { ...consumed, advisory: approval.providerDiagnostic } : consumed;
    },
    nextVerificationAction: async (slug, respectOwnedAction) => {
      if (!missionStore) { throw new Error(`Mission authority is unavailable for ${slug}`); }
      const loaded = await missionStore.load(missionId(slug));
      if (loaded.kind !== 'found') { throw new Error(`Mission ${slug} is unavailable for next-action selection`); }
      return fixedVerificationNextAction({
        mission: loaded.mission,
        ownedAction: respectOwnedAction && Boolean(services.configuration.runtime.workflowOperation),
      });
    },
    ...(operatorVerdict && services.continueVerificationAction
      ? { continueVerificationAction: services.continueVerificationAction } : {}),
    consumeImplementerOutput: (slug, implementer, output, executionContext, expectedVersion) =>
      persistence.consumeImplementerArtifacts(slug, implementer, { configuration: services.configuration, executionContext, output, expectedVersion: expectedVersion === undefined ? undefined : missionVersion(expectedVersion) }),
  };
}

/** Child review verbs need the Mission authority, not execute or presentation capabilities. */
export function createReviewVerbCommands(rootDir: string, configuration: ParallixConfiguration,
  continueVerificationAction?: VerdictContinuation, operatorInvocation = false): Record<string, Command> {
  const invoke = async (args: string[], create: typeof createVerdictCommand | typeof createResolveCommand) => {
    const mission = await createMissionAuthority(rootDir, { configuration });
    const sourceRound = Number(configuration.forwardedEnvironment.PARALLIX_REVIEW_SOURCE_ROUND);
    try { return await create(reviewVerbPorts({ rootDir, configuration, mission,
      sourceRound: Number.isSafeInteger(sourceRound) && sourceRound > 0 ? sourceRound : undefined,
      continueVerificationAction,
      operatorInvocation,
    }))(args); }
    finally { await mission.store.drain?.(); }
  };
  return { verdict: args => invoke(args, createVerdictCommand), resolve: args => invoke(args, createResolveCommand) };
}
