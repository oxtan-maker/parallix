---
event_type: reviewer_outcome
timestamp: 2026-06-23T05:09:47.315Z
round: 2
phase: reviewing
actor: claude
slug: task-1335
verdict: request-changes
---

# Review Outcome — task-1335 (attempt 2, focus: all)

**Outcome: request-changes**

## Mission
Harden parallix self-hosting publish path so broken trees cannot reach standalone `main`:
fix the red baseline first, then bind a repo-owned exact-tree verification proof to every
publish path and fail closed on missing/stale/borrowed proof.

## Decision summary
The exact-tree proof mechanism and its wiring into both publish paths are genuinely implemented,
and proof regression tests exist. However the mission's gating, falsifiable requirement — a green
`npm test` baseline (Success Criteria #2 and #7, Gate `npm test`, Checkpoint CP-2) — is not met.
The branch tip is red, and the failures are regressions this branch introduced. A mission whose
purpose is to stop broken trees from reaching `main` cannot be approved while its own tree is
broken.

## Evidence
- `px review task-1335 --verify` → reviewer gate FAILED.
- Branch tip `npm test`: `tests 1619 / pass 1594 / fail 3` (consistent over 3 runs) + 1 flaky.
- `main` (fa67880) `npm test`: `tests 1625 / pass 1603 / fail 0`.
- The three failing tests pass on `main` (`tests 9 / pass 9 / fail 0`), confirming regression:
  - `test/review-identity.test.js:109`, `:131` — new `console.error` `[WARN]` from the added
    backlog-transition step in `submitReviewRound` violates the `errors.length === 0` contract.
  - `test/task-1079-review-blocked-fallback.test.js:94` — blocked-reviewer error message
    reworded in `lib/review/review-loop.js`, dropping the `launcher is not available` contract.
- Branch not rebased: `merge-base = b6d8121`, `main = fa67880`; diff falsely shows task-1324/
  1327/1332 missions and `docs/use-cases.md` as deletions (rebase artifacts).
- Feature present: `lib/core/verification.js:69-132`; guards at
  `lib/commands/integrate.js:685-699,1276-1299` and `lib/tools/forgejo.js:429-441,739-753`.
- `missions/task-1335/CP-5.md:34-41` Goal Check table cites no test names (contract requires it).

## Success criteria assessment
| # | Criterion | Status |
|---|---|---|
| 1 | Enumerate all publish paths, distinguish px integrate from others | Met (CP-1, code) |
| 2 | `npm test` passes after disposition regression fix | **FAILED — suite red** |
| 3 | Each publish path runs repo-owned exact-tree gate, aborts on non-zero | Met in code |
| 4 | Reject stale/borrowed proof (diff SHA/tree/checkout) | Met in code |
| 5 | Regression test: broken tree blocked from `main` | Present but unverifiable (suite red) |
| 6 | Regression test: exact-tree binding (green proof not reusable) | Present but unverifiable (suite red) |
| 7 | Notes explain squash provenance loss + new audit boundary | Met (CP-5) |

## Required before approval
1. Make `npm test` green at the branch tip (fix the 3 regressions; address flaky poll test).
2. Rebase onto current `main` and re-run `px review --verify`.
3. Correct CP-2/CP-5 truth claims and add a Goal Check table citing the proof test names.

See `/tmp/task-1335-review-findings.md` for full detail.

---
`[workflow-round:2, workflow-phase:reviewing]`