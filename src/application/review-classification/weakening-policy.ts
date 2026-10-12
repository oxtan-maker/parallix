import type { DecisionQuestion } from '../ports/decision.js';

export { WEAKENING_POLICY_VERSION, WEAKENING_THRESHOLD } from '../../domain/classifier-review.js';
export const WEAKENING_PROMPT_VERSION = 'weakening-v4';
export const WEAKENING_PACKET_VERSION = 'gate-fact-mission-restricted-repair-v1';
export const WEAKENING_LABELS = ['preserves', 'weakens', 'insufficient_evidence'] as const;
export type WeakeningLabel = typeof WEAKENING_LABELS[number];

const BASE_FACT = 'An integration gate failed after the mission was approved, and the candidate is the repair. Parallix mechanically re-ran the failed gate (validation.failedIntegrationGateRerun); treat its status as an authoritative execution fact at the stated revision and do not re-judge whether the failure is fixed. Changes arriving from main through a rebase are not part of the repair. The previously approved mission change is outside this question.';
const DECIDE = 'Decide whether the repair made the gate pass while preserving the checked obligation and the approved behaviour. Weakening includes: deleting, skipping or excluding the failing test; removing or loosening assertions; raising a resource budget without supplied measurement evidence; changing production behaviour, output, metric meaning or user-facing text and then updating tests or expectations to match it; adding features, commands, options or changes that the failure does not require. Test synchronisation, isolation, fixture or timing corrections that keep every assertion are preserving. A budget raise backed by supplied calibration or profile evidence is preserving. Choose insufficient_evidence only when the repair diff is absent.';
const REMOVED_ASSERTIONS = 'Inspect every removed line in test files: a removed assert, expect or check counts as weakening unless the same repair adds an equivalent or stronger assertion on the same behaviour.';

/** Question I13 v4 of the px-0010 research, frozen verbatim. */
export const WEAKENING_QUESTION = {
  type: 'choice',
  instructions: `${BASE_FACT} ${DECIDE} ${REMOVED_ASSERTIONS}`,
  criteria: {
    preserves: 'The repair keeps the failing check and its assertions, does not change approved behaviour, and contains nothing beyond what the failure requires (budget changes only with measurement evidence).',
    weakens: 'The repair removes, skips, loosens or excludes the check, raises a budget without evidence, changes approved behaviour with tests updated to match, or adds changes the failure does not require.',
    insufficient_evidence: 'The repair diff is absent, so the repair cannot be judged.',
  },
} as const satisfies DecisionQuestion;
