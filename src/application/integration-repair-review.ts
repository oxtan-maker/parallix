import type { IntegrationRepairFacts } from '../domain/integration-repair-policy.js';
export * from '../domain/integration-repair-policy.js';
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
