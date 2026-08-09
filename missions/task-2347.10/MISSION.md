# Mission: Count review fix rounds from a source that records them (task-2347.10)

## Goal
Fix the `Average PR fix rounds to complete mission` metric which currently reports `0.00` for all model-labeled agents by making `deriveImplementerAndFixRounds` count fix rounds from a source that the live review loop actually writes. The metric must reflect true fix-round counts, report unknown when the count cannot be determined, and never return a confident zero from a code path that structurally cannot observe a change request.

## Why Now
The metric has been reporting `0.00` for all model-labeled agents (e.g., `claude-opus-5` 4 missions / 0.00, `gpt-5.6-terra` 5 missions / 0.00) for the week of 2026-08-02 to 2026-08-08, despite those missions receiving change requests. This silently corrupts historical analytics, the mission board's `reviewLoopRate`, and `px stats` output. The root cause is structural: the Review aggregate's `decision` field is never written with `kind: 'changes-requested'` because `applyReviewerCommand` has no live-loop caller, and `decisionFromState` in `src/adapters/review/review-state-mapping.ts:63-76` only manufactures a decision for `phase === 'approved'` or when a previous `changes-requested` decision already exists—which nothing ever creates. Consequently, `deriveImplementerAndFixRounds` at `src/adapters/cli/commands/stats.ts:1430` always counts zero, and the early return at `:1431` short-circuits the PR-comment and branch-history fallbacks that previously counted real rounds.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Metric correctness, analytics integrity, bug fix for silent data corruption

## Scope
- Fix `deriveImplementerAndFixRounds` in `src/adapters/cli/commands/stats.ts` to count fix rounds from a live-written source
- Choose and make authoritative one of: the `mission_review_events` table (written by `persistEventInStore` in `src/adapters/review/review-events.ts:690-736`), or the round sequence itself (grown by `applyReviewStateToReview` in `src/adapters/review/review-state-mapping.ts:139-151`), or properly route reviewer outcomes through `applyReviewerCommand` with findings
- Rename the metric to match what it actually counts (e.g., `review_fix_rounds` → `review_change_request_rounds` if counting from events)
- Ensure missions whose count cannot be determined return unknown and are excluded from averages rather than counted as zero
- Backfill or invalidate the stored zeros already written to `usage_statistics` so historical weeks are not silently wrong
- Add a guard test that fails if the count reads a field with no writer in the live loop

## Out of Scope
- Reworking the review loop's phase model
- Review bounce rate derived from lane transitions (task-2347.09)
- Forgejo comment parsing beyond keeping the existing fallback working
- Changing the Review aggregate's decision model beyond what is necessary to fix the count

## Success Criteria
- A red-to-green test drives a mission through one change-request round and asserts the recorded `pr_fix_rounds` is 1, failing against the current implementation
- A test asserts two change-request rounds record 2, and an approved-first-time mission records 0
- The counted source is asserted to be one that the live loop actually writes; a guard test fails if the count reads a field with no writer
- A mission whose fix-round count cannot be determined is reported as unknown, and unknown is excluded from the average rather than counted as zero
- Stored zeros written by the broken derivation are backfilled or marked unknown, with the affected row count reported
- The board's review-loop figure and `px stats` agree for the same mission, asserted by a test
- `./scripts/verify-local.sh all` passes on the final tree

## Risks and Assumptions
- Assumption: The `mission_review_events` table is the most reliable live-written source for fix-round counting
- Assumption: Backfilling historical data will require a one-time migration script
- Risk: Changing the counting source may cause historical metrics to be recalculated; must ensure backward compatibility for existing stored data
- Risk: If we choose to populate `round.decision` via `applyReviewerCommand`, we must ensure the live loop actually calls it; otherwise we recreate the same structural gap
- Risk: The round sequence approach (counting rounds > 1) may miscount if rounds can be created for reasons other than fix requests

## Checkpoints
- CP 1: Author red-to-green reproduction test that locks the bug — a mission with a change-request round must record `pr_fix_rounds > 0`; test fails on current implementation and passes after fix
- CP 2: Decide authoritative source and implement counting from that source in `deriveImplementerAndFixRounds`
- CP 3: Rename metric, update all references, and ensure unknown exclusion from averages
- CP 4: Backfill or invalidate historical zeros in `usage_statistics`
- CP 5: Add guard test for field-writer verification
- CP 6: Verify board metrics and `px stats` agreement

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/adapters/cli/commands/stats.ts:1430` (must point to an existing file and line)
  2. **Test names** — e.g., `"derives fix rounds from mission_review_events"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2347.10-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `px stats --week 2026-08-02` ``, `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify the review loop phase model (`src/domain/mission-workflow.ts`)
- Do not touch lane transition logic related to task-2347.09
- Do not alter Forgejo comment parsing beyond preserving existing fallback behavior

## Stop Rules
- Stop if the chosen counting source cannot be verified as live-written by the review loop
- Stop if backfilling historical data would require destructive changes to production databases without a migration plan
- Stop if the fix would require reworking the review loop's phase model (out of scope)
- Stop if any gate fails

Reproduction-Test: test/task-2347.10-repro.test.ts
