---
event_type: reviewer_outcome
timestamp: 2026-06-23T05:37:57.066Z
round: 4
phase: reviewing
actor: claude
slug: task-1335
verdict: request-changes
---

# Review Outcome — task-1335 (attempt 4, focus: all)

**Outcome: request-changes** (single minor documentation fix; all functional criteria pass)

## Mission
Harden the parallix self-hosting publish path so broken trees cannot reach standalone `main`:
restore the green baseline, bind a repo-owned exact-tree verification proof to every publish path,
and fail closed on missing/stale/borrowed/failing proof.

## Decision summary
This attempt resolves both attempt-3 blockers and meets every mission success criterion with
passing test evidence:

- `px review --verify` passes deterministically; `npm test` is green 6/6 runs.
- The flaky-gate race is fixed with a principled `strictlyLaterIso()` helper
  (`lib/review/review-loop.js:9-15`, applied at `:303`).
- SC #5 now has a real failing-gate regression test
  (`test/forgejo.test.js:156` — broken tree → no PR, no `git push` to `main`).
- The prior fabricated CP-5 citation is replaced by that real test name; all three CP-5-cited
  tests were verified to exist.
- Exact-tree proof is implemented and fails closed on all three enumerated publish paths.

The only remaining issue is one inaccurate evidence cell in `CP-1.md:34` (it understates the
changed-file set, omitting `lib/review/review-loop.js` and `lib/review/review-commands.js`). The
review contract directs request-changes when findings exist even if criteria pass; this is that
case. It is a documentation-only correction — once fixed, this is an approve.

## Evidence
- Gate determinism: full suite 6/6 green; `test/task-1221-stale-blocked-relaunch.test.js` 0/10
  isolated failures (was 5/10 in attempt 3).
- Race fix: `lib/review/review-loop.js:9-15`, `:303`.
- SC #5 test: `test/forgejo.test.js:156` (asserts `result.ok===false`, 0 API calls, no push).
- SC #6 tests: `test/forgejo.test.js:102`, `test/integrate.test.js:1060`.
- Disposition coverage (SC #2): `test/review.test.js` 116/116, covering PUSHBACK_ALL, BLOCKED,
  PARKED, CHANGES_MADE.
- Proof core + fail-closed guards: `lib/core/verification.js:69-132`;
  `lib/commands/integrate.js:685-699`, `:1272-1295`; `lib/tools/forgejo.js:429-441`, `:739-753`.
- Finding: `missions/task-1335/CP-1.md:34` vs actual `git diff --name-only main..HEAD` (lib/).

## Success criteria assessment
| # | Criterion | Status |
|---|---|---|
| 1 | Enumerate all publish paths; distinguish px integrate | Met; minor file-list inaccuracy at CP-1:34 |
| 2 | `npm test` passes after disposition fix | Met (deterministic green) |
| 3 | Each publish path runs repo-owned exact-tree gate; aborts on non-zero | Met |
| 4 | Reject stale/borrowed proof | Met |
| 5 | Regression: broken (failing) tree blocked from `main` | Met (forgejo.test.js:156) |
| 6 | Regression: exact-tree binding | Met (forgejo.test.js:102, integrate.test.js:1060) |
| 7 | Notes: squash provenance loss + new audit boundary | Met (CP-5) |

## Required before approval
1. Correct the file-list claim in `missions/task-1335/CP-1.md:34` to include
   `lib/review/review-loop.js` and `lib/review/review-commands.js` (documentation only).

See `/tmp/task-1335-review-findings.md` for full detail.

---
`[workflow-round:4, workflow-phase:reviewing]`