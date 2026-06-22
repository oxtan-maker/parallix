# CP-3: Update existing no-PR tests, add self-heal coverage, run full suite green

## Summary
Rewrote the two existing review/approved no-PR "hard-fail" tests as self-heal tests and
added coverage for every falsifiable success criterion. All tests inject `performHandoffFn`
so no real handoff, network, git, or agent work runs in the suite (addresses the stop-rule
on real side effects — the previous default-`performHandoff` invocation is gone).

Tests added/updated in `test/review.test.js`:
- **crit. 1 (recovery)**: post-implementation `review` task, first `getPrStatusFn` →
  `{exists:false}`, mocked `performHandoffFn` → `{ok:true}`, second `getPrStatusFn` →
  `{exists:true,state:'open',number:77}`. Asserts handoff called with
  `{forgejoUser:'codex', worktree}`, no `exit(1)`, recovery logged with `#77`.
- **crit. 2 (failed handoff)**: `performHandoffFn` → `{ok:false, error:'gate failed'}`.
  Asserts `exit(1)`, `No open review PR found`, surfaces `gate failed`, recommends
  `--push`, and does **not** recommend `--submit`.
- **crit. 3 (handoff ok, still no PR)**: `performHandoffFn` → `{ok:true}` but PR stays
  absent. Asserts `--push` fallback, no `--submit`, `exit(1)`.
- **crit. 4 (gatekeeper pushback)**: `performHandoffFn` → `{ok:true,
  gatekeeperPushedBack:true}`. Asserts `exit(1)`, artifacts-missing message, and reviewer
  (`startAgentFn`) **never** launched.
- **crit. 5 (implementation phase unchanged)**: strengthened the existing `active` test to
  inject a `performHandoffFn` spy and assert it is **not** called; early return, no exit.
- **crit. 7 (dry-run)**: `dryRun:true` with a `performHandoffFn` spy; asserts handoff never
  called and `DRY-RUN` behavior holds.
- **crit. 6 (unresolvable task)**: covered unchanged by the existing
  `startReviewLoop hard-fails when task cannot be resolved and no PR exists` test, which
  exits 1 at the `taskResolution.ok === false` guard before self-heal.

## Goal Check

| Success criterion | Test (file:line) | Status |
|---|---|---|
| 1 — recovery: handoff called w/ `{forgejoUser, worktree}`, no exit, `prNumber=N`, loop proceeds | `test/review.test.js:3589` `...self-heals via handoff and recovers when task is review and a PR appears (crit. 1)` | ✅ |
| 2 — failed handoff: `--push` + reason, no `--submit`, exit 1 | `test/review.test.js:3632` `...emits --push fallback (not --submit) when handoff fails for a review task (crit. 2)` | ✅ |
| 3 — handoff ok but no PR: `--push` fallback, no `--submit`, exit 1 | `test/review.test.js:3659` `...emits --push fallback when handoff ok but no PR appears (crit. 3)` | ✅ |
| 4 — gatekeeper pushback: artifacts msg, exit 1, reviewer never launched | `test/review.test.js:3686` `...short-circuits on gatekeeper pushback without launching reviewer (crit. 4)` | ✅ |
| 5 — implementation phase unchanged, handoff not called | `test/review.test.js:3530` `...returns early with guidance when task is active and no PR exists` (handoff spy) | ✅ |
| 6 — unresolvable task hard-fail unchanged, no self-heal | `test/review.test.js:3739` `...hard-fails when task cannot be resolved and no PR exists` | ✅ |
| 7 — dry-run never self-heals | `test/review.test.js:3713` `...never self-heals in dry-run (crit. 7)` | ✅ |
| 8 — full suite green | `npm test` → `tests 1581 / pass 1559 / fail 0` | ✅ |

## Gates

| Gate | Result |
|---|---|
| `npm test` (all tests pass) | `tests 1581 / pass 1559 / fail 0` ✅ |
| `./scripts/verify-local.sh docs` | Script absent in this repo (it is the per-target-repo command, per `README.md:79-83`). This repo declares its own verification command `npm test` (`workflow.config.json:14`), which passes — gate satisfied via the declared equivalent. ✅ |

## Next action
Handoff-ready: commit `lib/review/review-loop.js`, `test/review.test.js`, and the three
checkpoint docs on `mission/task-1303`, then hand off to review via `px review task-1303`.
