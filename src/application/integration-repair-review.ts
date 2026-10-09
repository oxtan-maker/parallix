import type { IntegrationRepairFacts } from '../domain/integration-repair-policy.js';
export * from '../domain/integration-repair-policy.js';
/**
 * The one repair range every audience sees. With both baselines recorded it is the mission
 * interdiff, so changes landed on main by a rebase are excluded; without them it falls back to
 * the plain revision range and says that it may include main.
 */
export function integrationRepairRange(facts: IntegrationRepairFacts): { readonly label: string; readonly command: string; readonly note: string } {
  const repaired = facts.repairedRevision ?? 'HEAD';
  if (facts.approvedBaseline && facts.repairedBaseline) {
    const rebased = facts.approvedBaseline !== facts.repairedBaseline;
    return {
      label: `mission interdiff ${facts.approvedBaseline}..${facts.approvedRevision} -> ${facts.repairedBaseline}..${repaired}`,
      command: `diff <(git diff ${facts.approvedBaseline} ${facts.approvedRevision}) <(git diff ${facts.repairedBaseline} ${repaired})`,
      note: rebased
        ? 'Changes landed on main are excluded. The branch was rebased onto a newer baseline, so rebase-induced and conflict-resolution changes appear in this range.'
        : 'Changes landed on main are excluded.',
    };
  }
  const range = `${facts.approvedRevision}..${repaired}`;
  return { label: `repair range ${range}`, command: `git diff ${range}`,
    note: 'No review baseline was recorded for the approved revision, so this range may include changes landed on main by a rebase.' };
}

/** One line for the human: what failed last time, the repair range, and the re-review outcome. */
export function integrationRepairSummary(facts: IntegrationRepairFacts): string {
  const gate = facts.gate ? `integration gate ${facts.gate}` : 'an integration gate';
  return `Previous integration failed at ${gate}${facts.command ? ` (${facts.command})` : ''}; ${integrationRepairRange(facts).label}; re-review ${facts.reReview}.`;
}

/**
 * Context the re-review prompt carries after an integration repair. It states
 * recorded facts and leaves the review scope to the configured reviewer.
 */
export function integrationRepairReviewBrief(facts: IntegrationRepairFacts | null): string {
  if (!facts) { return ''; }
  const range = integrationRepairRange(facts);
  const lines = [
    'Integration repair context (recorded by Parallix; these are facts, not findings):',
    `- A previous round approved revision \`${facts.approvedRevision}\`. At \`px integrate\`, ${facts.gate ? `integration gate \`${facts.gate}\`` : 'an integration gate'}${facts.command ? ` (\`${facts.command}\`)` : ''} failed.`,
    `- Parallix withdrew and dismissed that prior approval at ${facts.withdrawnAt}; it no longer authorizes landing. An implementer then repaired the failure.`,
    `- Repair range: ${range.label} (\`${range.command}\`). ${range.note}`,
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
    `Diff of the repair: \`${integrationRepairRange(facts).command}\`. ${integrationRepairRange(facts).note}`,
  ];
  if (facts.log) { lines.push('', '<details><summary>Failed gate output (tail)</summary>', '', '```', facts.log, '```', '', '</details>'); }
  lines.push('', 'Parallix stopped in the integration lane: nothing lands until a human runs `px integrate`.');
  return lines.join('\n');
}
