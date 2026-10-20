import { recognizedFailureReason, type FailureReason } from './failure-reason.js';
import { isIncompleteSuccessCriteriaFailure } from './mission-handoff-policy.js';
/**
 * ADR 0048 failure classification (single dispatch table).
 *
 * The nine failure classes, the three dispatch actions, and the pattern-based
 * classifier live here — in the domain layer — so the rebound kernel and
 * the adapter-side repair path consume one table instead of maintaining
 * parallel classifiers. `src/adapters/cli/commands/repair-handoff.ts` re-exports
 * these symbols for its existing callers.
 *
 * Domain layer: pure string logic, no I/O.
 */

// ── FailureClass: 9 classes from ADR 0048 (agent-capacity added by task-2494) ─
export const FailureClass = {
  UnverifiableClaims: 'UnverifiableClaims',
  MalformedGates: 'MalformedGates',
  MissingArtifacts: 'MissingArtifacts',
  IncompleteEvidence: 'IncompleteEvidence',
  GitBlockers: 'GitBlockers',
  GateFailure: 'GateFailure',
  AgentCapacity: 'AgentCapacity',
  InfraBlocker: 'InfraBlocker',
  StateMachineViolation: 'StateMachineViolation',
} as const;

export type FailureClassType = (typeof FailureClass)[keyof typeof FailureClass];

// ── DispatchAction: 3 actions from ADR 0048 ──────────────────────────────────
export const DispatchAction = {
  AutoRepair: 'AutoRepair',
  AutoSendBack: 'AutoSendBack',
  HumanOnly: 'HumanOnly',
} as const;

export type DispatchActionType = (typeof DispatchAction)[keyof typeof DispatchAction];

// ── Dispatch table: maps each failure class to its prescribed action (ADR 0048) ─
export const DISPATCH_TABLE: Record<FailureClassType, DispatchActionType> = {
  [FailureClass.UnverifiableClaims]: DispatchAction.AutoSendBack,
  [FailureClass.MalformedGates]: DispatchAction.AutoRepair,
  [FailureClass.MissingArtifacts]: DispatchAction.AutoSendBack,
  [FailureClass.IncompleteEvidence]: DispatchAction.AutoSendBack,
  [FailureClass.GitBlockers]: DispatchAction.AutoRepair,
  [FailureClass.GateFailure]: DispatchAction.AutoSendBack,
  [FailureClass.AgentCapacity]: DispatchAction.AutoRepair,
  [FailureClass.InfraBlocker]: DispatchAction.HumanOnly,
  [FailureClass.StateMachineViolation]: DispatchAction.HumanOnly,
};

/**
 * Look up the dispatch action for a given failure class.
 *
 * @param failureClass - One of the failure class values from ADR 0048
 * @returns The prescribed dispatch action, or null if unknown
 */
export function getDispatchAction(failureClass: FailureClassType): DispatchActionType | null {
  return DISPATCH_TABLE[failureClass] ?? null;
}

/**
 * Sub-reason for GitBlockers classification: distinguishes dirty-artifact from behind-branch errors.
 * Used by repairHandoff() to decide whether to auto-rebase (behind) vs auto-commit only (dirty).
 *
 * NOTE: ADR 0048 defines eight classes; `AgentCapacity` (task-2494) is a
 * narrowly-scoped addition for agent usage/quota blocks so they are not
 * misclassified as infrastructure blockers.
 */
export type GitBlockerReason = 'dirty' | 'behind' | 'other';

/**
 * Shared explicit blocker rules. Keep these separate from the conservative
 * unknown-error fallback and the reviewer non-submission recovery policy.
 */
function explicitHumanOnlyClass(errorMsg: string): FailureClassType | null {
  if (/state\s+violation|invalid\s+state|transition\s+not\s+allowed|cannot\s+(move|transition)\s+(from|to)\s+\w+\s+(to|from)/i.test(errorMsg) || /task\s+state/i.test(errorMsg) && /invalid|violation|incorrect/i.test(errorMsg) || /no\s+recorded\s+implementer.*cannot\s+launch\s+conflict\s+resolution/i.test(errorMsg)) { return FailureClass.StateMachineViolation; }
  if (/forgejo|infrastructure|authentication\s+failed|token\s+(expired|invalid|missing)|forbidden|unauthorized\s+(access|request)|connection\s+(refused|timed?\s*out)|network\s+error/i.test(errorMsg)) { return FailureClass.InfraBlocker; }
  return null;
}

