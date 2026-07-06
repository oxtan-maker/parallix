---
id: TASK-1432
title: Bisect and fix test-suite speed regression over the last two weeks
status: done
assignee: [codex]
created_date: '2026-07-05 15:09'
updated_date: '2026-07-05 20:47'
labels:
  - bug
  - testing
  - performance
  - ai_sdlc
dependencies: []
priority: medium
---
## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`npm test` (the full suite, invoked as `./scripts/verify-local.sh all`, this repo's handoff/integration verification gate) has become dramatically slower than it used to be. A solo, uncontended run currently takes on the order of 10+ minutes; historically (per the reporting user, who has direct longitudinal experience with this repo) it has never been anywhere close to this slow. The user wants this bisected against the actual git history over roughly the last two weeks (since approximately 2026-06-21, current date is 2026-07-05) to find the specific commit(s) that introduced the regression, not just patched around symptoms.

Context already discovered and fixed in a separate session, so the bisection should look for ADDITIONAL contributors beyond these two (already on `main`, commits `56904105` and `1f228850` at time of writing):
- `scripts/verify-local.sh`'s `gate_all` had no cross-worktree coordination, so concurrent mission agents in separate worktrees each running `npm test` at once caused CPU-contention slowdowns severe enough to look like a hang. Fixed with a `flock` lock file in the shared `.git` dir.
- `test/e2e-mission-lifecycle.test.js` (added by mission/task-1413, commit `09a06affc`, merged 2026-07-04) ran a full `npm run build:cjs` (whole-project `tsc` recompile) inside its `runWorkflow()` helper, invoked 15+ times across the file's scenarios. Removed; that file alone went from ~68s to ~9s.

Despite both of those fixes, the reporting user's expectation is that a normal solo `npm test` run should be much faster than 10 minutes for a suite of this size, and that this is a real accumulating regression over the last ~2 weeks, not just environmental noise. This task should git-bisect (or otherwise systematically walk) the commit history of `test/`, `package.json` (test/pretest scripts), `scripts/verify-local.sh`, and any shared test bootstrap/helper files (e.g. `test/bootstrap-parallix-home.js`) over that window, timing a representative solo `npm test` run (or a targeted subset) at each candidate commit, to identify every commit that measurably added to total suite wall-clock time, distinguishing "suite grew because more tests were legitimately added" from "an individual test or shared helper got slower than it needs to be for what it's testing."

Acceptance criteria should require concrete before/after timing evidence (e.g., `time npm test` or per-file timing) at the specific commits identified, not just a plausible narrative.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A git-bisect (or equivalent systematic commit-by-commit walk) is performed over test-affecting commits from approximately 2026-06-21 to 2026-07-05, with timing measurements recorded at each candidate commit
- [ ] #2 Every commit found to measurably increase npm test wall-clock time beyond what is explained by legitimately added test coverage is identified by SHA, with a before/after timing comparison as evidence
- [ ] #3 Each identified regression is fixed (or, if intentionally trading correctness coverage for speed is not viable, documented with a concrete reason why it cannot be fixed), without removing legitimate test coverage
- [ ] #4 A solo, uncontended `npm test` run completes in a documented, measured duration after the fixes, with the before-and-after total suite time reported as evidence
- [ ] #5 The fixes already applied on main (flock serialization in scripts/verify-local.sh, and removal of the per-call npm run build:cjs from test/e2e-mission-lifecycle.test.js) are not re-done or reverted, and the investigation explicitly rules them out before looking for other causes
- [ ] #6 No test coverage is deleted or weakened to make the suite faster; any test found to be redundant or misplaced must be explicitly justified as such (e.g. duplicate coverage of the same code path) rather than just removed for speed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Concrete data point from 2026-07-05, system idle (load ~2.8/16 cores, zero contention): running each of the 130 test files individually (fresh `node --test <file>` process per file) sums to only ~59 seconds total (see full per-file timing; slowest individually are e2e-mission-lifecycle.test.js at 8.8s and task-1413-stale-build.test.js at 7.1s, everything else well under 5s). But running the exact same 130 files together via `npm test` (which loads them all into ONE shared process via test/run-default-tests.js's `require()` loop) took 20-30+ minutes on the same idle system with zero contention -- confirmed via a live handoff run (task-1431) with no other processes running. This is roughly a 20-30x slowdown specific to combining files into one process, not explained by the tests' actual computational cost. Strongly suggests something accumulates across the single shared process -- a leaked setInterval/setTimeout that never gets cleared and keeps firing/growing per file loaded, a growing number of active listeners, unbounded mock/state buildup across files (e.g. something not calling mock.restoreAll() or an equivalent reset), or GC pressure from retained references. The bisect should specifically look for this compounding-per-file-count behavior (e.g. time how long it takes to run the first 10 files vs the last 10 files within a single combined `node --test test/run-default-tests.js` process -- if later files take much longer than earlier ones despite being similarly sized, that confirms a compounding leak rather than a single slow commit) rather than only looking at total suite wall-clock time.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
