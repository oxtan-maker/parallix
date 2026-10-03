/**
 * Recovery instructions for missions whose checkpoint plan and evidence live in
 * the Mission aggregate. Legacy mission documents remain import inputs, not
 * artifacts a typed-mission recovery is allowed to manufacture.
 */
export function isTypedCheckpointEvidenceFailure(errorMsg: string): boolean {
  return /Planned checkpoint evidence is missing before handoff:/i.test(errorMsg);
}

export function namedCheckpointFromTypedFailure(errorMsg: string): string | null {
  return /Planned checkpoint evidence is missing before handoff:\s*(CP-\d+)/i.exec(errorMsg)?.[1] ?? null;
}

export function buildTypedMissionRecoveryAdvice(slug: string, checkpoint: string): string {
  return [
    `Reload the recorded Mission contract with \`px status ${slug}\`, including its current Version, success criteria, checkpoint plan, and recorded evidence.`,
    `Record ${checkpoint} with \`px checkpoint record --name ${checkpoint} --criterion <exact success criterion> --evidence <durable evidence> --next <specific next action> --expected-version <n>\`, replacing \`<n>\` with the current Version from that status output.`,
    `Re-run \`px status ${slug}\` after recording evidence, then continue with each remaining planned checkpoint before handoff.`,
    'Complete the implementation and run every mission-declared gate; record only evidence from work and verification actually performed. Do not hand off until every planned checkpoint has evidence and every declared gate passes, unless a mission stop rule applies or a genuine external dependency blocks progress.',
    'Do not create or edit retired legacy artifacts for this typed mission.',
    'Historical-import compatibility is separate: preserve existing historical mission documents and use `px import-legacy` when applicable; never fabricate checkpoint evidence from those documents.',
  ].join(' ');
}

export function isIncompleteSuccessCriteriaFailure(errorMsg: string): boolean {
  return /Success criteria [\d, ]+ are incomplete before handoff\./i.test(errorMsg);
}

export function buildSuccessCriteriaRecoveryAdvice(slug: string): string {
  return [
    `Reload the Mission with \`px status ${slug}\` and read its current Version, success criteria and recorded evidence.`,
    'Complete and verify the work for each incomplete criterion; mark only criteria actually verified against durable evidence.',
    `Record each verified criterion with \`px mission mark-complete --slug ${slug} --criterion <index> --expected-version <n>\`, using its one-based index and the current Version.`,
    'Reload status after each write before recording another criterion. The final checkpoint must evidence every criterion; completion flags do not replace evidence.',
    'Do not create retired checkpoint documents. Let handoff verification rerun confirm the repair.',
  ].join(' ');
}
