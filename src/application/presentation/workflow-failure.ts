import { stripTerminalControl } from '../run-history.js';
import { formatRunHistoryRef, type RunHistoryRef } from '../run-history-types.js';

/** Recorded facts only: presentation never classifies command output. */
export interface WorkflowFailureFacts {
  readonly mission: string;
  readonly stage: string;
  readonly command: string;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly cause?: string | null;
  readonly diagnostics: readonly string[];
  readonly output: readonly RunHistoryRef[];
  readonly recovery?: { readonly outcome: 'resolved' | 'exhausted' | 'attempted'; readonly attempts: number };
  readonly next?: string;
}

// Keep terminal controls and multi-line diagnostics from obscuring the footer.
const line = (value: string, limit = 500): string => stripTerminalControl(value).replace(/[\r\n\t]+/g, ' ').slice(0, limit);

export function workflowFailureSummary(facts: WorkflowFailureFacts): string {
  const observed = facts.signal ? `signal ${line(facts.signal)}` : facts.exitCode !== null && facts.exitCode !== undefined ? `exit ${facts.exitCode}` : 'exit unknown';
  const recovery = facts.recovery;
  const recoveryText = !recovery ? 'not attempted (no recorded recovery evidence)'
    : `${recovery.outcome === 'resolved' ? 'attempted and resolved' : recovery.outcome === 'exhausted' ? 'budget exhausted' : 'attempted; outcome unresolved'} (${recovery.attempts} attempts)`;
  const refs = facts.output.slice(0, 4).map(ref => `  Output: px history ${line(facts.mission)} show ${formatRunHistoryRef(ref)}`);
  return [
    '', 'Workflow failure summary',
    `  Stage: ${line(facts.stage)}`,
    `  Command: ${line(facts.command)} (${observed})`,
    `  Cause: ${line(facts.cause || 'unknown')}`,
    ...facts.diagnostics.slice(0, 6).map(diagnostic => `  Diagnostic: ${line(diagnostic)}`),
    ...(facts.diagnostics.length > 6 ? ['  Diagnostic: additional recorded diagnostics omitted; inspect retained output'] : []),
    ...(refs.length ? refs : ['  Output: no output was retained']),
    `  Recovery: ${recoveryText}`,
    `  Next: ${line(facts.next ?? `Inspect px history ${facts.mission} and px status ${facts.mission}; address the recorded failure before explicitly retrying.`)}`,
    '',
  ].join('\n');
}
