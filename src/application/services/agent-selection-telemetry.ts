export const AGENT_SELECTION_OUTCOMES = ['nominated', 'skipped-blocked', 'launch-failed', 'fallback'] as const;
export type AgentSelectionOutcome = typeof AGENT_SELECTION_OUTCOMES[number];

/** Emit one structured, machine-searchable selection outcome without owning storage. */
export function recordAgentSelectionOutcome(
  log: (message: string) => void,
  outcome: AgentSelectionOutcome,
  fields: Record<string, unknown> = {},
): void {
  log(JSON.stringify({ event: 'agent-selection', outcome, ...fields }));
}
