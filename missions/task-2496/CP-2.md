# CP-2: Suppress the premature FAIL at draft start without weakening the post-process gate

## Work done
Scoped the fix to the scaffold call site in `src/adapters/cli/commands/draft-stats.ts`.
The scaffold step now passes a filtered `errorFn` (`suppressDraftStartClassificationFail`)
to `validateDraftClassification` that swallows only messages matching
`/Missing or invalid classification/i`. Any other `errorFn` output (e.g. an
invalid-classification throw that returns `ok:false`, which still `safeExit`s) surfaces
unchanged. The shared `validateDraftClassification` helper contract is untouched, so the
direct unit tests in `test/draft.test.ts` keep passing, and the `postProcess`
`normalizeDraftClassification` fail-closed gate (`ADR 0048`) is unchanged.

Added a red-to-green regression test in `test/draft.test.ts`:
`"runDraftCommand scaffold does not emit a classification FAIL for an unset label"`.
It writes a task file with an empty `labels: []` array into the conventional worktree so
the real `resolveMissionClassification` resolver returns the genuine
`Missing or invalid classification` error at the scaffold call site, then asserts the
injected `errorFn` receives no `/\[FAIL\].*Missing or invalid classification/i` line.
Verified red without the fix and green with the fix.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Scaffold no longer emits classification FAIL for unset label (criterion 1) | test `"runDraftCommand scaffold does not emit a classification FAIL for an unset label"`, `test/draft.test.ts` | PASS |
| Scaffold still returns `ok:true, classification:null` — draft not blocked (criterion 2) | `test/draft.test.ts` regression test reaches scaffold completion without `exitFn` | PASS |
| `normalizeDraftClassification` still fail-closed (criterion 3) | `test/draft.test.ts` `"draft classification helpers fall back to stats when an injected resolver is invalid"`; `ADR 0048` | PASS |
| Red-to-green reproduction (DOD #6) | test fails on pre-fix `draft-stats.ts`, passes after fix (verified via `git stash`) | PASS |
| No focused/unannotated-skipped tests introduced (DOD #3) | `test/draft.test.ts` — new test uses plain `test(`, no `.only`/`.skip` | PASS |

Next action: CP-3 — run `./scripts/verify-local.sh all`, confirm docs need no change, produce Goal Check.
