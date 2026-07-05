# CP-5: Verification Gate Results

## Work Done

Ran `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` on the final tree.

### verify-local.sh all Results

- **Tests**: 2018 total, 1996 pass, 0 fail, 22 skipped
- **All existing stats tests pass** (67 tests in `test/stats.test.js`)
- **No regressions** in mission-count tables, agent-performance tables, or any other existing functionality

### verify-local.sh static-analysis Results

- **ESLint**: PASS — clean
- **TypeScript typecheck**: PASS — clean
- **Test hygiene**: PASS — no `.only` or bare `.skip` violations

### Gate Status

| Gate | Result |
|---|---|
| `./scripts/verify-local.sh all` | PASS |
| `./scripts/verify-local.sh static-analysis` | PASS |

Both gates were already marked as passed in the MISSION.md Gates section (lines 74-75).

## Goal Check

| Success Criterion | Evidence (file:line / test-name) | Status |
|---|---|---|
| SC-1: New current-week agent spend table with columns draft, execute, review, follow-up, default, total | `lib/commands/stats.ts:1147-1157` rendered in `renderWeeklyStatsReport()`; test `test/stats.test.js:490` — `task-1414: renderWeeklyStatsReport adds an agent spend-by-stage table with the contracted columns` | PASS |
| SC-2: Rows use same display keys and ordering as "Agent performance this week"; model-grouped row appears under model name | `lib/commands/stats.ts:972-1003` `summarizeAgentStageSpend()` uses `computeAgentMissionGroups()` same as `summarizeAgentWindow()`; test `test/stats.test.js:541` — `task-1414: renderWeeklyStatsReport spend table groups a local model row by model name, matching Agent performance this week` | PASS |
| SC-3: Codex/OpenAI row shows per-stage usage from `openai_usage_after`; execute fed by stored stage `active` | `lib/commands/stats.ts:996` `family === 'usage'` reads `openai_usage_after`; `lib/commands/stats.ts:932` `{ stage: 'active', label: 'execute' }`; test `test/stats.test.js:500` — `task-1414: renderWeeklyStatsReport aggregates a Codex row from openai_usage_after with stage active shown as execute` | PASS |
| SC-4: Claude row shows dollar values from `cost_usd`, not tokens/duration/usage | `lib/commands/stats.ts:997` `family === 'cost'` reads `cost_usd`; test `test/stats.test.js:515` — `task-1414: renderWeeklyStatsReport aggregates a Claude row from cost_usd, not tokens/duration/usage` | PASS |
| SC-5: Custom/local row shows duration from `duration_minutes`, not cost or usage | `lib/commands/stats.ts:998` default branch reads `duration_minutes`; test `test/stats.test.js:528` — `task-1414: renderWeeklyStatsReport aggregates a Custom/local row from duration_minutes, not cost or usage` | PASS |
| SC-6: Rows with no non-zero spend render stable empty-state `—` | `lib/commands/stats.ts:1017` `if (!total) {return '—';}`; test `test/stats.test.js:555` — `task-1414: renderWeeklyStatsReport spend table renders a stable empty state instead of misleading 0% for a row with no spend` | PASS |
| SC-7: Existing assertions in `test/stats.test.js` still pass | All 67 pre-existing stats tests pass; no test coverage reduced | PASS |
| SC-8: `./scripts/verify-local.sh all` passes; `static-analysis` listed as required gate | `./scripts/verify-local.sh all` — 1996 pass/0 fail/22 skipped; `./scripts/verify-local.sh static-analysis` — ESLint/typecheck/hygiene all clean | PASS |

## Round 5 Review Fix

Reviewer (codex, round 5) found that `test/task-1413-stale-build.test.js` — touched earlier in this branch by `ed7fbc6b` to make the "fresh generated JS" test avoid shared `PARALLIX_HOME` state — still had `ensureStatsCsv()` unconditionally doing `path.join(process.env.PARALLIX_HOME, 'stats.csv')`, so both tests in that file threw `TypeError [ERR_INVALID_ARG_TYPE]` when run outside the `npm test` bootstrap wrapper that sets `PARALLIX_HOME`.

Fix: `ensureStatsCsv()` in `test/task-1413-stale-build.test.js:46-54` now falls back to `path.join(os.homedir(), '.local', 'state', 'parallix')` when `PARALLIX_HOME` is unset, and creates that directory with `fs.mkdirSync(home, { recursive: true })` before writing the CSV fixture — restoring the hermeticity the file had before `ensureStatsCsv()` was introduced.

Verification:
- `node --test test/stats.test.js test/task-1413-stale-build.test.js` run directly with `PARALLIX_HOME` unset — 69/69 pass (the reviewer's exact repro command).
- `./scripts/verify-local.sh static-analysis` — PASS (ESLint, typecheck, test-hygiene all clean).
- `npm test` (full suite via bootstrap) — 2030 total, 2008 pass, 0 fail, 22 skipped.
- Note: an earlier full-suite run showed one flaky failure in `stale generated JS triggers preflight rejection...` caused by unrelated test files (`test/refresh-global-px-script.test.js`, `test/e2e-mission-lifecycle.test.js`, etc.) concurrently running `npm run build:cjs` and racing the deliberately-staled `stats.js` mtime; this is a pre-existing cross-file build race, not a regression from this fix — confirmed by re-running the full suite immediately after with 0 failures, and by running the touched file in isolation deterministically twice with 0 failures.

## Round 6 Review Response (Pushback)

Reviewer (codex, round 6) reported `./scripts/verify-local.sh all` exiting `1` with eight `test/px-runner.test.js` failures (lines 85, 101, 118, 128, 157, 184, 210, 225), all with `Error [ERR_NO_TYPESCRIPT]: Node.js is not compiled with TypeScript support` when spawning `px` via `node --experimental-strip-types px.ts ...`.

Investigation:
- `git diff main...HEAD --stat -- test/px-runner.test.js px.ts px.js` returns empty — neither the test file nor `px.ts`/`px.js` is touched anywhere in this branch's diff. This mission's scope is `lib/commands/stats.ts` and `test/stats.test.js`; `px-runner.test.js` exercises unrelated CLI plumbing.
- `ERR_NO_TYPESCRIPT` is thrown by Node when the running binary was built without native TypeScript type-stripping support (a Node-build/environment property), not something this repo's code controls. `node --experimental-strip-types --help` in this environment confirms the flag is supported here (`node -v` → v24.15.0).
- Ran `./scripts/verify-local.sh all` three consecutive times after the round-5 fix, plus `node --test test/px-runner.test.js` in isolation: every run is **2030 total, 2008 pass, 0 fail, 22 skipped**, including all 8 `px-runner` tests cited by the reviewer. Zero reproductions of `ERR_NO_TYPESCRIPT` in this environment across 3 full-suite runs.
- Conclusion: the round-6 finding reflects an environment difference in the reviewer's sandbox (a Node runtime without TypeScript type-stripping compiled in), not a defect introduced by this mission's diff. Pushing back on this finding as out-of-scope/non-reproducible; SC-8 evidence in this checkpoint reflects 3 independent clean runs of `./scripts/verify-local.sh all` on the exact final tree.
- The reviewer's low-severity `graphify` tooling note (command not found in their sandbox) is also an environment/tooling gap outside this mission's code changes; not actionable from `lib/commands/stats.ts`.

## Next action: Verify all mission-declared gates pass and prepare for handoff
