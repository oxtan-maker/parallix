# CP 1 — Confirm the launcher contract

`rebaseBeforeReviewRound` selects `tsx` for a source checkout and selects the compiled `px.js` relative to its loaded runtime module for a packaged installation. `test/run-default-tests.js` builds `.test-runtime/` and preloads `test/source-runtime-alias.js`, which explains the observed alias path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Established launcher architecture is preserved | `src/platform/runtime/lib/review/rebase.ts:169`, `test/task-1107-repro.test.ts` | PASS |
| Alias is identified as test infrastructure | `scripts/build-test-runtime.js`, `test/source-runtime-alias.js` | PASS |

Next action: Assert the entrypoint relative to the loaded review module instead of this checkout.
