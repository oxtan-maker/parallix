# Mission: Close remaining rebouncing gaps in the fail-closed harness (task-1427)

## Goal

Audit ADR 0048's fail-closed harness controls (C1-C7) against the current implementation and implement every control that is not yet built, so that every failure class defined in ADR 0048 is routed through its correct dispatch action, and every control the ADR describes actually exists in code — not deferred, not tracked-only.

## Why Now

The autofixing missions (TASK-1383 through TASK-1389) landed C1 (pre-review gate enforcement), C2 (gate-failure send-back), C3 (error classifier), C4 (declared-gate pre-validation), and C5 (gatekeeper send-back). Three concrete gaps remain, all confirmed by reading the current source against ADR 0048's text — none of this is inferred from task IDs or comments alone:

1. **`classifyGateFailure` stub (review-loop.ts).** `lib/review/review-loop.ts:251-258` is a hardcoded stub that always returns `{classification: 'class-6-genuine-gate-failure', action: 'auto-send-back'}` regardless of the actual error content. This means infra blockers, state machine violations, and other non-relaunchable errors are treated as relaunchable gate failures in the pre-review auto-bounce path. ADR 0048 and TASK-1389 both stated TASK-1389 would replace this stub with the full 8-class dispatch table — it never happened here.

2. **Ad-hoc regex in active.ts.** `lib/commands/active.ts:458-462` detects gate failures with inline regex (`/verification gate failed/i`, `/\bdeclared gate\b/i`) instead of delegating to `repairHandoff.classifyError()`. This duplicates pattern matching from repair-handoff.ts and means newly classified error patterns won't trigger auto-relaunch in the active path.

3. **C6 and C7 are unimplemented, not just untracked.** ADR 0048's Decision Matrix schedules C6 (Forgejo/infra blocker classification, "make the operator message deterministic and actionable") and C7 (checkpoint evidence reference validation, "verify reference shape and existence, not... score evidence quality semantically") as "Implement Next Wave" — scheduled work, not optional work. Verified against current code:
   - **C6 is unmet:** `repairHandoff()` in `lib/commands/repair-handoff.ts:315-318` already classifies InfraBlocker via `classifyError()` (line 132-134), but on any non-GitBlocker classification it prints the same generic line for every class alike: `` `Handoff error is not automatically repairable: ${errorMsg}` `` and returns `{repaired: false, blocker: null}`. There is no InfraBlocker-specific, deterministic, actionable operator message — the classification is computed but thrown away before it reaches the operator.
   - **C7 is unmet:** the Goal Check evidence-row check in `lib/commands/handoff.ts:169-199` (mirrored in `lib/review/review-commands.ts:258-293`) only verifies that a 3-column pipe-table row exists after the header. It never checks that the row's content is a real `file:line` reference, an ADR reference (e.g. `ADR 0048`), or a test name — a row of pure placeholder prose (e.g. `| Works | Tested manually | Looks good |`) currently passes.

Gaps 1 and 2 cause the harness to either over-relaunch (stranding agents on infra blockers) or under-relaunch (missing new error patterns the central classifier recognizes but the ad-hoc regex misses). Gap 3 means two ADR-scheduled controls simply don't exist yet, even though ADR 0048 committed to shipping them.

## Refinement Signals

- Predicted NEL bucket: Medium-High — this mission now spans four call sites across three files (review-loop.ts, active.ts, repair-handoff.ts, handoff.ts + its review-commands.ts mirror), not two.
- Confidence: Medium — C6/C7 additions are new logic (not pure delegation), so estimate accordingly.
- Selection note: Two classifier-delegation fixes plus two new mechanical validators, all built on the existing 8-class dispatch table from TASK-1389 — no new failure classes, no new dispatch actions.
- Main drivers: `classifyGateFailure` stub never wired to the full classifier; active.ts duplicates classifier patterns; InfraBlocker classification is computed but never surfaced as an actionable operator message (C6); Goal Check evidence rows are checked for presence but not for real references (C7).

## Scope

