/** Structured review observations. Terminal wording and styling belong to adapters. */
export type ReviewLoopEvent =
  | { readonly kind: 'local-disposition'; readonly attempt: number }
  | { readonly kind: 'disposition-probe'; readonly attempt: number; readonly implementer: string; readonly startedAt: string }
  | { readonly kind: 'stale-disposition'; readonly attempt: number; readonly existing: string }
  | { readonly kind: 'implementer-dry-run-header'; readonly implementer: string }
  | { readonly kind: 'implementer-dry-run-prompt'; readonly prompt: string }
  | { readonly kind: 'disposition-relaunched'; readonly attempt: number }
  | { readonly kind: 'acting-on-review' }
  | { readonly kind: 'acting-on-finding'; readonly id: string; readonly summary: string }
  | { readonly kind: 'autonomous-implementer'; readonly attempt: number }
  | { readonly kind: 'implementer-launching'; readonly attempt: number; readonly implementer: string }
  | { readonly kind: 'implementer-launch-failed'; readonly implementer: string; readonly message: string }
  | { readonly kind: 'implementer-completed'; readonly attempt: number; readonly implementer: string }
  | { readonly kind: 'stored-resolution'; readonly attempt: number; readonly implementer: string }
  | { readonly kind: 'missing-implementer-output'; readonly attempt: number; readonly implementer: string }
  | { readonly kind: 'implementer-artifact-infra'; readonly diagnostic: string }
  | { readonly kind: 'stored-recovery-resolution'; readonly attempt: number; readonly implementer: string }
  | { readonly kind: 'implementer-recovery-human'; readonly slug: string }
  | { readonly kind: 'implementer-recovery-exhausted'; readonly maxAttempts: number; readonly slug: string }
  | { readonly kind: 'implementer-artifacts-recovered'; readonly attempts: number }
  | { readonly kind: 'missing-disposition'; readonly implementer: string }
  | { readonly kind: 'implementer-timeout-infra'; readonly diagnostic: string }
  | { readonly kind: 'implementer-timeout-exhausted'; readonly dossier: string | undefined; readonly branch: string }
  | { readonly kind: 'implementer-disposition'; readonly attempt: number; readonly value: string }
  | { readonly kind: 'pushback-next-round'; readonly attempt: number }
  | { readonly kind: 'implementer-stopped'; readonly value: string }
  | { readonly kind: 'implementer-no-change'; readonly attempt: number }
  | { readonly kind: 'revision-published'; readonly ok: boolean; readonly attempt: number; readonly branch: string; readonly status: number | null; readonly detail: string }
  | { readonly kind: 'revision-recorded'; readonly attempt: number; readonly revisedHead: string }
  | { readonly kind: 'implementer-next-round'; readonly attempt: number }
  | { readonly kind: 'existing-disposition'; readonly attempt: number; readonly value: unknown }
  | { readonly kind: 'rebase-gate-failed'; readonly area: string; readonly exitCode: number | null; readonly operation: string }
  | { readonly kind: 'gate-command'; readonly command: string }
  | { readonly kind: 'rebase-repair-stranded'; readonly slug: string; readonly outcome: string }
  | { readonly kind: 'rebase-repair-verified'; readonly slug: string }
  | { readonly kind: 'hook-repair-stranded'; readonly outcome: string; readonly slug: string }
  | { readonly kind: 'hook-repair-verified'; readonly slug: string }
  | { readonly kind: 'gate-repair-started'; readonly area: string; readonly exitCode: number | null }
  | { readonly kind: 'gate-repair-stranded'; readonly slug: string; readonly outcome: string }
  | { readonly kind: 'gate-repair-verified'; readonly slug: string }
  | { readonly kind: 'implementer-resumed'; readonly implementer: string }
  | { readonly kind: 'implementer-derived'; readonly implementer: string }
  | { readonly kind: 'implementer-unresolved'; readonly slug: string }
  | { readonly kind: 'adhoc-without-task'; readonly slug: string }
  | { readonly kind: 'handoff-validation-failed'; readonly slug: string }
  | { readonly kind: 'missing-review-pr'; readonly branch: string }
  | { readonly kind: 'handoff-diagnostic'; readonly error: unknown }
  | { readonly kind: 'push-guidance'; readonly slug: string }
  | { readonly kind: 'handoff-failed'; readonly branch: string; readonly error: unknown }
  | { readonly kind: 'start-guidance'; readonly slug: string }
  | { readonly kind: 'handoff-unbound'; readonly slug: string }
  | { readonly kind: 'handoff-starting'; readonly branch: string; readonly taskStatus: string | null; readonly slug: string }
  | { readonly kind: 'handoff-blocked'; readonly branch: string; readonly taskStatus: string | null }
  | { readonly kind: 'handoff-healed'; readonly id: string; readonly branch: string }
  | { readonly kind: 'review-pr-confirmed'; readonly id: string; readonly branch: string }
  | { readonly kind: 'local-provider' }
  | { readonly kind: 'review-resumed'; readonly round: number; readonly phase: string }
  | { readonly kind: 'round-started'; readonly attempt: number; readonly maxAttempts: number }
  | { readonly kind: 'review-reset'; readonly slug: string }
  | { readonly kind: 'reviewer-escalated'; readonly reason: string }
  | { readonly kind: 'approved-round-correction'; readonly slug: string; readonly round: number; readonly diagnostic?: string }
  | { readonly kind: 'approved-round-revoked'; readonly slug: string; readonly round: number; readonly operator: string }
  | { readonly kind: 'attempts-exhausted'; readonly maxAttempts: number }
  | { readonly kind: 'controller-active'; readonly slug: string }
  | { readonly kind: 'local-review'; readonly attempt: number }
  | { readonly kind: 'review-probe'; readonly attempt: number; readonly reviewer: string; readonly startedAt: string }
  | { readonly kind: 'autonomous-reviewer-dry-run'; readonly attempt: number }
  | { readonly kind: 'reviewer-dry-run-header'; readonly reviewer: string }
  | { readonly kind: 'reviewer-dry-run-prompt'; readonly prompt: string }
  | { readonly kind: 'autonomous-reviewer'; readonly attempt: number }
  | { readonly kind: 'reviewer-launching'; readonly attempt: number; readonly reviewer: string }
  | { readonly kind: 'reviewer-classification'; readonly reason: string }
  | { readonly kind: 'reviewer-launch-failed'; readonly reviewer: string; readonly message: string }
  | { readonly kind: 'reviewer-artifact-infra'; readonly diagnostic: string }
  | { readonly kind: 'reviewer-recovery-human'; readonly slug: string }
  | { readonly kind: 'reviewer-recovery-exhausted'; readonly maxAttempts: number; readonly slug: string }
  | { readonly kind: 'reviewer-artifacts-recovered'; readonly attempts: number }
  | { readonly kind: 'missing-review-outcome'; readonly reviewer: string; readonly providerEnabled: boolean; readonly branch: string }
  | { readonly kind: 'reviewer-timeout-exhausted'; readonly dossier: string | undefined; readonly reviewer: string; readonly attempts: number }
  | { readonly kind: 'human-review-guidance' }
  | { readonly kind: 'approval-transition-failed'; readonly slug: string; readonly diagnostic: string }
  | { readonly kind: 'integrate-guidance'; readonly slug: string }
  | { readonly kind: 'reviewer-approved' }
  | { readonly kind: 'missing-resumed-review'; readonly providerEnabled: boolean; readonly reviewer: string; readonly startedAt: string }
  | { readonly kind: 'fixing-resumed'; readonly attempt: number; readonly reviewState: unknown }
  | { readonly kind: 'revision-verified'; readonly attempt: number }
  | { readonly kind: 'runtime-matrix-header' }
  | { readonly kind: 'runtime-matrix-line'; readonly line: string }
  | { readonly kind: 'reviewer-route-unavailable'; readonly implementer: string }
  | { readonly kind: 'different-family-unavailable'; readonly implementer: string; readonly unavailable: { agent: string; detail: string; }[] }
  | { readonly kind: 'single-family-review'; readonly implementer: string }
  | { readonly kind: 'reviewer-resumed'; readonly reviewer: string; readonly round: number }
  | { readonly kind: 'reviewer-defaulted'; readonly detail: string | null }
  | { readonly kind: 'local-review-surfaces' }
  | { readonly kind: 'reviewer-derivation-failed'; readonly detail: string | null }
  | { readonly kind: 'reviewer-override-unavailable'; readonly reviewer: string | undefined; readonly slug: string; readonly persistedContinueReviewer: string }
  | { readonly kind: 'reviewer-unsupported'; readonly reviewer: string | undefined; readonly eligible: boolean; readonly exhausted: boolean }
  | { readonly kind: 'launcher-detail'; readonly detail: string }
  | { readonly kind: 'reviewer-continue-resumed'; readonly reviewer: string | undefined }
  | { readonly kind: 'reviewer-dry-run-defaulted' }
  | { readonly kind: 'reviewer-fallback-routing'; readonly reviewer: string | undefined; readonly eligible: boolean; readonly fallback: string }
  | { readonly kind: 'autonomous-reviewer-selected' }
  | { readonly kind: 'fixing-reviewer-resumed'; readonly reviewer: string | undefined }
  | { readonly kind: 'reviewer-selected'; readonly reviewer: string | undefined; readonly source: string }
  | { readonly kind: 'round-recovery-exhausted'; readonly slug: string; readonly used: number; readonly reboundsPerRound: number; readonly attempt: number; readonly occurrence: string }
  | { readonly kind: 'agent-fallback'; readonly role: 'reviewer' | 'implementer'; readonly original: string; readonly fallback: string }
  | { readonly kind: 'assignee-failed'; readonly fallback: string }
  | { readonly kind: 'controller-superseded'; readonly slug: string; readonly boundary: string; readonly round: number; readonly phase: string }
  | { readonly kind: 'review-started'; readonly slug: string; readonly implementer: string; readonly reviewer: string; readonly branch: string; readonly focus: string; readonly maxAttempts: number; readonly intervalMs: number; readonly timeoutMs: number; readonly verbose: boolean; readonly dryRun: boolean }
  | { readonly kind: 'review-verdict'; readonly disposition: string | null; readonly findings: readonly { id: string; summary: string }[]; readonly verbose: boolean; readonly round?: number }
  | { readonly kind: 'agent-selection'; readonly outcome: 'nominated' | 'skipped-blocked' | 'launch-failed' | 'fallback'; readonly fields: { agent?: string; step: 'review'; reason?: string; retry?: boolean; error?: string } }
  | { readonly kind: 'recovery-progress'; readonly channel: 'log' | 'error'; readonly diagnostic: string };
