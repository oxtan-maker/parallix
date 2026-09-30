import type { Mission } from '../domain/mission.js';
import { reviewStatus, type ReviewRevocationCause, type ReviewRound } from '../domain/review.js';

type WithdrawnApproval = ReviewRound & {
  readonly decision: Extract<NonNullable<ReviewRound['decision']>, { kind: 'approved' }>;
};

/** Approvals a red integration gate withdrew, oldest first. */
export function integrationGateWithdrawals(mission: Mission): readonly WithdrawnApproval[] {
  const rounds: readonly ReviewRound[] = mission.review?.rounds ?? [];
  return rounds.filter((round): round is WithdrawnApproval => round.decision?.kind === 'approved'
    && round.decision.revocation?.cause?.kind === 'integration-gate-failure');
}

/** A repair that stopped between commands still owes review before landing. */
export function hasIntegrationRepairHistory(mission: Mission): boolean {
  return integrationGateWithdrawals(mission).length > 0;
}

export function integrationRepairNeedsReview(mission: Mission): boolean {
  return (mission.status === 'active' || mission.status === 'review') && Boolean(mission.review
    && reviewStatus(mission.review) !== 'approved' && hasIntegrationRepairHistory(mission));
}

/**
 * What the latest integration repair was, read from typed review facts: the
 * red gate, the approved revision A it withdrew, the repair range A..B, and
 * how the repaired revision's re-review stands (TASK-2620).
 */
export interface IntegrationRepairFacts {
  readonly gate: string | null;
  readonly command: string | null;
  readonly log: string | null;
  readonly approvedRevision: string;
  /** The revision under re-review; null while it still names A (repair not handed off yet). */
  readonly repairedRevision: string | null;
  readonly withdrawnAt: string;
  readonly reReview: 'pending' | 'approved' | 'changes-requested';
}

export function latestIntegrationRepair(mission: Mission): IntegrationRepairFacts | null {
  const withdrawn = integrationGateWithdrawals(mission).at(-1);
  const current = mission.review?.rounds.at(-1);
  if (!withdrawn || !current || current.number <= withdrawn.number) { return null; }
  const cause = withdrawn.decision.revocation!.cause as Extract<ReviewRevocationCause, { kind: 'integration-gate-failure' }>;
  const approvedRevision = String(withdrawn.subject.revision);
  const latest = String(current.subject.revision);
  return {
    gate: cause.gate,
    command: cause.command ?? null,
    log: cause.log ?? null,
    approvedRevision,
    repairedRevision: latest === approvedRevision ? null : latest,
    withdrawnAt: withdrawn.decision.revocation!.revokedAt,
    reReview: current.decision?.kind === 'approved' && !current.decision.revocation ? 'approved'
      : current.decision?.kind === 'changes-requested' ? 'changes-requested' : 'pending',
  };
}

/** One line for the human: what failed last time, the repair range, and the re-review outcome. */
export function integrationRepairSummary(facts: IntegrationRepairFacts): string {
  const gate = facts.gate ? `integration gate ${facts.gate}` : 'an integration gate';
  const range = `${facts.approvedRevision}..${facts.repairedRevision ?? 'HEAD'}`;
  return `Previous integration failed at ${gate}${facts.command ? ` (${facts.command})` : ''}; repair range ${range}; re-review ${facts.reReview}.`;
}

/**
 * Context the re-review prompt carries after an integration repair. It states
 * recorded facts and leaves the review scope to the configured reviewer.
 */
export function integrationRepairReviewBrief(facts: IntegrationRepairFacts | null): string {
  if (!facts) { return ''; }
  const range = `${facts.approvedRevision}..${facts.repairedRevision ?? 'HEAD'}`;
  const lines = [
    'Integration repair context (recorded by Parallix; these are facts, not findings):',
    `- A previous round approved revision \`${facts.approvedRevision}\`. At \`px integrate\`, ${facts.gate ? `integration gate \`${facts.gate}\`` : 'an integration gate'}${facts.command ? ` (\`${facts.command}\`)` : ''} failed.`,
    `- Parallix withdrew and dismissed that prior approval at ${facts.withdrawnAt}; it no longer authorizes landing. An implementer then repaired the failure.`,
    `- Repair range: \`${range}\` (\`git diff ${range}\`).`,
  ];
  if (facts.log) { lines.push('- Failed gate output (tail):', '```', facts.log, '```'); }
  lines.push('- The review scope is yours: review the repair range, the whole mission diff, or both, as the change warrants.');
  return lines.join('\n');
}

/** The pull-request comment that tells the human what the repaired revision went through. */
export function integrationRepairPrComment(facts: IntegrationRepairFacts): string {
  const lines = [
    '### Integration repair',
    '',
    integrationRepairSummary(facts),
    '',
    `Diff of the repair: \`git diff ${facts.approvedRevision}..${facts.repairedRevision ?? 'HEAD'}\`.`,
  ];
  if (facts.log) { lines.push('', '<details><summary>Failed gate output (tail)</summary>', '', '```', facts.log, '```', '', '</details>'); }
  lines.push('', 'Parallix stopped in the integration lane: nothing lands until a human runs `px integrate`.');
  return lines.join('\n');
}