/**
 * A passing test-result line (node:test spec `✔`, mocha/vitest `✓`, TAP `ok N`).
 * Gate output echoes every passing title; a title that merely mentions
 * `forbidden` or `forgejo` reports a contract that held, not a blocker
 * (TASK-2663).
 */
const PASSING_TEST_RESULT_LINE_RE = /^\s*(?:[✔✓]\s|ok\s+\d+\b)/;

/**
 * True when the diagnostic names a recognized infrastructure or state-machine
 * blocker, as opposed to landing on the classifier's human-only default.
 * Only failure evidence counts: passing test-result lines are ignored.
 */
export function hasExplicitHumanOnlyDiagnostic(diagnostic: string): boolean {
  if (!diagnostic || typeof diagnostic !== 'string') {
    return false;
  }
  const evidence = diagnostic.split('\n').filter((line) => !PASSING_TEST_RESULT_LINE_RE.test(line)).join('\n');
  const { dispatchAction } = classifyError(evidence);
  return dispatchAction === DispatchAction.HumanOnly
    && explicitHumanOnlyClass(evidence) !== null;
}

/**
 * Classify an error message into one of the 8 failure classes from ADR 0048
 * and return the associated dispatch action.
 *
 * Patterns are checked in order of specificity to avoid collisions.
 * Returns a `reason` field for GitBlockers to distinguish dirty-artifact from behind-branch errors,
 * allowing callers to derive repair-strategy flags without duplicating pattern matching.
 *
 * @param errorMsg - The error message to classify
 * @returns Object with failureClass, dispatchAction, and (for GitBlockers) reason
 */
export function classifyError(errorMsg: string, failureReason?: unknown): { failureClass: FailureClassType; dispatchAction: DispatchActionType; reason?: GitBlockerReason } {
  const typed = recognizedFailureReason(failureReason);
  if (typed) {
    const failureClass = typed.code === 'infrastructure' ? FailureClass.InfraBlocker
      : typed.code === 'state-machine' ? FailureClass.StateMachineViolation
        : typed.code === 'agent-quota' ? FailureClass.AgentCapacity : FailureClass.GateFailure;
    return { failureClass, dispatchAction: DISPATCH_TABLE[failureClass] };
  }
  if (!errorMsg || typeof errorMsg !== 'string') {
    return { failureClass: FailureClass.InfraBlocker, dispatchAction: DispatchAction.HumanOnly };
  }

  const incompleteEvidence = classifyIncompleteEvidence(errorMsg);
  if (incompleteEvidence) { return incompleteEvidence; }

  // 1. IncompleteEvidence: goal-check table missing or lacking evidence rows
  // (most specific — checked before generic gate patterns).
  // Covers both "missing section" and "section present but no valid evidence".
  // 1b. IncompleteEvidence: checkpoint missing Goal Check section entirely
  // (architecture migration: handoff.ts emits "missing a \"## Goal Check\" section" for
  // checkpoints that lack the required heading).
  // 1c. IncompleteEvidence: no checkpoint documents found at all
  // (architecture migration: validateCheckpointsBeforeHandoff emits "No checkpoint documents
  // found" — classify as IncompleteEvidence so the lifecycle can relaunch the
  // implementer with a targeted repair prompt rather than stranding on manual
  // instructions).
  // 1d. IncompleteEvidence: the mission declared checkpoints that were never
  // written (validateCheckpointsBeforeHandoff emits "Declared checkpoint
  // documents are missing before handoff: CP-2, CP-3. Create and commit …").
  //
  // This is ADR 0048 class 4 — incomplete checkpoint evidence, auto-send-back.
  // An agent that ended its turn without the checkpoint documents it declared
  // has hallucinated completion; relaunching it with the named gap is exactly
  // the repair. Without this rule the message matched no pattern and fell to
  // the catch-all InfraBlocker/HumanOnly default, which stranded a mission that
  // one bounce would have fixed.
  // 2. GitBlockers: dirty/uncommitted mission artifacts (mechanical git blocker — auto-repairable)
  // 3. GitBlockers: branch behind primary / push rejected (mechanical git blocker — auto-repairable via rebase)
  const gitBlocker = classifyGitBlocker(errorMsg);
  if (gitBlocker) { return gitBlocker; }

  const gateOrArtifact = classifyGateOrArtifactFailure(errorMsg);
  if (gateOrArtifact) { return gateOrArtifact; }

  // 4. GateFailure: verification gate failed
  // 5. GateFailure: pre-handoff rebase failed. This generic wrapper can hide
  // the verification-gate failure that caused the rebase command to fail.
  // 6. GateFailure: declared gate failed
  // 7. UnverifiableClaims: test claims that cannot be verified
  // 8. MalformedGates: malformed or non-runnable declared gates
  // 9. MissingArtifacts: mandatory mission artifacts missing.
  // Missing legacy checkpoints and older auto-remediation diagnostics are
  // repairable handoff failures: checkpoint evidence is a
  // mandatory artifact, so the implementer is auto-sent-back per ADR 0048.
  const operational = classifyOperationalFailure(errorMsg);
  if (operational) { return operational; }

  // Guard: an explicit infrastructure marker (Forgejo/token/infrastructure/
  // network) always wins over the agent-capacity rule. Without this, a message
  // like "Forgejo quota exceeded" or "network error: quota exhausted" would be
  // classified as AgentCapacity/AutoRepair — mislabeling a genuine infra/Forgejo
  // failure. Preserve the InfraBlocker classification in that case (F1, task-2494
  // round 3). The shared explicit blocker rules supply this infra
  // marker set, so a usage-block rule never matches an explicit infra diagnostic.
  // Note: a bare `rate limit` is intentionally NOT an infra marker — agent-
  // branded rate limits (see agent-limit.ts) are agent-capacity events, so it
  // is matched by the AgentCapacity branch below instead.
  // 10b. AgentCapacity: agent usage / quota / rate limit (an agent-capacity
  // event, NOT infrastructure). Checked before the InfraBlocker rule so a
  // usage-block diagnostic — e.g. the pinned-agent error a rebase handoff
  // surfaces — is not misclassified as a Forgejo/network failure. Requires an
  // agent-capacity marker (usage limit, quota, 429 usage/quota, resource
  // exhausted, or an agent-branded rate limit); never a generic "limit", so it
  // does not steal the infra markers below. Reset-time parsing itself lives in
  // agent-limit.ts; this rule only reclassifies the diagnostic. Must not fire
  // when an explicit infrastructure marker is present.
  // Agent-branded rate limits (Claude/Codex/Mistral/Vibe rate limit
  // reached/exceeded, Qwen Requests rate limit exceeded, 429 rate limit) follow
  // agent-limit.ts and are agent-capacity, not infrastructure (F1, task-2494
  // round 4).
  // 11. InfraBlocker: forgejo/infrastructure blockers. A bare `rate limit` is
  // intentionally omitted here — agent-branded rate limits are agent-capacity
  // (handled by the AgentCapacity branch above); only infra-branded rate limits
  // reach this point, and they are rare. `network error` still covers the
  // common infra case.
  // 12. InfraBlocker: reviewer non-submission (ADR 0048 — human-only after bounded retries)
  // Matches: "Reviewer X did not submit a formal review outcome" and
  // "Reviewer X did not leave a complete local review handoff".
  // Default: human-only for unrecognized errors
  return { failureClass: FailureClass.InfraBlocker, dispatchAction: DispatchAction.HumanOnly };
}

