# Mission: Check the bounce on review errors (task-2233)

## Goal
Ensure that a reviewer's failure to submit a formal review outcome follows the ADR 0048 defined recoverable bounce path — retry the reviewer with a recovery prompt, then escalate to human review only after the configured retry budget is exhausted. Fix the regression exposed by the `e2e-real-agent-smoke` test where the error `"Reviewer custom did not submit a formal review outcome"` is thrown without completing the recovery loop, and ensure every review-bounce case required by ADR 0048 has a corresponding test.

## Why Now
The `e2e-real-agent-smoke` test (`test/e2e-real-agent-smoke.test.ts`, `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"`) fails with `AssertionError: [parallix-workflow-failure] px active --implementer custom failed (status=1): [FAIL] Reviewer custom did not submit a formal review outcome for mission/task-9001.` This blocks the `custom-agent-smoke` integration gate (`config/integration-pipelines.json` order 51) and means the full lifecycle of a custom agent cannot be verified end-to-end. The ADR 0048 recovery loop exists in `review-loop.ts` but the error path at lines 1358-1361 fires without completing recovery retries, indicating a gap between the ADR specification and the implemented dispatch behavior.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single error path in `review-loop.ts` recovery loop; ADR 0048 dispatch table is already implemented in `repair-handoff.ts`; the fix is classification/routing, not new infrastructure.

## Scope
- Trace the review outcome collection path from `consumeReviewerArtifacts()` through `pollForReview()` to the error site at `review-loop.ts:1358-1369`.
- Verify the recovery loop (`review-loop.ts:1287-1345`, `reviewerRetryCount` < 2) executes for all reviewer-non-submission cases, including the `!reviewState` path when `forgejoEnabled` is true.
- Map the `REVIEWER_NON_APPROVAL` escalation reason to an ADR 0048 failure class and confirm the dispatch action matches the ADR (human-only after bounded retries).
- Fix any gaps where the error is thrown before the recovery loop completes or where a reviewer-non-submission case bypasses the recovery loop entirely.
- Ensure the `classifyError()` function in `repair-handoff.ts` classifies reviewer-non-submission errors correctly (or add a new pattern if missing).
- Add or update tests covering every review-bounce case required by the ADR.

## Out of Scope
- Modifying the retry budget (currently 2 retries) — the budget value is configurable and stable.
- Adding new failure classes beyond the 8 defined in ADR 0048.
- Changing the reviewer prompt or artifact format (`review-outcome.md`, `review-findings.md`, `review-verdict.txt`).
- The implementer disposition recovery loop (`implementerRetryCount`) — only the reviewer path is in scope.
- The `e2e-real-agent-smoke` test fixture itself (worktree setup, agent selection) — only the review-loop behavior it exercises.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: The error `"Reviewer custom did not submit a formal review outcome"` at `review-loop.ts:1358-1359` is either eliminated (path unreachable) or the code path enters the recovery loop (`reviewerRetryCount` increments) before reaching it.
- SC2: The `REVIEWER_NON_APPROVAL` escalation at `review-loop.ts:1348`, `1364`, and `1371` fires only after `reviewerRetryCount` has reached 2 (the configured retry limit), confirmed by asserting `state.reviewerRetryCount === 2` in the reproduction test.
- SC3: The `classifyError()` function in `repair-handoff.ts` has a pattern that matches reviewer-non-submission error messages and returns a determinate failure class (existing or new), verified by a unit test assertion.
- SC4: The `e2e-real-agent-smoke` test assertion at `test/e2e-real-agent-smoke.test.ts:862` (`activeResult.status === 0`) passes with the fix, meaning the full lifecycle completes without the reviewer-non-submission error.
- SC5: Every review-bounce case in ADR 0048 (pre-review gate auto-bounce, gate-failure auto-send-back, reviewer recovery retries, reviewer escalation, declared-gate validation auto-bounce) has at least one test with a passing assertion in the test suite under `test/`.

## Risks and Assumptions
- The `!reviewState` path at `review-loop.ts:1355-1361` may be unreachable code due to the `reviewState = POLL_TIMEOUT` assignment at line 1285. If unreachable, the fix is to remove it and confirm the e2e test passes via the recovery loop path alone. Risk: if the path is reachable in a configuration variant (e.g., `forgejoEnabled = false`), removing it changes behavior.
- The e2e test failure may be environment-specific (the custom agent runner may not be posting reviews to Forgejo in the test fixture). The fix may need to address the test fixture's artifact path or the reviewer's artifact consumption, not just the recovery loop logic.
- The ADR 0048 dispatch table in `repair-handoff.ts` does not currently include a reviewer-non-submission pattern — the reviewer path in `review-loop.ts` handles recovery inline rather than delegating to `classifyError()`. The fix may involve adding the pattern to `classifyError()` or confirming the inline recovery is sufficient per the ADR.

## Checkpoints
- CP 1: Red deterministic reproduction and ADR-to-code mapping. Author a failing reproduction test that locks the bug: verify the reviewer-non-submission error fires at `review-loop.ts:1358-1359` without completing the recovery loop, and map each ADR 0048 review-bounce control (C1 pre-review gate, C2 gate-failure send-back, C3 error classifier, C6 infra blocker classification) to its implementation location in `review-loop.ts` and `repair-handoff.ts`.
- CP 2: Repair classification/routing and focused tests. Fix the gap where reviewer-non-submission bypasses or exits the recovery loop prematurely. Add or update `classifyError()` patterns if the reviewer path should delegate to the shared classifier. Cover the fix with unit tests in `test/`.
- CP 3: Lifecycle regression coverage and verification evidence. Confirm the `e2e-real-agent-smoke` test passes. Verify every ADR 0048 review-bounce case has test coverage. Capture verification gate proof.

Reproduction-Test: test/task-2233-reviewer-non-submission-bounce.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/platform/runtime/lib/review/review-loop.ts:1358` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `node --import tsx test/task-2233-reviewer-non-submission-bounce.test.ts` ``, `` `./scripts/verify-local.sh all` ``, or `` `git diff --stat` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Recovery loop executes before REVIEWER_NON_APPROVAL | `src/platform/runtime/lib/review/review-loop.ts:1287-1345`, `reviewerRetryCount` increments from 0 to 2 | PASS |
| classifyError has reviewer-non-submission pattern | `src/platform/runtime/lib/commands/repair-handoff.ts:144` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- Do not modify the reviewer prompt template (`review-prompts.ts`) or artifact format (`review-artifacts.ts` file I/O) — only the recovery loop control flow in `review-loop.ts` and the classifier in `repair-handoff.ts`.
- Do not change the e2e test fixture setup (`e2e-real-agent-smoke.test.ts` preflight, worktree, agent selection) — only the review-loop behavior it exercises.
- Do not add new ADR 0048 failure classes — work within the existing 8-class model.

## Stop Rules
- Do not weaken the requirement for a formal review outcome or make an agent's silent exit an approval.
- Escalate to human review only after the configured automatic retry budget (2 retries) is exhausted.
- Do not introduce new configurable parameters (retry count, poll interval) — use existing values.
- Do not modify the reviewer recovery prompt text beyond clarifying the error diagnostic.
