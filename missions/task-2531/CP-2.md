# CP-2: Implement shared detection in both enforcement points

## Summary
Implemented the single shared `onGitHubActions()` detection and wired it into both enforcement points.

1. `test/lib/unit-test-budget-reporter.ts` — added `export function onGitHubActions(): boolean { return process.env.GITHUB_ACTIONS === 'true'; }` (exact-value keying; not any GitHub-ish string, task-2531 risk). In `measure()`, budget/headroom accounting is wrapped in `if (!onGitHubActions()) { ... }`, so neither `[unit-test-budget:exceeded]` nor `[unit-test-budget:headroom]` is emitted on GitHub-hosted runners.
2. `test/run-default-tests.ts` — imported `onGitHubActions` from the reporter and changed the suite-level budget block from `if (!runsIntegrationSuite)` to `if (!runsIntegrationSuite && !onGitHubActions())`, so `suiteExceeded` stays false and `[unit-test-budget] SUITE BUDGET EXCEEDED` never fires on GitHub.

### Reviewer F1 fix (round 1, REQUEST_CHANGES)
The initial CP-2 used `if (onGitHubActions()) { return; }` inside `measure()`. Because `measure()` is piped into node:test's `spec()` reporter, an early `return` terminated the generator on the first qualifying pass event and dropped every subsequent event, silencing all node:test output on GitHub Actions — a regression beyond the mission's goal of disabling the *budget* only. Replaced the early return with the `if (!onGitHubActions())` guard above so every event is still forwarded. `test/unit-test-budget-reporter.test.ts` now asserts non-empty forwarded output (last event present) on GitHub Actions in addition to budget silence.

Both points read the same single definition of "on GitHub Actions". Local (non-GitHub) behavior is unchanged: the reporter still enforces the 1000 ms per-test / 500 ms headroom budget and the runner still fails the suite over 180 s.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 1. GitHub disables reporter budget + headroom | `test/unit-test-budget-reporter.test.ts` "unit-test budget reporter stays silent on GitHub Actions runners", `` `npm test -- test/unit-test-budget-reporter.test.ts` `` → pass 5 | PASS |
| 2. Runner suite budget gated on shared detection | `test/run-default-tests.ts` `if (!runsIntegrationSuite && !onGitHubActions())`, `test/unit-test-budget-reporter.test.ts` "the suite-level budget check is gated on the shared GitHub Actions detection" | PASS |
| 3. Local (non-GitHub) enforcement unchanged | `test/unit-test-timeout-guard.test.ts` "unit-test timeout guard: suite budget enforcement fails when exceeded" + "default plan keeps 1000ms while headroom mode is opt-in" | PASS |
| 4. Detection defined once, imported by both | `test/lib/unit-test-budget-reporter.ts` (single `onGitHubActions` export), `test/run-default-tests.ts` single import | PASS |
| 5. Unit test asserts criteria 1–3 | `test/unit-test-budget-reporter.test.ts` (5 tests) | PASS |
| Reporter + timeout-guard suites green | `` `node --import tsx test/unit-test-budget-reporter.test.ts` `` pass 5/5; `` `node --import tsx test/unit-test-timeout-guard.test.ts` `` pass 6/6 | PASS |
| F1: reporter forwards all events on GitHub (no output silence) | `test/unit-test-budget-reporter.test.ts` "stays silent on GitHub Actions runners" asserts non-empty forwarded output | PASS |

## Next action
Commit CP-2, the F1 reporter fix, and the task-2530 frontmatter fix. Run `./scripts/verify-local.sh all` (unit + docs). All 2652 unit tests pass, docs gate passes, static-analysis passes. Send to reviewer for round 1 re-decision.