function classifyIncompleteEvidence(errorMsg: string): { failureClass: FailureClassType; dispatchAction: DispatchActionType } | null {
  const matches = isIncompleteSuccessCriteriaFailure(errorMsg)
    || errorMsg.includes('"## Goal Check"') && errorMsg.includes('required before handoff')
    || errorMsg.includes('missing a') && errorMsg.includes('"## Goal Check" section')
    || errorMsg.includes('No checkpoint documents found') && errorMsg.includes('Goal Check table')
    || /declared\s+checkpoint\s+documents?\s+(are|is)\s+missing/i.test(errorMsg)
    || /\bCP-\d+/.test(errorMsg) && /missing\s+before\s+handoff|create\s+and\s+commit/i.test(errorMsg)
    // Recorded (typed-verb) evidence: any failure whose repair is re-recording
    // checkpoint evidence is the implementer's to fix, like a missing CP-N.md.
    || errorMsg.includes('`px checkpoint record');
  return matches ? { failureClass: FailureClass.IncompleteEvidence, dispatchAction: DispatchAction.AutoSendBack } : null;
}

function classifyGitBlocker(errorMsg: string): { failureClass: FailureClassType; dispatchAction: DispatchActionType; reason: GitBlockerReason } | null {
  if (errorMsg.includes('is modified but uncommitted') || errorMsg.includes('Commit the mission contract before handoff') || errorMsg.includes('Commit the implementation evidence before handoff')) {return { failureClass: FailureClass.GitBlockers, dispatchAction: DispatchAction.AutoRepair, reason: 'dirty' };}
  if (errorMsg.includes('Updates were rejected') || errorMsg.includes('fetch first') || errorMsg.includes('non-fast-forward') || errorMsg.includes('behind its remote') || errorMsg.includes('git push failed') && (errorMsg.includes('rejected') || errorMsg.includes('remote contains work'))) {return { failureClass: FailureClass.GitBlockers, dispatchAction: DispatchAction.AutoRepair, reason: 'behind' };}
  return null;
}

