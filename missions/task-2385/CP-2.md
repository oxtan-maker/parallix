# Checkpoint 2 — Monotonic-round guard + verdict read-miss fail-closed

## Work done
Traced both defect paths and implemented the smallest change that enforces the
round monotonicity invariant and stops the fabricated `round: 1`.

**Path 1 — review-state mapper (the renumbering defect).**
`applyReviewStateToReview` in `review-state-mapping.ts` previously grew the round
list toward `state.round` and then unconditionally rewrote the current round via
`roundFromState`, which set `number` from `state.round` whenever it was positive.
A `round: 1` write onto a `[1, 2]` aggregate rewrote round 2 down to round 1.
The fix computes `suppliedRound` once and throws before persistence when
`suppliedRound < current.number`, with a diagnostic naming both numbers:
`"Cannot apply review state: supplied round <n> is lower than the current round <m>; a stale flattened write must not renumber an existing round"`. Equal and higher round paths are unchanged (equal rewrites in place, higher appends then rewrites the new tail).

**Path 2 — verdict-recording read miss (the stale producer).**
`recordLocalReviewVerdict` in `review-artifacts.ts` constructed a fresh
`ReviewState` with a hardcoded `round: 1` whenever `readReviewState` returned a
falsy value. Confirmed this is the read-miss producer: a read miss during
verdict recording silently downgraded the round to 1, which is exactly the stale
`1` that fed the mapper defect. The fix throws a fail-closed error when no review
state can be read:
`"Cannot record review verdict for <slug>: no review state found. A review must be started with \`px handoff\` before recording a verdict; refusing to fabricate round 1"`. No verdict state is written.

Both changes are confined to the review-state mapping and verdict-recording paths
named in scope; no schema, no SQLite data, no other workflow semantics changed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Lower state round rejected before persistence with both round numbers | `applyReviewStateToReview` throws when `suppliedRound < current.number`; test `rejects a lower state round without renumbering an existing round` asserts the diagnostic matches `round 1` and `round 2` | PASS |
| Equal-round update updates current round | test `updates the current round when the state round equals it` | PASS |
| Higher-round update advances without changing prior numbers | test `advances to a higher round without changing prior round numbers` asserts `[1, 2, 3]` | PASS |
| Read-miss producer identified and fixed | `recordLocalReviewVerdict` no longer constructs `round: 1`; test `fails closed when review state cannot be read instead of fabricating round 1` asserts it rejects and writes no verdict state | PASS |
| Repro test green after fix | `node --experimental-test-module-mocks --import tsx --test test/task-2385-stale-review-round-repro.test.ts` → `# tests 4`, `# pass 4`, `# fail 0` | PASS |
| No new failures vs parent commit | full default suite on node ≥22.23.1 → `# tests 1948`, `# pass 1948`, `# fail 0` (parent commit had the same 42 pre-existing environmental failures, none here) | PASS |
| Static analysis clean | `./scripts/verify-local.sh static-analysis` → all 4 stages PASS (ESLint, `npm run typecheck`, test-hygiene, test typecheck) | PASS |

## Notes
The required runtime is Node ≥22.23.1 (`package.json` engines). The default
shell `node` is v24; the repo's `node:sqlite`-backed suites fail on Node <22.23.1
with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`, so gate runs must use Node ≥22.23.1.

## Next action
CP-3: exercise the persisted-verdict / `px status <slug>` path, document the
supported recovery procedure for an unrecorded approved verdict, and run both
mission gates to capture final evidence.