- **In scope:**
  - Replace the hardcoded `classifyGateFailure` stub in `lib/review/review-loop.ts:251-258` with a delegation to `repairHandoff.classifyError()` so pre-review gate failures are classified using the full 8-class dispatch table. Preserve the `{classification, action, isRelaunchable}` shape expected by `handleGateFailureAutoBounce`.
  - Replace the ad-hoc inline regex gate-failure detection in `lib/commands/active.ts:458-462` with a call to `repairHandoff.classifyError()` followed by a check on `failureClass === FailureClass.GateFailure`.
  - **C6:** In `repairHandoff()` (`lib/commands/repair-handoff.ts:309-318`), branch on `classification.failureClass === FailureClass.InfraBlocker` and produce a deterministic, actionable operator message distinct from the generic strand line — e.g. naming the blocker as infrastructure-related, stating that no agent relaunch will resolve it, and telling the operator what to check (Forgejo credentials/connectivity/rate limits per the matched pattern). Populate the `blocker` return field with this message (it is currently always `null`) so callers can surface it. Preserve the existing runtime outcome — the handoff still fails and still requires a human, only the message changes.
  - Update the caller in `lib/commands/active.ts` (around line 495-503) to print the `blocker` message from `repairHandoffFn` when present, instead of only the generic `handoffResult.error`.
  - **C7:** Extend the Goal Check evidence-row validation in `lib/commands/handoff.ts:169-199` (and its mirror in `lib/review/review-commands.ts:258-293`) to check that at least one evidence row's cell content matches a real reference shape: a `path/to/file.ext:123` file:line pattern (and the file must exist in the repo), an ADR reference (`ADR \d{4}`), or a recognizable test name (matches an existing test file's `test(...)`/`it(...)` name, or is at minimum a `path/to/test-file.test.js` reference). Keep this mechanical — verify shape and existence, do not attempt to judge whether the evidence is *good*, only that it is not placeholder prose.
  - Update or add unit tests in `test/task-1385-pre-review-gate.test.js` to verify `classifyGateFailure` returns the correct classification/action for at least 3 distinct failure classes (InfraBlocker, StateMachineViolation, GateFailure).
  - Update or add unit tests in `test/repair-handoff.test.js` verifying: (a) `runHandoffAndReview` delegates to `classifyError` for gate-failure detection, (b) `repairHandoff()` returns a non-null, InfraBlocker-specific `blocker` message for infra-pattern errors.
  - Add unit tests (new file or extend `test/handoff.test.js`) verifying the Goal Check evidence-reference validator accepts a row with a real file:line reference and rejects a row of placeholder prose with no recognizable reference.
  - Update the ADR 0048 `Consequences` section to note that the `classifyGateFailure` stub has been replaced, and that C6/C7 have moved from "Implement Next Wave" to implemented.

- **Out of scope:**
  - Adding new dispatch behaviors for failure classes that currently have no handler (e.g., UnverifiableClaims auto-send-back prompt).
  - Modifying the retry budget logic, agent relaunch mechanics, or any aspect of the Forgejo integration beyond the operator-facing message.
  - Changing the `isRelaunchableError` function or its callers beyond the active.ts regex → classifier migration.
  - Semantic scoring of evidence quality (C7 must stay mechanical: reference shape + existence, never "is this a good explanation").

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- **SC1:** `classifyGateFailure` in `lib/review/review-loop.ts` calls `repairHandoff.classifyError()` internally and no longer contains hardcoded string-returning logic. Verified by reading the source at `lib/review/review-loop.ts:251-258`.
- **SC2:** `classifyGateFailure` returns `action: 'human-only'` (or equivalent) for InfraBlocker patterns (e.g., `"Authentication failed for Forgejo: token expired"`). Verified by a unit test in `test/task-1385-pre-review-gate.test.js`.
- **SC3:** `classifyGateFailure` returns `action: 'human-only'` for StateMachineViolation patterns (e.g., `"State violation: invalid transition from active to review"`). Verified by a unit test in `test/task-1385-pre-review-gate.test.js`.
- **SC4:** `classifyGateFailure` returns `action: 'auto-send-back'` for GateFailure patterns (e.g., `"verification gate failed: exit code 1"`). Verified by a unit test in `test/task-1385-pre-review-gate.test.js`.
- **SC5:** `lib/commands/active.ts` no longer contains inline regex patterns `/verification gate failed/i` or `/\bdeclared gate\b/i` for gate-failure detection. Verified by absence of these patterns in `lib/commands/active.ts:458-462`.
- **SC6:** `lib/commands/active.ts` delegates gate-failure detection to `repairHandoff.classifyError()` and checks `failureClass === 'GateFailure'`. Verified by reading the source at `lib/commands/active.ts:458-462`.
- **SC7:** For an InfraBlocker-classified error (e.g., `"connection timed out"`), `repairHandoff()` returns a non-null `blocker` string that names the failure as infrastructure-related and states that agent relaunch will not help. Verified by a unit test in `test/repair-handoff.test.js` asserting on `result.blocker`.
- **SC8:** `lib/commands/active.ts` prints the `blocker` message returned by `repairHandoffFn` when present. Verified by reading the caller around `lib/commands/active.ts:495-503`.
- **SC9:** The Goal Check evidence-row validator in `lib/commands/handoff.ts` rejects a final checkpoint whose only evidence row contains no file:line, ADR, or test-name reference (e.g., `| Works | Tested manually | Looks good |`), and accepts one that does (e.g., `| SC1 | lib/foo.ts:42 | test/foo.test.js |`). Verified by a unit test.
- **SC10:** The same validation logic is applied in `lib/review/review-commands.ts`'s pre-review checkpoint check (mirroring `lib/commands/handoff.ts`), so a checkpoint with only placeholder evidence fails pre-review gate enforcement, not just handoff. Verified by reading `lib/review/review-commands.ts:258-293` and by a unit test.
- **SC11:** All existing tests in `test/repair-handoff.test.js`, `test/task-1385-pre-review-gate.test.js`, and the handoff/review-commands test suites pass after the changes. Verified by running `./scripts/verify-local.sh all`.
- **SC12:** No new `.only` or bare `.skip` test cases introduced. Verified by scanning test files for `test.only` or `test.skip` (bare, not conditional).

