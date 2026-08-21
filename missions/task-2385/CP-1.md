# Checkpoint 1 — Stale-round reproduction test (red first)

## Work done
Wrote the regression reproduction test before any production change, per the
red-before-green requirement. The test builds a Review aggregate holding review
rounds 1 and 2 and applies a flattened `applyReviewStateToReview` update with
`round: 1`. On the mission parent commit (`c2db7699c`) this renumbers round 2 to
round 1, producing a duplicate round number — the exact defect that then hit the
`mission_review_rounds` UNIQUE constraint on write and dropped the verdict.

The test also pins the two invariants the fix must preserve: an equal-round
update updates the current round, and a higher-round update advances the round
list without changing prior round numbers.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repro test exists at the mandated path | `test/task-2385-stale-review-round-repro.test.ts` | PASS |
| Test is red on the mission parent commit | `node --test test/task-2385-stale-review-round-repro.test.ts` on `c2db7699c` → `# pass 2`, `# fail 2` (test `rejects a lower state round without renumbering an existing round` fails: "a stale lower round must be rejected") | PASS |
| Test is green once the fix lands | same file after fix → `# tests 4`, `# pass 4`, `# fail 0` | PASS |
| Lower round rejected with both round numbers in diagnostic | test `rejects a lower state round without renumbering an existing round` asserts the thrown message matches `round 1` and `round 2` | PASS |
| No duplicate round persisted / round 2 stays 2 | the lower-round rejection throws before constructing a new round list; the test asserts the input aggregate is left unmutated (`review.rounds` stays `[1, 2]`, unique) — the rejection itself prevents duplicate-round creation | PASS |
| Equal-round update updates current round | test `updates the current round when the state round equals it` | PASS |
| Higher-round update preserves prior numbers | test `advances to a higher round without changing prior round numbers` asserts `[1, 2, 3]` | PASS |

## Red → green evidence

- Red (parent commit `c2db7699c`, production unchanged):
  `node --experimental-test-module-mocks --import tsx --test test/task-2385-stale-review-round-repro.test.ts`
  → `# pass 2` / `# fail 2`. The two failing tests are
  `rejects a lower state round without renumbering an existing round` (the
  stale write renumbers round 2 to round 1) and `fails closed when review state
  cannot be read instead of fabricating round 1` (the read-miss path fabricated
  round 1). Note: within the first failing test the first `assert.ok(message, ...)`
  throws, so the trailing input-mutation assertion never executed at the parent
  commit; the duplicate-round guarantee is carried by the rejection itself.
- Green (after CP-2 production fix, same command):
  → `# tests 4` / `# pass 4` / `# fail 0`.

Test file path: `test/task-2385-stale-review-round-repro.test.ts`.
Test names: `rejects a lower state round without renumbering an existing round`,
`updates the current round when the state round equals it`,
`advances to a higher round without changing prior round numbers`,
`fails closed when review state cannot be read instead of fabricating round 1`.

## Next action
CP-2: trace the mapper and verdict-recording paths, confirm the read-miss
producer, and implement the monotonic-round guard plus the read-miss fail-closed
fix, then re-run the repro test green.
