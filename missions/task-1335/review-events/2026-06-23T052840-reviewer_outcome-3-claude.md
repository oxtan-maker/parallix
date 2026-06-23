---
event_type: reviewer_outcome
timestamp: 2026-06-23T05:28:40.287Z
round: 3
phase: reviewing
actor: claude
slug: task-1335
verdict: request-changes
---

# Review Outcome — task-1335 (attempt 3, focus: all)

**Outcome: request-changes**

## Mission
Harden the parallix self-hosting publish path so broken trees cannot reach standalone `main`:
restore the green baseline, bind a repo-owned exact-tree verification proof to every publish
path, and fail closed on missing/stale/borrowed/failing proof.

## Decision summary
This attempt is substantially closer than attempt 2: the branch is rebased onto current `main`,
the three earlier test regressions are fixed, and the exact-tree proof is implemented and wired
into both publish paths with correct fail-closed behavior. However two issues block approval:

1. The `npm test` gate is **non-deterministic** on this branch (~40% of full-suite runs red;
   `px review --verify` failed once and passed once this session). A mission whose purpose is a
   reliable fail-closed verification gate cannot ship while that gate is flaky.
2. The mission's central criterion (SC #5: a *broken/failing* tree is blocked from `main`) has
   **no regression test**, and CP-5 cites a test name for it that does not exist in the repo.

## Evidence
- Flake: `test/task-1221-stale-blocked-relaunch.test.js` SC1-Fix fails 5/10 isolated on branch,
  0/10 on `main`; full suite red 2/5 on branch. Root cause:
  `lib/review/review-loop.js:940` post-relaunch `sinceIso` collides with `state.startedAt` in the
  same millisecond; test asserts strict `>` at `test/task-1221-stale-blocked-relaunch.test.js:470-473`.
  The test file is unchanged by the branch (`git diff main..HEAD` touches no task-1221 file).
- SC #5 gap: no test drives `captureVerifiedTreeProof` to `ok:false` via a failing gate
  (the broken-tree path at `lib/commands/integrate.js:686-690` and the `forgejo.js`
  `verification-failed` branch). Existing proof tests cover only SC #6 (mismatched/stale proof):
  `test/forgejo.test.js:102`, `test/integrate.test.js:1060`. `test/verification.test.js` does not
  test the proof functions at all.
- Fabricated evidence: `missions/task-1335/CP-5.md:40` cites
  `standalone createPr syncPrimaryBaseline refuses to publish when the configured verification
  gate fails`; `grep -rn` across the repo returns no such test.
- Implemented correctly: `lib/core/verification.js:69-132`; guards
  `lib/commands/integrate.js:685-699`, `:1272-1295`; `lib/tools/forgejo.js:429-441`, `:739-753`.

## Success criteria assessment
| # | Criterion | Status |
|---|---|---|
| 1 | Enumerate all publish paths; distinguish px integrate | Met (CP-1, code) |
| 2 | `npm test` passes after disposition regression fix | **Not met — gate is flaky/non-deterministic** |
| 3 | Each publish path runs repo-owned exact-tree gate; aborts on non-zero | Met in code |
| 4 | Reject stale/borrowed proof | Met in code + tests |
| 5 | Regression test: broken (failing) tree blocked from `main` | **Not met — no test; CP-5 cites a nonexistent test** |
| 6 | Regression test: exact-tree binding (proof not reusable across trees) | Met (forgejo.test.js:102, integrate.test.js:1060) |
| 7 | Notes: squash provenance loss + new audit boundary | Met (CP-5) |

## Required before approval
1. Eliminate the `task-1221 SC1-Fix` same-millisecond race so `npm test` is deterministic;
   verify with repeated full-suite runs.
2. Add a real SC #5 regression test (failing verification gate → publish aborts, `main` not
   updated) and fix the fabricated test citation at `CP-5.md:40`.

See `/tmp/task-1335-review-findings.md` for full detail.

---
`[workflow-round:3, workflow-phase:reviewing]`