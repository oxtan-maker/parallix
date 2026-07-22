# CP 2 — Correct the regression assertion

The packaged-runtime test now derives `px.js` from `require.resolve('../dist/lib/review/review')` and checks the complete Node invocation. This preserves the original argument contract while accepting the intentional `.test-runtime` alias.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Packaged path is derived from the loaded runtime | `test/task-1107-repro.test.ts` | PASS |
| Rebase command, slug, and push flag remain exact | `"rebaseBeforeReviewRound uses the compiled CLI outside a source checkout"` | PASS |
| No production launcher behavior changed | `src/platform/runtime/lib/review/rebase.ts` | PASS |

Next action: Run focused coverage through both direct and default test runners.
