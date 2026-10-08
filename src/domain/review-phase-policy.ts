export type ReviewPhase = 'reviewing' | 'fixing' | 'pending-approval' | 'approved';

export const REVIEW_PHASES: readonly ReviewPhase[] =
  ['reviewing', 'fixing', 'pending-approval', 'approved'];

export const REVIEW_PHASE_TRANSITIONS: Record<ReviewPhase, readonly ReviewPhase[]> = {
  'reviewing': ['fixing', 'approved'],
  'fixing': ['reviewing', 'pending-approval'],
  'pending-approval': ['reviewing'],
  'approved': [],
};

/** Coerce untrusted text to a phase, or null when it names none. */
export function parseReviewPhase(value: string | null | undefined): ReviewPhase | null {
  const candidate = String(value ?? '').trim().toLowerCase();
  return (REVIEW_PHASES as readonly string[]).includes(candidate)
    ? candidate as ReviewPhase
    : null;
}


const VALID_PHASES = REVIEW_PHASES;
const PHASE_ALIASES = new Map<string, string>([
  ['review', 'reviewing'],
  ['rewiewing', 'reviewing'],
  ['fix', 'fixing'],
  ['pending_approval', 'pending-approval'],
  ['pending approval', 'pending-approval']
]);

/** @param {string} disposition */
function inferPhaseFromDisposition(disposition: string): string {
  switch (String(disposition || '').trim().toUpperCase()) {
  case 'APPROVED':
    return 'approved';
  case 'REQUEST_CHANGES':
  case 'COMMENT':
  case 'PUSHBACK_ALL':
  case 'BLOCKED':
  case 'PARKED':
    return 'fixing';
  case 'CHANGES_MADE':
    return 'reviewing';
  default:
    return 'reviewing';
  }
}

/** @param {string} phase @param {string} disposition */
export function normalizeReviewPhase(phase: string, disposition: string): { phase: string; original: string | null; normalized: boolean } {
  if (!phase) {
    return { phase: 'reviewing', original: null, normalized: false };
  }

  const raw = String(phase).trim();
  const canonical = raw.toLowerCase().replace(/[_\s]+/g, '-');
  if ((VALID_PHASES as readonly string[]).includes(canonical)) {
    return { phase: canonical, original: raw, normalized: canonical !== raw };
  }

  const alias = PHASE_ALIASES.get(raw.toLowerCase()) || PHASE_ALIASES.get(canonical);
  if (alias) {
    return { phase: alias, original: raw, normalized: true };
  }

  return {
    phase: inferPhaseFromDisposition(disposition),
    original: raw,
    normalized: true
  };
}

/** Shared transition facts; callers retain their diagnostic vocabulary. */
export function reviewPhaseTransition(current: string, next: string) {
  const valid = (REVIEW_PHASES as readonly string[]).includes(next);
  const allowed = REVIEW_PHASE_TRANSITIONS[current as ReviewPhase] ?? [];
  return { valid, allowed, permitted: valid && (allowed as readonly string[]).includes(next) };
}
