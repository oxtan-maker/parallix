# Mission: Replace generic not-automatically-repairable strand with error classifier and dispatch table (task-1389)

## Goal

Replace the binary `isRelaunchableError` / `isDirtyError` / `isBehind` classification logic in `lib/commands/repair-handoff.ts` with a structured error classifier that maps each incoming error message pattern to one of the eight failure classes defined in ADR 0048 and a dispatch action (`auto-repair`, `auto-send-back`, or `human-only`). The classifier becomes the single source of truth for dispatch decisions, enabling downstream missions (TASK-1385 pre-review gate, TASK-1387 gate-failure send-back, TASK-1388 gatekeeper send-back) to plug into the same classification schema instead of duplicating string-matching logic.

## Why Now

ADR 0048 Control C3 identifies the current binary classification as the structural bottleneck in the fail-closed harness. Every error that does not match `isDirtyError`, `isBehind`, or the narrow goal-check relaunchable pattern falls through to a generic "not automatically repairable" log message at `repair-handoff.ts:143-144`, requiring manual re-invocation. The 8 failure classes are already defined and agreed upon in ADR 0048. TASK-1389 provides the dispatch framework that C1 (pre-review gate, TASK-1385) and C2 (gate-failure send-back, TASK-1387) plug into. Without the classifier, those downstream missions must replicate the same string-matching logic, creating drift risk. Implementing C3 first gives them a single, tested classification seam.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: ADR 0048 C3 (foundational dispatch framework), eliminates the largest stranded-error path, enables C1/C2 downstream missions to share classification logic

## Scope

- Define `FailureClass` type with the 8 classes from ADR 0048: `UnverifiableClaims`, `MalformedGates`, `MissingArtifacts`, `IncompleteEvidence`, `GitBlockers`, `GateFailure`, `InfraBlocker`, `StateMachineViolation`
- Define `DispatchAction` type with 3 actions: `AutoRepair`, `AutoSendBack`, `HumanOnly`
- Implement `classifyError(errorMsg: string): { failureClass: FailureClass, dispatchAction: DispatchAction }` that maps error message patterns to failure classes using regex-based pattern matching
- Implement `getDispatchAction(failureClass: FailureClass): DispatchAction` dispatch table mapping each of the 8 failure classes to its prescribed action per ADR 0048
- Map existing patterns to failure classes: dirty-artifact errors → `GitBlockers(auto-repair)`, behind-branch errors → `GitBlockers(auto-repair)`, goal-check missing-evidence errors → `IncompleteEvidence(auto-send-back)`, verification-gate-failed errors → `GateFailure(auto-send-back)`, declared-gate-failed errors → `GateFailure(auto-send-back)`
- Refactor `repairHandoff()` to use `classifyError()` internally instead of the separate `isDirtyError` / `isBehind` boolean checks, while preserving the existing auto-commit and auto-rebase behavior
- Export `classifyError` and `getDispatchAction` as public members so TASK-1385 and TASK-1387 can import and use them
- Keep `isRelaunchableError` as a thin wrapper around `classifyError` for backward compatibility with existing callers in `active.ts`
- Keep `buildRelaunchPrompt` with its existing signature and behavior; it already accepts error messages and works via the `isRelaunchableError` wrapper
- Add unit tests in `test/repair-handoff.test.js` covering: (a) each of the 8 failure classes is correctly classified from representative error messages, (b) dispatch table returns the correct action for each class, (c) `classifyError` is used internally by `repairHandoff()` for dirty/behind/relaunchable patterns, (d) backward compatibility: `isRelaunchableError` returns the same results as before, (e) existing tests for auto-commit, rebase, and conflict detection still pass

## Out of Scope

- Implementing the runtime dispatch behavior for `AutoSendBack` or `HumanOnly` — the classifier returns the action, but the actual relaunch/send-back mechanics are implemented by TASK-1387 and TASK-1388
- Modifying `lib/commands/handoff.ts` — handoff-time gate failure detection remains the concern of TASK-1387; TASK-1389 only provides the classifier that handoff can consume later
- Modifying `lib/commands/active.ts` beyond ensuring the exported `classifyError` is accessible — active.ts will be updated by downstream missions to use the dispatch table instead of inline string matching
- Modifying `lib/core/verification.ts` or any verification-gate execution code
- Modifying `lib/review/` — pre-review-round gate enforcement is TASK-1385
- Modifying `lib/commands/integrate.ts` — integration-time gates are handled separately
- Adding a CLI command or user-facing interface for the classifier

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC1: `classifyError()` correctly classifies all 8 failure classes from representative error messages. Verified by 8 unit tests in `test/repair-handoff.test.js`, one per failure class, each asserting `classifyError(testMessage).failureClass` equals the expected enum value.
- SC2: `getDispatchAction()` returns the correct action for all 8 failure classes per ADR 0048: `GitBlockers` → `AutoRepair`, `GateFailure` → `AutoSendBack`, `IncompleteEvidence` → `AutoSendBack`, `UnverifiableClaims` → `AutoSendBack`, `MalformedGates` → `AutoRepair`, `MissingArtifacts` → `AutoSendBack`, `InfraBlocker` → `HumanOnly`, `StateMachineViolation` → `HumanOnly`. Verified by 8 assertions in a single test in `test/repair-handoff.test.js` iterating over the dispatch table.
- SC3: `repairHandoff()` uses `classifyError()` internally for dirty-artifact errors (matches `"is modified but uncommitted"` / `"Commit the mission contract"` / `"Commit the implementation evidence"`), behind-branch errors (matches `"Updates were rejected"` / `"fetch first"` / `"non-fast-forward"` / `"behind its remote"`), and relaunchable errors (goal-check missing evidence). Verified by a unit test in `test/repair-handoff.test.js` that mocks `gitFn` to return dirty status, calls `repairHandoff()`, and asserts `repaired: true` — confirming the auto-commit path still triggers via the classifier.
- SC4: `isRelaunchableError()` returns identical results to the pre-mission implementation for all existing test inputs: goal-check missing-evidence message returns `true`; `null`, `undefined`, empty string, unknown messages return `false`; dirty-error messages return `false`; behind-error messages return `false`. Verified by the existing tests in `test/repair-handoff.test.js` passing unchanged after the mission's changes land.
- SC5: `classifyError` and `getDispatchAction` are exported from `repair-handoff.ts` as named exports and can be imported by other modules (verified by a test in `test/repair-handoff.test.js` that imports `{ classifyError, getDispatchAction }` from `'../lib/commands/repair-handoff'` and calls both functions).
- SC6: Static analysis gate (`./scripts/verify-local.sh all`) passes clean on the final tree, including ESLint (max 300 warnings), tsc typecheck (no TS errors excluding TS18003), and test-hygiene checks.

