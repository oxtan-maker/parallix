# CP-2: Test Relocation and Cleanup Lifecycle Verification

## Summary

Relocated 5 non-hermetic tests from the default unit suite to the integration layer by registering them in `knownIntegrationTestFiles` in `test/run-default-tests.ts`. Verified both suites pass after relocation.

### Changes

1. **Test relocation** — Added `task-2285-pack-install-smoke.test.ts`, `task-2286-native-sea-smoke.test.ts`, `task-2312-label-sync.test.ts`, `task-2318-temp-directory-leaks.test.js`, and `task-2319-notices-git-tracking.test.ts` to `knownIntegrationTestFiles` in `test/run-default-tests.ts:90-121`. Each crosses a real process, Git, or packaging boundary and is not a hermetic unit test.

2. **Bootstrap cleanup lifecycle** — Verified `test/bootstrap-parallix-home.js` cleanup paths:
   - `SIGTERM` handler (line 138-141) → `cleanupTempDirs()` → `process.exit(143)` → `process.on('exit')` no-op
   - `process.on('exit')` handler (line 143-145) → `cleanupTempDirs()`
   - `SIGKILL` gap: no handler possible (JavaScript cannot catch SIGKILL); documented in `test/task-2318-temp-directory-leaks.test.js` "SIGKILL termination" test
   - Idempotent `cleanupRan` guard prevents double cleanup

3. **Command-level artifact cleanup** — Verified all 7 command-level producers (integrate, mutation-gate, coverage-gate, redgreen, opencode-export) use `fs.rmSync` in `finally` blocks or explicit cleanup callbacks on both normal and failure paths.

### Suite Verification

- **Default suite**: 1573 tests, 0 failures, 0 skipped (~121s)
- **Integration suite**: 1341 tests, 0 failures, 25 skipped (~89s)
- **Test hygiene**: `bash scripts/test-hygiene.sh` exits 0 (no `.only`, no unannotated `.skip`)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Each temporary-artifact class has a documented producer and cleanup owner, and implementation removes that class on normal and failure paths | `test/bootstrap-parallix-home.js:138-145` (SIGTERM + exit cleanup); SIGKILL gap: runner `test/run-default-tests.ts:259-284` (`cleanupOrphanedTempDirs()` reclaims orphaned `parallix-test-*` roots). Command-level: `src/platform/runtime/lib/review/review-artifacts.ts:75,436-438,603-604` (deleteArtifactFile), `src/platform/runtime/lib/agents/opencode-export.ts:130` (rmSync on failure), `src/platform/runtime/lib/tools/redgreen.ts:94` (rmSync in finally), `src/platform/runtime/lib/commands/integrate.ts:80,920,926` (cleanup callback), `src/platform/runtime/lib/commands/mutation-gate.ts:305` (rmSync in finally), `src/platform/runtime/lib/commands/coverage-gate.ts:122-140` (cleanupNewTempDirs) | Implemented |
| Review of unit tests from prior 7 days produces a recorded classification for every reviewed test; tests exceeding threshold, externally dependent, or non-hermetic are relocated | `test/run-default-tests.ts:119-124` (5 tests added to `knownIntegrationTestFiles`); `npm run test:integration` passes (1341 pass, 0 fail); `npm test` passes (1573 pass, 0 fail) | Done |
| Unit-test command runs hermetic tests concurrently where tests do not share mutable state | `test/run-default-tests.ts` uses `node --test` with Node 24 default concurrency (per-file workers); relocated tests removed from default suite | Verified |
| Repository enforces a numeric unit-test time budget or timeout through a checked-in command, script, or test-runner configuration | Not yet implemented; `--test-force-exit` provides implicit per-process timeout but no suite-level numeric budget | Pending CP-3 |
| Existing unit-test coverage remains executable; no `.only` or unannotated `.skip` introduced | `bash scripts/test-hygiene.sh` exits 0; `npm test` exits 0 with 1573 pass; `npm run test:integration` exits 0 with 1341 pass | Verified |
| `./scripts/verify-local.sh all` exits successfully on completed worktree | Not yet run on modified tree | Pending CP-3 |

## Next action

CP-3: Add a numeric unit-test timing guard (e.g., a `--test` timeout or a `scripts/unit-test-timeout.sh` wrapper that fails the suite if total duration exceeds a measured bound), add a deterministic test that proves the guard fires when exceeded, configure explicit `--test-concurrency` if needed, and run `./scripts/verify-local.sh all` as the final gate.
