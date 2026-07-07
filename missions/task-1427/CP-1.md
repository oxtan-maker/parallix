# CP-1: ADR 0048 Fail-Closed Harness Audit

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| ADR 0048 C1 (GateFailure) classification stub audited | `lib/review/review-loop.ts:251-258` — `classifyGateFailure()` is a hardcoded stub; `lib/commands/active.ts:458-462` — ad-hoc regex bypasses `repairHandoff.classifyError()` | PASS |
| ADR 0048 C2 (MissingArtifacts) classification verified | `lib/commands/repair-handoff.ts:119-123` — pattern matches and dispatches AutoSendBack | PASS |
| ADR 0048 C3 (UnverifiableClaims) classification verified | `lib/commands/repair-handoff.ts:109-111` — pattern matches and dispatches AutoSendBack | PASS |
| ADR 0048 C4 (IncompleteEvidence) classification verified | `lib/commands/repair-handoff.ts:74-77` — pattern matches and dispatches AutoSendBack | PASS |
| AADR 0048 C5 (GitBlockers) classification + auto-repair verified | `lib/commands/repair-handoff.ts:80-96` — dirty + behind patterns; `repairHandoff()` fn:321-413 — auto-commit + auto-rebase logic | PASS |
| ADR 0048 C6 (InfraBlocker) classification verified, action untested | `lib/commands/repair-handoff.ts:132-134` — infra patterns classified as HumanOnly; no caller branches on InfraBlocker dispatch | TODO |
| ADR 0048 C7 (Evidence-reference validation) partially implemented | `lib/commands/handoff.ts:162-199` — verifies goal-check has evidence rows; does NOT validate file:line format of evidence cells | TODO |

## Gap Analysis

### Gap 1: `classifyGateFailure` is a hardcoded stub (C1)

**Location:** `lib/review/review-loop.ts:251-258`

**Current behavior:** Always returns `{classification: 'class-6-genuine-gate-failure', action: 'auto-send-back', isRelaunchable: true}` regardless of error content.

**Required behavior:** Must delegate to `repairHandoff.classifyError()` (or replicate the full 8-class dispatch table) so that different error messages map to different failure classes and dispatch actions.

**Impact:** All gate failures (including infra blockers, state machine violations, etc.) are treated as relaunchable code issues.

### Gap 2: `active.ts` uses ad-hoc gate failure detection (C1)

**Location:** `lib/commands/active.ts:458-462`

**Current behavior:** Uses inline regex `/verification gate failed/i` and `/\bdeclared gate\b/i && /\bfailed\b/i` to detect genuine gate failures.

**Required behavior:** Should delegate to `repairHandoff.classifyError()` for consistent classification across the codebase.

### Gap 3: C6 InfraBlocker — classified but no dispatch action taken

**Location:** `lib/commands/repair-handoff.ts:132-134`

**Current behavior:** `classifyError()` correctly identifies infra blockers and assigns `HumanOnly` dispatch action. However, no caller in `repair-handoff()`, `active.ts`, or `handoff.ts` checks for InfraBlocker specifically — it falls through to the default "not repairable" path.

**Required behavior:** Ensure InfraBlocker errors are surfaced to the user with a clear "human intervention required" message, and that the dispatch action is logged/recorded per ADR 0048.

### Gap 4: C7 Evidence-reference format validation incomplete

**Location:** `lib/commands/handoff.ts:162-199`

**Current behavior:** Verifies that the goal-check table has at least one evidence row (non-separator, non-header row with pipe syntax). Does NOT validate that evidence cells contain the required `file:line` format or test names.

**Required behavior:** Each evidence row's evidence cell should be validated to contain either a `path/to/file:N` pattern or a recognizable test identifier.

## Next Action

CP-2: Fix `classifyGateFailure` stub in `review-loop.ts` to delegate to `repairHandoff.classifyError()` and use the full 8-class dispatch table.
