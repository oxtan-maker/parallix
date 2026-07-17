# CP-3: Final timing and gate verification

This checkpoint closes the split of the default suite. `runtime-matrix.test.js`, `task-1416-repro.test.js`, and `opencode-export.test.js` remain in the explicit integration bucket; the latter deliberately launches real Node children to exercise pipe-buffer behavior. `spawn-tee.test.js` uses sub-second mocked watchdog waits. Review remediation added behavior-level routing coverage for every moved root test group rather than checking runner source text.

On 2026-07-17, an otherwise idle local machine (Node v22.23.1; no credentials or live services supplied) completed the exact command `npm test`. The run passed 882 tests. `/usr/bin/time -p npm test` recorded 96.87 seconds wall-clock time (64.97 user, 17.83 sys); the Node test runner reported 61,379.747759 ms after the build pretest. The per-test output captured by that command is reconciled in the inventory below. This completed capture supersedes CP-1's stopped exploratory capture as the reproducible timing baseline.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A checkpoint records one uncontended `npm test` baseline with per-test durations, total duration, test command, and the machine/load conditions used to make the one-second classification reproducible | `npm test`; `/usr/bin/time -p npm test` (96.87 s); 882 passing tests; timing inventory below | PASS |
| Every default-suite test measured above 1,000 ms appears in a classification inventory containing its exact test name, test-file path, observed duration, external dependencies, and disposition | `missions/task-2275/CP-3.md` inventory (24 rows) | PASS |
| On the final tree, every default-suite test that executes a real command-line tool, Git repository/worktree operation, package build/install/archive operation, network service, or agent binary is excluded from `npm test` and is included in a clearly named integration or E2E command | `test/run-default-tests.js:42-82`; `npm run test:integration` | PASS |
| Each moved test group has regression coverage that proves both its exclusion from `test/run-default-tests.js` default selection and its inclusion in the designated integration/E2E invocation | `test/default-test-suite.test.js:6-92`, `"default test runner routes every moved group to integration and excludes it from default"` | PASS |
| Every retained default-suite test has no real process, repository/worktree, package manager, network, or agent-binary dependency; its behavior remains covered through injected dependencies, fakes, fixtures, or in-process APIs | inventory dispositions below; `test/sync-merged-retry.test.js:4-65`; `test/task-1039-integrate-v3.test.js:148-184` | PASS |
| The final checkpoint records a second uncontended `npm test` run with per-test and total timing, and identifies any remaining test above 1,000 ms with its accepted justification | `npm test`; `/usr/bin/time -p npm test`; inventory below | PASS |
| The final tree passes the declared general, static-analysis, and integration verification commands | `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis`; `WORKFLOW_AGENT=codex ./scripts/verify-local.sh integrate --real-agent codex --real-agent-model gpt-5.6-luna` | PASS |

## Inventory

All rows below are retained unit tests: their process/Git/Forgejo/agent seams are injected fakes, in-process callbacks, or disposable fixture files rather than real boundaries. Runtime-reduction follow-up owner for each retained row: `codex`.

| File | Over-1s default test | Observed duration | External dependencies and disposition |
|---|---|---:|---|
| `test/stats-task-1380-closed-filter.test.js` | `task-1380: recordIntegrationStats sets closed: yes` | 2408.861648 ms | Fixture-only stats aggregation; retained unit. |
| `test/stats.test.js` | `recordIntegrationStats reads backlog classification and review-state final implementer/fix rounds` | 3401.016681 ms | Local CSV/fixture data and injected helpers; retained unit. |
| `test/sync-merged-retry.test.js` | `syncMerged retries push on stale info rejection with strong assertions` | 5327.853472 ms | Git push/fetch/API fakes; retained unit. |
| `test/task-1039-integrate-v3.test.js` | `printIntegrationPreflight branch failure`; `printIntegrationPreflight mission-doc failure`; `printIntegrationPreflight task failures`; `printIntegrationPreflight PR approval failures`; `printIntegrationPreflight main-dirty warning` | 5223.193626 ms max | Injected token/conflict/resolution fakes; retained unit. |
| `test/task-1039-integrate.test.js` | `integrate preflight failure stops execution` | 5189.544965 ms | Mocked Git/Forgejo/stats command path; retained unit. |
| `test/task-1079-review-blocked-fallback.test.js` | `startReviewLoop falls back when the auto-derived reviewer is blocked but a different-family agent is available` | 8609.283044 ms | Fully injected review-loop selection; retained unit. |
| `test/task-1104-call-order.test.js` | `startReviewLoop follows the transition contract: review before reviewer, active before implementer` | 5449.064861 ms | Mocked event callbacks; retained unit. |
| `test/task-1109.test.js` | `integrate full squash-merge (Variant B) success path` | 3086.671350 ms | Mocked Git/Forgejo/stats/process hooks; retained unit. |
| `test/task-1135-coverage.test.js` | `performStaticReview handles missing Goal Check section` | 5066.816731 ms | Pure string/fixture coverage; retained unit. |
| `test/task-1135-review-fallback.test.js` | `CP-1: blocked auto-derived reviewer falls back via selectAgent without mutating Backlog assignee` | 8044.217668 ms | Faked selection/status hooks; retained unit. |
| `test/task-1209-review-loop.test.js` | `startReviewLoop skips reviewer and implementer launches for autonomous fallback in provider=none mode` | 5093.687069 ms | Stubbed provider-none loop; retained unit. |
| `test/task-1219-fallback.test.js` | `printIntegrationPreflight logs INFO instead of FAIL for token + approval when local review-state is approved` | 4398.141992 ms | Injected local review-state; retained unit. |
| `test/task-1221-stale-blocked-relaunch.test.js` | `SC1: --continue skip-check BLOCKED re-launches implementer instead of skipping` | 4374.328428 ms | Mocked continue-mode behavior; retained unit. |
| `test/task-1268-pre-review-gate-per-round.test.js` | `startReviewLoop runs the pre-review gate before every reviewer round`; `startReviewLoop stops after a gate-failure bounce without launching a reviewer` | 11246.372647 ms max | Faked gate runner/reviewer polling/disposal; retained unit. |
| `test/task-1431-integration-preflight-repro.test.js` | `printIntegrationPreflight resolves classification from the mission base worktree, not process.cwd()`; `printIntegrationPreflight still hard-fails on an ambiguous slug rather than degrading to missing-task`; `printIntegrationPreflight still warns and falls back to unknown classification for a genuinely missing task` | 4783.113847 ms max | Temp-worktree fixtures plus injected helpers; retained unit. |
| `test/task-2200-classification-bug-label.test.js` | `missionStart resolves classification using the mission worktree cwd, not process.cwd()` | 6812.348844 ms | Injected classification resolver and filesystem-only fixture; retained unit. |
| `test/task-2204-integrate-no-variant-a.test.js` | `integrate rejects merged Forgejo PRs during preflight with recovery guidance` | 3404.573322 ms | Mocked merge/preflight behavior; retained unit. |

`runtime-matrix.test.js`, `task-1416-repro.test.js`, and `opencode-export.test.js` are excluded from this default inventory because `npm run test:integration` executes them. `spawn-tee.test.js` no longer exceeds 1,000 ms because its mocked watchdog waits are below one second.

Next action: hand off the finalized mission with the completed `npm test` capture and behavior-level routing regression recorded.