## Risks and Assumptions

- Risk: Pattern matching collisions — a new error message could match multiple failure-class patterns. Mitigation: order the pattern checks by specificity (most specific regex first, e.g., goal-check message before generic gate-failure pattern), and add a test for ambiguous/error messages that should NOT match.
- Risk: Breaking backward compatibility with `isRelaunchableError` callers. Mitigation: `isRelaunchableError` delegates to `classifyError` and returns true only for `IncompleteEvidence` and `GateFailure` classes (the only classes that were relaunchable under the old logic). All existing tests must pass.
- Risk: The dispatch table adds a maintenance surface — new error patterns from future gate commands or handoff validations must be classified. Mitigation: document the classification procedure in a comment on `classifyError` and add a TODO for ADR 0048 C4-C7 implementations to follow the same pattern.
- Assumption: The 8 failure classes defined in ADR 0048 are final and will not change during the lifetime of this implementation.
- Assumption: Downstream missions (TASK-1385, TASK-1387, TASK-1388) will import `classifyError` from `repair-handoff.ts` rather than duplicating classification logic.
- Assumption: The existing `attemptAgentRelaunch` flow in `active.ts` already handles the relaunch prompt construction; the classifier only needs to classify, not construct prompts.

## Checkpoints

- CP 1: Define `FailureClass` enum with 8 values and `DispatchAction` enum with 3 values; implement `getDispatchAction()` dispatch table mapping each failure class to its prescribed action per ADR 0048. Add unit tests verifying SC2 (dispatch table correctness).
- CP 2: Implement `classifyError()` with regex-based pattern matching for all 8 failure classes. Map existing patterns: dirty-artifact → `GitBlockers`, behind-branch → `GitBlockers`, goal-check missing evidence → `IncompleteEvidence`, verification-gate-failed → `GateFailure`, declared-gate-failed → `GateFailure`. Add unit tests verifying SC1 (classification correctness for all 8 classes).
- CP 3: Refactor `repairHandoff()` to use `classifyError()` internally for dirty/behind/relaunchable patterns while preserving existing auto-commit and auto-rebase behavior. Update `isRelaunchableError` to delegate to `classifyError`. Export `classifyError` and `getDispatchAction` as named exports. Add backward-compatibility tests verifying SC4. Run `./scripts/verify-local.sh all`.

## Gates

- [ ] ./scripts/verify-local.sh static-analysis
- [ ] npm test

## Restricted Areas

- Do not modify `lib/commands/handoff.ts` — handoff-time gate failure detection and output capture is TASK-1387.
- Do not modify `lib/commands/active.ts` — active.ts dispatch logic updates are for downstream missions; this mission only ensures the new exports are accessible.
- Do not modify `lib/core/verification.ts` — verification gate execution is out of scope.
- Do not modify `lib/review/` — pre-review-round enforcement is TASK-1385.
- Do not modify `lib/commands/integrate.ts` — integration-time gates are handled separately.
- Do not modify `lib/tools/gatekeeper.ts` — gatekeeper auto-send-back is TASK-1388.

## Stop Rules

- Stop if the pattern matcher cannot distinguish between `GateFailure` and `IncompleteEvidence` error messages without false positives — both may contain the word "failed"; refine regex specificity.
- Stop if refactoring `repairHandoff()` to use `classifyError()` causes any existing test in `test/repair-handoff.test.js` to fail — the auto-commit and auto-rebase paths must behave identically.
- Stop if `isRelaunchableError` backward-compatible behavior diverges from the pre-mission implementation — all existing `isRelaunchableError` tests must pass unchanged.
- Stop drafting if ADR 0048 is superseded with a different failure-class taxonomy — switch to the new taxonomy instead.