function classifyOperationalFailure(errorMsg: string): { failureClass: FailureClassType; dispatchAction: DispatchActionType } | null {
  const explicitClass = explicitHumanOnlyClass(errorMsg);
  if (explicitClass === FailureClass.StateMachineViolation) {return { failureClass: explicitClass, dispatchAction: DispatchAction.HumanOnly };}
  const infra = explicitClass === FailureClass.InfraBlocker;
  if (!infra && (/usage\s+limit|hit\s+your\s+(?:weekly|daily|monthly|usage)\s+limit|rate[_\s]?limit\s+(?:reached|exceeded)|\bquota\b|\b429\b[^\n]*?\b(?:rate|usage|quota)\b|resource[_\s ]?(?:has\s+)?been[_\s ]+exhausted|resource_exhausted/i.test(errorMsg))) {return { failureClass: FailureClass.AgentCapacity, dispatchAction: DispatchAction.AutoRepair };}
  if (infra || /did not (submit|leave).*(review (outcome|handoff)|formal review)/i.test(errorMsg)) {return { failureClass: FailureClass.InfraBlocker, dispatchAction: DispatchAction.HumanOnly };}
  return null;
}

function classifyGateOrArtifactFailure(errorMsg: string): { failureClass: FailureClassType; dispatchAction: DispatchActionType } | null {
  if (/verification gate failed|rebase failed before handoff/i.test(errorMsg) || /\bdeclared gate\b/i.test(errorMsg) && /\bfailed\b/i.test(errorMsg)) {return { failureClass: FailureClass.GateFailure, dispatchAction: DispatchAction.AutoSendBack };}
  if (/test(s?\s+)?passed/i.test(errorMsg) && /cannot\s+verify|unverifiable|proof\s+(not\s+)?found|stale\s+proof/i.test(errorMsg)) {return { failureClass: FailureClass.UnverifiableClaims, dispatchAction: DispatchAction.AutoSendBack };}
  if (/malformed\s+gate|invalid\s+gate\s+config|gate\s+command\s+(not\s+found|syntax\s+error|not\s+runnable)/i.test(errorMsg) || /gate/i.test(errorMsg) && /syntax\s+error|not\s+found|missing\s+(file|command)/i.test(errorMsg)) {return { failureClass: FailureClass.MalformedGates, dispatchAction: DispatchAction.AutoRepair };}
  if (errorMsg.includes('even after auto-remediation') || errorMsg.includes('No checkpoint documents found in ') || /mandatory\s+(artifact|file|document)|missing\s+(mission\s+)?(artifact|file|document)|required\s+(artifact|file|document)\s+(not\s+)?found/i.test(errorMsg) || /gatekeeper/i.test(errorMsg) && /missing\s+(artifact|file|document)/i.test(errorMsg)) {return { failureClass: FailureClass.MissingArtifacts, dispatchAction: DispatchAction.AutoSendBack };}
  return null;
}

/** Producer-side annotation of a failed process; never certifies capture or success. */
export function gateFailureReasonFromProcess(input: { status?: number | null; signal?: string | null; stdout?: unknown; stderr?: unknown }): FailureReason | undefined {
  if (input.status === 0 && !input.signal) { return undefined; }
  const diagnostic = `${String(input.stdout ?? '')}\n${String(input.stderr ?? '')}`
    .split('\n').filter(line => !PASSING_TEST_RESULT_LINE_RE.test(line)).join('\n');
  const classification = classifyError(diagnostic);
  const code = hasExplicitHumanOnlyDiagnostic(diagnostic)
    ? classification.failureClass === FailureClass.StateMachineViolation ? 'state-machine' : 'infrastructure'
    : /\[(?:unit-test-(?:budget|cpu)):exceeded\]|integration-test-cpu:exceeded|\[unit-test-(?:budget|cpu)\]\s+SUITE (?:CPU )?BUDGET EXCEEDED|CPU (?:budget|limit) exceeded/i.test(diagnostic) ? 'cpu-budget-exceeded'
      : classification.failureClass === FailureClass.AgentCapacity ? 'agent-quota'
        : input.signal ? 'process-terminated' : 'gate-failed';
  return { version: 1, code };
}
