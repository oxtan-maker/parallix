# CP-3: Updated attemptAgentRelaunch to accept promptOverride for gatekeeper pushback

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| attemptAgentRelaunch accepts `promptOverride` option | lib/commands/active.ts:320: `promptOverride` destructured from options | PASS |
| promptOverride bypasses relaunchability check | lib/commands/active.ts:325: `if (promptOverride && !isRelaunchableErrorFn(errorMsg))` skips the non-relaunchable error return | PASS |
| promptOverride is used as the relaunch prompt | lib/commands/active.ts:341: `const prompt = promptOverride || buildRelaunchPromptFn(...)` | PASS |
| handoff.ts passes `promptOverride: relaunchPrompt` to attemptAgentRelaunchFn | lib/commands/handoff.ts:390: `{ log, error, promptOverride: relaunchPrompt }` | PASS |
| All 85 handoff+gatekeeper tests pass without regression | node --test test/handoff.test.js test/gatekeeper.test.js: 85 tests pass (67 + 18) (2026-07-04) | PASS |
| Static analysis gate passes | ./scripts/verify-local.sh static-analysis: ALL STAGES PASSED (2026-07-04) | PASS |
| Retry budget is fully consumed when relaunch succeeds but pushback persists | test/handoff.test.js:1311: assert.strictEqual(relaunchCallCount, 2) passes | PASS |

Next action: All mission success criteria met.
