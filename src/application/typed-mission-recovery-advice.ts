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
