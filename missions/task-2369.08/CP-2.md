## CP-2: Extract helpers, wire imports/re-exports, add unit coverage

### Summary

Extracted eight static-review evidence helpers from `review-commands.ts` into `src/adapters/review/review-static-evidence.ts`. Re-exported 3 public helpers (`formatStaticReviewFindings`, `formatStaticReviewSuccess`, `performStaticReview`) from `review-commands.ts` for backward compatibility. Removed unused imports (`findCheckpoints`, `missionBaseDir`, `getPrimaryBranch`) from `review-commands.ts`. Added new file to persistence inventory exclusions. Created focused unit test suite `test/review-static-evidence.test.ts` with 11 tests covering formatting, valid evidence paths, and invalid evidence paths.

**Line count:** `review-commands.ts` 1631 → 1332 lines (-299). `review-static-evidence.ts` 338 lines.

### Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `review-static-evidence.ts` defines all eight named helpers | `src/adapters/review/review-static-evidence.ts` — `collectGoalCheckEvidenceRows`, `collectRepoTestNames`, `canonicalSourceContainsFile`, `evidenceCellHasVerifiableReference`, `findUnverifiableGoalCheckRow`, `performStaticReview`, `formatStaticReviewFindings`, `formatStaticReviewSuccess` | PASS |
| `review-commands.ts` no longer contains eight helper implementations | `src/adapters/review/review-commands.ts` — re-export line: `export { formatStaticReviewFindings, formatStaticReviewSuccess, performStaticReview } from './review-static-evidence.js';` | PASS |
| `review-commands.ts` continues to export every extracted helper exported before | `review-workflow-adapter.ts` imports `formatStaticReviewSuccess`, `performStaticReview` from `review-commands.js` — no change needed | PASS |
| Valid evidence paths return pass | `test/review-static-evidence.test.ts` — "performStaticReview accepts Goal Check with recognized repo command", "performStaticReview accepts Goal Check with recognized test name", "performStaticReview accepts Goal Check with test file path" | PASS |
| Invalid evidence paths return failure | `test/review-static-evidence.test.ts` — "performStaticReview rejects placeholder-only evidence", "performStaticReview rejects separator-only table", "performStaticReview rejects prose-only evidence" | PASS |

### Next action:
Run static-analysis and general verification gates, confirm line-count reduction, and write CP-3 with goal-check evidence for every success criterion.
