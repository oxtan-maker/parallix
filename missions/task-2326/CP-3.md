# CP-3: Timing Guard, Parallelism, and Final Gate

## Summary

Configured enforceable unit-test timing guard with per-test timeout and suite-level budget. Added deterministic tests proving the guard fires when exceeded. Verified safe parallel execution through Node 24's default per-file concurrency. Ran the required repository gate.

### Changes

1. **Per-test timeout** — `test/run-default-tests.ts` passes `--test-timeout=30000` to `node --test` for the default (unit) suite. Integration suite (`--integration`) is exempt. This catches integration-style tests accidentally added to the unit suite (they time out at 30s).

2. **Suite-level budget enforcement** — `UNIT_TEST_BUDGET_MS=180000` (180s) defined in `test/run-default-tests.ts:234`, overridable via `PARALLIX_UNIT_TEST_BUDGET_MS` environment variable. The runner measures elapsed time with `process.hrtime.bigint()` around the `spawnSync` call (`test/run-default-tests.ts:258-259`) and fails the suite (exit 1 via `||` operator at `test/run-default-tests.ts:314`) when elapsed time exceeds the configured budget, even if all individual tests passed. The budget and elapsed time are printed to stderr on every run.

3. **SIGKILL orphan cleanup (manifest-based ownership)** — The runner creates a PID-scoped manifest file (`test/run-default-tests.ts:236`, `PARALLIX_TEST_MANIFEST`) and passes its path to the child process. The bootstrap writes `tempRoots` to the manifest on exit (`test/bootstrap-parallix-home.js:183-192`). After the suite completes, `cleanupOrphanedTempDirs()` at `test/run-default-tests.ts:267-283` reads the manifest and cleans only those roots — safely ignoring roots from concurrent test runs. Concurrent-run regression test added.

4. **Deterministic timeout tests** — `test/unit-test-timeout-guard.test.ts` (5 tests):
   - Verifies runner includes `--test-timeout=` and `UNIT_TEST_TIMEOUT_MS`
   - Verifies `UNIT_TEST_BUDGET_MS` and `PARALLIX_UNIT_TEST_BUDGET_MS` override
   - Proves `--test-timeout` terminates a test exceeding the bound (spawns `node --test-timeout=200` with a 5s sleep, confirms non-zero exit and "timed out" output)
   - Proves fast tests pass within the bound
   - Proves suite budget enforcement fails the runner when elapsed time exceeds `PARALLIX_UNIT_TEST_BUDGET_MS` (spawns runner with 500ms budget and a 2s test, confirms non-zero exit with "SUITE BUDGET EXCEEDED" message)

5. **SIGKILL regression test** — `test/task-2318-temp-directory-leaks.test.js` updated with "runner orphan cleanup reclaims SIGKILL temp directories" that uses the ownership-aware approach (record pre-existing roots, spawn child, SIGKILL child, clean only roots created during the run).

6. **tui-spawn relocation** — `tui-spawn.test.ts` moved from default suite to integration suite (round 2). It uses `execFileSync` (real process boundary). Removed from `artifactSpawnTestFiles` carve-out; added to `knownIntegrationTestFiles`. Bootstrap bypass for solo runs is preserved.

7. **Parallel execution** — Node 24's `node --test` runs files concurrently by default (one worker per CPU). Tests are safe for parallel execution because the bootstrap creates per-process isolated temp directories (`PARALLIX_HOME`, `HOME`, `FORGEJO_HOME`) and tests use mocks. No `--test-concurrency` override needed.

8. **Test registry update** — `test/default-test-suite.test.ts` updated with `tui-spawn.test.ts` in `expectedIntegrationFiles` and test updated to verify integration classification.

### Gate Results

- `./scripts/verify-local.sh all`: 1571 tests, 0 failures, 0 skipped (~121s)
- `bash scripts/test-hygiene.sh`: PASS (no `.only`, no unannotated `.skip`)
- `[unit-test-budget] timeout=30000ms per test, suite budget=180000ms` (visible on every run)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Each temporary-artifact class has a documented producer and cleanup owner, and implementation removes that class on normal and failure paths | Bootstrap SIGTERM+exit: `test/bootstrap-parallix-home.js:209-216`. SIGKILL gap: per-worker manifest directory — runner creates PID-scoped dir at `test/run-default-tests.ts:244-245`, each worker writes `<PID>.json` synchronously at `test/bootstrap-parallix-home.js:178-186` (survives SIGKILL), cleanup unions all files at `test/run-default-tests.ts:283-299`. Regression: `test/task-2318-temp-directory-leaks.test.js` "runner orphan cleanup reclaims SIGKILL temp directories", "runner orphan cleanup is safe with concurrent test runs", "parallel workers each write their own manifest file in shared directory". Command-level: `src/platform/runtime/lib/review/review-artifacts.ts:75,436-438`, `src/platform/runtime/lib/commands/integrate.ts:80,920,926`, `src/platform/runtime/lib/commands/mutation-gate.ts:305`, `src/platform/runtime/lib/commands/coverage-gate.ts:122-140` | Done |
| Review of unit tests from prior 7 days produces a recorded classification for every reviewed test; tests exceeding threshold, externally dependent, or non-hermetic are relocated | 6 tests in `knownIntegrationTestFiles` (`test/run-default-tests.ts:119-128`): `task-2285-pack-install-smoke.test.ts`, `task-2286-native-sea-smoke.test.ts`, `task-2312-label-sync.test.ts`, `task-2318-temp-directory-leaks.test.js`, `task-2319-notices-git-tracking.test.ts`, `tui-spawn.test.ts`. Full inventory (242 files, 213 unit + 29 integration) in CP-1.md. `npm test` exits 0; `npm run test:integration` exits 0 | Done |
| Unit-test command runs hermetic tests concurrently where tests do not share mutable state | `test/run-default-tests.ts` uses `node --test` with Node 24 default concurrency; bootstrap creates per-process isolated temp dirs (`test/bootstrap-parallix-home.js:13-22`); tests use mocks and isolated fixtures | Done |
| Repository enforces a numeric unit-test time budget or timeout through a checked-in command, script, or test-runner configuration, and a targeted test proves that exceeding the configured bound fails the unit-test verification path | Per-test: `test/run-default-tests.ts:236` (`--test-timeout=30000`). Suite budget: `test/run-default-tests.ts:235` (`UNIT_TEST_BUDGET_MS=180000`), measured via `process.hrtime.bigint()` at `test/run-default-tests.ts:248,270-271`, fails suite (exit 1 via `||`) at `test/run-default-tests.ts:320`. Tests: `test/unit-test-timeout-guard.test.ts` "timeout terminates a test exceeding the bound"; "suite budget enforcement fails when exceeded" (spawns runner with `PARALLIX_UNIT_TEST_BUDGET_MS=500` and 2s test, confirms non-zero exit) | Done |
| Existing unit-test coverage remains executable; no `.only` or unannotated `.skip` introduced | `bash scripts/test-hygiene.sh` exits 0; `npm test` exits 0; `npm run test:integration` exits 0 | Done |
| `./scripts/verify-local.sh all` exits successfully on completed worktree | `./scripts/verify-local.sh all` exits 0 | Done |

## Next action

Mission complete — all success criteria satisfied. Hand off to review with committed checkpoint documents (CP-1.md through CP-3.md) and clean verification gate.
