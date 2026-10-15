// -------- Event Taxonomy --------

/**
 * Valid event classification labels.
 * These are the canonical types that can be stored and (optionally) mirrored to the review provider.
 */
export const VALID_EVENT_TYPES = Object.freeze({
  // Reviewer-produced events
  REVIEWER_FINDINGS: 'reviewer_findings',
  REVIEWER_OUTCOME: 'reviewer_outcome',

  // Implementer-produced events
  IMPLEMENTER_ROUND_SUMMARY: 'implementer_round_summary',
  IMPLEMENTER_DISPOSITION: 'implementer_disposition',

  // Neutral events
  NEUTRAL_DISCUSSION: 'neutral_discussion',
  HUMAN_NOTE: 'human_note',

  // Workflow-internal events (not mirrored to the review provider by default)
  BLOCKED_PUBLICATION: 'blocked_publication',
  PARKED_FOLLOWUP: 'parked_followup'
});

/**
 * All valid event type values as an array for validation.
 */
export const ALL_EVENT_TYPES = Object.freeze(Object.values(VALID_EVENT_TYPES));

/**
 * Event types that should be mirrored to the review provider.
 */
export const MIRRORED_EVENT_TYPES = Object.freeze(new Set([
  VALID_EVENT_TYPES.REVIEWER_FINDINGS,
  VALID_EVENT_TYPES.REVIEWER_OUTCOME,
  VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY,
  VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION,
  VALID_EVENT_TYPES.HUMAN_NOTE
]));

/**
 * Valid disposition values for implementer disposition events.
 */
export const VALID_DISPOSITIONS = Object.freeze([
  'CHANGES_MADE',
  'PUSHBACK_ALL',
  'PARKED',
  'BLOCKED'
]);

/**
 * Valid review verdict values for reviewer outcome events.
 */
export const VALID_VERDICTS = Object.freeze([
  'approve',
  'request-changes',
  'comment'
]);

// -------- Event Validation --------

/**
 * Validate an event type against the taxonomy.
 */
export function isValidEventType(eventType: string): boolean {
  return (ALL_EVENT_TYPES as string[]).includes(eventType);
}

/**
 * Validate a disposition value.
 */
export function isValidDisposition(disposition: string): boolean {
  return VALID_DISPOSITIONS.includes(disposition);
}

/**
 * Validate a verdict value.
 */
export function isValidVerdict(verdict: string): boolean {
  return VALID_VERDICTS.includes(verdict);
}

/**
 * Check if an event type should be mirrored to the review provider.
 */
export function shouldMirrorToProvider(eventType: string): boolean {
  return (MIRRORED_EVENT_TYPES as Set<string>).has(eventType);
}

/**
 * Check if a comment body contains the workflow metadata footer.
 */
export function hasWorkflowFooter(body: string): boolean {
  return /\`\[workflow-round:\d+, workflow-phase:[^\]]+\]\`/.test(body);
}

/**
 * Classify a comment as either workflow-generated or human.
 */
export function classifyComment(comment: { body?: string }): string | null {
  const body = comment.body || '';
  if (hasWorkflowFooter(body)) {
    return null;
  }
  return VALID_EVENT_TYPES.HUMAN_NOTE;
}