## Risks and Assumptions

- **Risk:** The `classifyGateFailure` stub currently returns `{isRelaunchable: true}` for all inputs. Delegating to the full classifier may return `isRelaunchable: false` for InfraBlocker and StateMachineViolation errors, changing the runtime behavior of `handleGateFailureAutoBounce`. This is intentional (closing the over-relaunch gap) but must be verified with tests.
- **Risk:** Removing the ad-hoc regex in active.ts and delegating to the classifier must not miss any error messages the regex previously caught. The classifier's pattern set in `repair-handoff.ts:99-106` must be verified to cover the same patterns.
- **Risk:** The C7 evidence-reference validator must not become a false-positive machine — real evidence rows in existing missions must still pass. Before tightening the check, sample a handful of existing `CP-*.md` files under `missions/` to confirm the new pattern set does not retroactively reject legitimate rows it previously accepted.
- **Risk:** Tightening C7 validation at pre-review time (`review-commands.ts`) as well as handoff time could newly fail missions that previously passed with weak evidence. This is the intended effect of closing the gap, but confirm it does not break in-flight missions' test fixtures.
- **Assumption:** The 8 failure class definitions and pattern matching in `repair-handoff.ts:68-137` are correct and complete. If new error patterns emerge, they should be added to the classifier, not duplicated in review-loop.ts or active.ts.
- **Assumption:** The `handleGateFailureAutoBounce` function in review-loop.ts is prepared to handle non-auto-send-back classifications. Current code at line 419 prints the classification but does not gate on `action === 'auto-send-back'` before launching the agent; if the classifier returns `HumanOnly`, the agent will still be launched — this behavior should remain unchanged for now (bounded by retry count).
- **Assumption:** No other callers of `classifyGateFailure` exist outside the review loop. Verified by grep before making changes.

## Checkpoints

- **CP 1:** Audit complete. Document all gaps between ADR 0048's prescribed behavior (C1-C7) and the current implementation, with code references. Confirm C6/C7 gaps by reading the actual code paths (not inferring from comments).
- **CP 2:** `classifyGateFailure` in `review-loop.ts` updated to delegate to `repairHandoff.classifyError()`. Tests added verifying correct classification for GateFailure, InfraBlocker, and StateMachineViolation error patterns.
- **CP 3:** `runHandoffAndReview` in `active.ts` updated to delegate gate-failure detection to `repairHandoff.classifyError()`. Inline regex removed. Tests verify the delegate path is exercised.
- **CP 4:** C6 implemented: `repairHandoff()` produces a deterministic, actionable InfraBlocker operator message; `active.ts` surfaces it. Tests added.
- **CP 5:** C7 implemented: evidence-reference validation added to `handoff.ts` and mirrored in `review-commands.ts`. Tests added, including a check against a sample of existing checkpoint files to rule out false positives.
- **CP 6:** All existing tests pass. ADR 0048 updated. Goal Check table cites real evidence.

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not modify the `classifyError` pattern set or dispatch table in `lib/commands/repair-handoff.ts:1-138` — the 8-class classification logic itself is considered correct; this mission consumes and surfaces it (via the new `blocker` message), it does not change what gets classified as what.
- Do not modify `lib/commands/handoff.ts` or `lib/commands/active.ts` beyond the specific blocks named in Scope (gate-failure detection, evidence-row validation, blocker-message surfacing).
- Do not modify `lib/tools/gatekeeper.ts` — gatekeeper auto-send-back is TASK-1388 and is not in scope.
- Do not modify any ADR files other than ADR 0048, and only to update its Consequences section and mark C6/C7 as implemented.
- Do not add semantic quality scoring to the C7 evidence validator — shape and existence checks only.

## Stop Rules

- Stop if fixing `classifyGateFailure` requires changing the function signature or the contract expected by `handleGateFailureAutoBounce` — the shape `{classification, action, isRelaunchable}` must be preserved.
- Stop if the `runHandoffAndReview` gate-failure detection in active.ts requires changes to the retry budget loop or the handoff re-invocation logic.
- Stop if any existing test in `test/repair-handoff.test.js` or `test/task-1385-pre-review-gate.test.js` fails due to behavioral changes (not just compilation errors).
- Stop if the C7 evidence-reference validator, when run against a sample of existing checkpoint files under `missions/`, rejects evidence rows that were previously accepted and are not placeholder prose — tighten the reference-shape patterns rather than shipping a validator with false positives.
