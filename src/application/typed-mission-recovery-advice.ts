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

/**
 * A concrete `px checkpoint record` command for the repair advice. Built from a
 * single-quoted inner string so the backticked verification command survives
 * without nested template-literal escaping, and cites an existing
 * repository-relative test path that resolves on this tree (TASK-2662 reference
 * semantics).
 */
function repairCheckpointExample(checkpoint: string): string {
  return (
    `px checkpoint record --name ${checkpoint} --expected-version <n> --criterion "<exact success criterion>"`
    + ` --evidence "fix: regression covered by mission-brief-and-mutation-contract passes: `
    + '`npm test -- test/unit/domain/mission-brief-and-mutation-contract.test.ts`'
    + `" --next "finish remaining checkpoints then hand off"`
  );
}

export function buildTypedMissionRecoveryAdvice(slug: string, checkpoint: string): string {
  return [
    `Reload the recorded Mission contract with \`px status ${slug}\`, including its current Version, success criteria, checkpoint plan, and recorded evidence.`,
    `Record ${checkpoint} as the repair checkpoint. If ${checkpoint} is the final planned checkpoint, it needs only the rows for the criteria the repair affects: valid earlier evidence for the other criteria is retained across the recorded checkpoints and stays available through repeated repair rounds, so do not restate it. If ${checkpoint} is not the final planned checkpoint, it needs only the rows for the criteria it covers. Every row cites a verifiable reference, and the repair must record at least one fresh row in the current review round: rows kept from earlier rounds are stale as fix evidence. Taken together the recorded checkpoints must still cover every success criterion, or handoff refuses them. Use \`px checkpoint record --name ${checkpoint} --criterion <exact success criterion> --evidence <durable evidence> --next <specific next action> --expected-version <n>\`, replacing \`<n>\` with the current Version from that status output.`,
    `A valid row cites a verifiable reference (recognized repo command/path, exact test name, test-file path, or ADR). One row per affected criterion; concrete example: \`${repairCheckpointExample(checkpoint)}\`.`,
    `Re-run \`px status ${slug}\` after recording evidence, then continue with each remaining planned checkpoint before handoff.`,
    'Complete the implementation and run every mission-declared gate; record only evidence from work and verification actually performed. Do not hand off until every planned checkpoint has evidence and every declared gate passes, unless a mission stop rule applies or a genuine external dependency blocks progress.',
    'Do not create or edit retired legacy artifacts for this typed mission.',
    'Historical-import compatibility is separate: preserve existing historical mission documents and use `px import-legacy` when applicable; never fabricate checkpoint evidence from those documents.',
  ].join(' ');
}

export { isIncompleteSuccessCriteriaFailure } from '../domain/mission-handoff-policy.js';

export function buildSuccessCriteriaRecoveryAdvice(slug: string): string {
  return [
    `Reload the Mission with \`px status ${slug}\` and read its current Version, success criteria and recorded evidence.`,
    'Complete and verify the work for each incomplete criterion; mark only criteria actually verified against durable evidence.',
    `Record each verified criterion with \`px mission mark-complete --slug ${slug} --criterion <index> --expected-version <n>\`, using its one-based index and the current Version.`,
    'Reload status after each write before recording another criterion. The final checkpoint must evidence every criterion; completion flags do not replace evidence.',
    'Do not create retired checkpoint documents. Let handoff verification rerun confirm the repair.',
  ].join(' ');
}
