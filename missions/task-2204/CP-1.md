Summary of work done

Added the standalone regression test for task-2204 and ran it against the current implementation. The test is red because `px integrate` still takes the merged-PR fast path instead of failing preflight.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Deterministic reproduction test exists for merged-PR fast path removal | `test/task-2204-integrate-no-variant-a.test.js:127`, `"integrate rejects merged Forgejo PRs during preflight with recovery guidance"` | PASS |
| Current implementation still routes merged PRs into Variant A | `lib/commands/integrate.ts:649`, `lib/commands/integrate.ts:652` | PASS |
| Reproduction test fails before the fix, proving the regression is real | `node --test test/task-2204-integrate-no-variant-a.test.js` failed with `exitCodes` actual `[0]` vs expected `[1]` at `test/task-2204-integrate-no-variant-a.test.js:144` | PASS |

Next action: remove merged-PR acceptance from preflight and integration control flow, then convert the existing Variant A tests to the new failure path.
