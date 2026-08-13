## CP-1: Map exports, callers, dependencies, and baseline

### Summary

Mapped the eight named helpers in `review-commands.ts`, identified their callers, dependencies, and test coverage. Recorded baseline line count and compatibility contract.

**Baseline:** `review-commands.ts` = 1631 lines.

**Exported helpers (need re-export after extraction):**
- `formatStaticReviewFindings` — called by `review-workflow-adapter.ts`, `review-commands.test.ts`, `review-commands-supplemental.test.ts`
- `formatStaticReviewSuccess` — called by `review-workflow-adapter.ts`, `review-commands.test.ts`, `review-commands-supplemental.test.ts`
- `performStaticReview` — called by `review-workflow-adapter.ts`, `review-commands.test.ts`, `review-commands-supplemental.test.ts`

**Private helpers (internal to review-commands.ts, no external callers):**
- `collectGoalCheckEvidenceRows`
- `collectRepoTestNames`
- `canonicalSourceContainsFile`
- `evidenceCellHasVerifiableReference`
- `findUnverifiableGoalCheckRow`

**Dependency chain:** `performStaticReview` → `collectGoalCheckEvidenceRows` → `findUnverifiableGoalCheckRow` → `collectRepoTestNames` + `evidenceCellHasVerifiableReference` → `canonicalSourceContainsFile`

**Imports needed in new module:** `fs`, `path`, `fmt` (cli-format), `run` (git), `findMissionDir`, `findCheckpoints`, `resolveWorktree`, `missionBaseDir`, `getPrimaryBranch` (mission-utils)

**Test coverage:** `review-commands.test.ts` covers `formatStaticReviewFindings` (3 tests), `formatStaticReviewSuccess` (1 test), `performStaticReview` (7 tests including placeholder rejection, shell command acceptance, separator rejection, test name recognition, and real checkpoint acceptance). `review-commands-supplemental.test.ts` covers formatting functions.

### Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Baseline line count recorded | `review-commands.ts` = 1631 lines (pre-extraction `wc -l`) | DONE |
| Eight helpers identified with callers | `review-workflow-adapter.ts` imports 3 exported; 5 private have no external callers (grep `src/` + `test/`) | DONE |
| Compatibility contract recorded | 3 exported helpers re-exported from `review-commands.ts`; 5 private remain internal | DONE |

### Next action:
Extract eight helpers into `review-static-evidence.ts`, wire imports/re-exports, and add focused unit tests for evidence validation paths.
