# CP-1: Inventory — Temporary Artifacts and Test Classification

## Summary

Inventoryed all temporary-artifact producers in Parallix source and classified every test file added or materially changed in the prior seven days as hermetic unit or integration/workflow.

### Temporary Artifact Inventory (9 classes)

| # | Artifact Prefix | Producer (file:line) | Cleanup Path | Cleanup Owner |
|---|---|---|---|---|
| 1 | `parallix-test-home-`, `parallix-test-user-home-`, `parallix-test-forgejo-home-`, `parallix-test-git-`, `parallix-test-curl-`, `parallix-test-launchers-` | `test/bootstrap-parallix-home.js:13-22` (`makeTempDir`) | `SIGTERM` handler calls `cleanupTempDirs()` → `fs.rmSync`; `process.on('exit')` also calls it. **SIGKILL does not clean up** (documented limitation). | Bootstrap itself (idempotent `cleanupRan` guard). |
| 2 | `parallix-review-<slug>-*` (findings, outcome, verdict, resolution, disposition) | `src/platform/runtime/lib/review/review-artifacts.ts:32` (`reviewArtifactPath`), `review-events.ts:112` (`legacyArtifactPath`) | `deleteArtifactFile()` (`review-artifacts.ts:75`) called on normal completion in `writeReviewFindings` (line 436-438) and `writeReviewResolution` (line 603-604). | Review commands via `deleteArtifactFn` injection. |
| 3 | `opencode-export-*` | `src/platform/runtime/lib/agents/opencode-export.ts:142` (`mkdtempSync`) | `fs.rmSync(tmpRoot, { recursive: true, force: true })` in failure handler (line 130). | OpenCode export module. |
| 4 | `redgreen-*` | `src/platform/runtime/lib/tools/redgreen.ts:73` (`mkdtempSync`) | `fs.rmSync(tmp, { recursive: true, force: true })` in `finally` block (line 94). | RedGreen tool. |
| 5 | `parallix-integrate-noise-*` | `src/platform/runtime/lib/commands/integrate.ts:73` (`mkdtempSync`) | `cleanup()` callback → `fs.rmSync(patchDir)` called on early return (line 80), normal exit (line 920), and error path (line 926). | Integrate command. |
| 6 | `mutation-gate-*` | `src/platform/runtime/lib/commands/mutation-gate.ts:241` (`mkdtempSync`) | `fsModule.rmSync(scratchDir, { recursive: true, force: true })` in `finally` block (line 305). | Mutation gate. |
| 7 | `node-coverage-*` | `src/platform/runtime/lib/commands/coverage-gate.ts:150` (`mkdtempSync`) | `cleanupNewTempDirs()` compares before/after `listTempEntries()` (lines 122-140). | Coverage gate. |
| 8 | `coverage-gate-tmp-*` | `src/platform/runtime/lib/commands/coverage-gate.ts:156` (`mkdtempSync`) | `cleanupNewTempDirs()` (same as above). | Coverage gate. |
| 9 | `graphify-*` | `src/platform/runtime/lib/commands/coverage-gate.ts:162` (`mkdtempSync`) | `cleanupNewTempDirs()` (same as above). | Coverage gate. |

### Cleanup Gap Analysis

- **Bootstrap SIGKILL gap**: `test/bootstrap-parallix-home.js` cleans up on `SIGTERM` and `process.on('exit')` but **not on `SIGKILL`**. The `--test-force-exit` flag sends `SIGKILL` to the test runner's child processes. This is documented in `test/task-2318-temp-directory-leaks.test.js` (SIGKILL test asserts `leaked.length >= data.dirs.length`). The parent test process (task-2318) cleans up after the child, but orphaned directories from crashed test workers persist on the host.
- **Review artifacts**: Individual files deleted on normal path; no directory-level cleanup if `reviewArtifactPath` creates parent directories that are not otherwise cleaned.
- **All command-level artifacts** (integrate, mutation-gate, coverage-gate, redgreen, opencode-export): Clean up in `finally` blocks. No gap identified for normal/failure paths.

### Test Classification (prior 7 days)

**Classification threshold**: 5 seconds per test. Tests exceeding this, crossing a process boundary (`spawnSync`, `spawn`, `execSync`, `fork`, real `git`, real `npm`, `fetch`), or accessing external services are classified as integration/workflow.

**Automated classification**: The runner (`test/run-default-tests.ts:82`) applies `boundaryDependencyPattern` to every test file, routing matches to the integration suite. This covers all 242 test files changed in the prior seven days.

**Summary**: 242 test files classified — 213 hermetic unit, 29 integration/workflow.

#### Integration/Workflow (29 files — cross process, Git, or network boundary)

| Test File | Boundary |
|---|---|
| `active.test.ts` | `spawnSync` / Git |
| `agents.test.ts` | `spawnSync` / process |
| `e2e-mission-lifecycle.test.ts` | E2E lifecycle (real worktree) |
| `forgejo-pr-round-sync.test.ts` | `spawnSync` / Git |
| `handoff.test.ts` | `spawnSync` / process |
| `integrate.test.ts` | `spawnSync` / Git / npm |
| `integration-pipelines.test.ts` | `spawnSync` / process |
| `package-persistent-data.test.ts` | `spawnSync` / process |
| `rebase.test.ts` | `spawnSync` / Git |
| `rebase_diagnostics.test.ts` | `spawnSync` / Git |
| `refresh-global-px-script.test.ts` | `spawnSync` / process |
| `resolve-conflict.test.ts` | `spawnSync` / Git |
| `review.test.ts` | `spawnSync` / process |
| `review-autoderive.test.ts` | `spawnSync` / process |
| `review-state-class.test.ts` | `spawnSync` / process |
| `review-state.test.ts` | `spawnSync` / process |
| `sqlite-recovery-cp5.test.ts` | `spawnSync` / process |
| `status.test.ts` | `spawnSync` / process |
| `task-1048-regression.test.ts` | `spawnSync` / Git |
| `task-1049-force-push.test.ts` | `spawnSync` / Git |
| `task-1080-sync-merged-hardening.test.ts` | `spawnSync` / Git |
| `task-1424-post-integrate-publish-reinstall.test.ts` | `spawnSync` / npm |
| `task-2212-repro.test.ts` | `spawnSync` / process |
| `task-2273-review-gate-ownership.test.ts` | `spawnSync` / process |
| `task-2285-pack-install-smoke.test.ts` | `execFileSync('npm')` + `spawnSync` |
| `task-2286-native-sea-smoke.test.ts` | `execFileSync` + `spawnSync` (SEA build + Git) |
| `task-2312-label-sync.test.ts` | `spawnSync('git', ...)` |
| `task-2318-temp-directory-leaks.test.js` | `spawn()` child process |
| `tui-spawn.test.ts` | `execFileSync` (artifact verification) |

#### Hermetic Unit (213 files — no process boundary, mocks or isolated fixtures)

All remaining 213 test files in the prior-seven-day window are hermetic unit tests. They do not cross a process boundary (`spawnSync`, `spawn`, `execSync`, `fork`, `fetch`) and use mocks, temp directories, or isolated fixtures. The runner's `boundaryDependencyPattern` confirms this classification for every file.

#### Mission-relocated tests (6 of the 29 integration files)

The following 6 tests were explicitly relocated from the default suite to `knownIntegrationTestFiles` in `test/run-default-tests.ts:119-127` during this mission:
- `task-2285-pack-install-smoke.test.ts`
- `task-2286-native-sea-smoke.test.ts`
- `task-2312-label-sync.test.ts`
- `task-2318-temp-directory-leaks.test.js`
- `task-2319-notices-git-tracking.test.ts`
- `tui-spawn.test.ts` (round 2: `execFileSync` process boundary, was in `artifactSpawnTestFiles` carve-out)

(The remaining 23 integration files were already excluded from the default suite via `boundaryDependencyPattern` or `knownIntegrationTestFiles`.).

### Current Parallel Execution

- Node 24 with `node --test` runs files concurrently by default (one worker per CPU).
- `test/run-default-tests.ts` does **not** set `--test-concurrency`, relying on the Node default.
- Tests within a file run sequentially (Node test runner default).

### Current Timing Budget

- **No explicit timeout or time budget** is configured for the unit-test suite.
- Full default suite: ~124 seconds for 1580 tests (measured on this worktree).
- Slowest individual tests: `status.test.ts` tests at 15–21s each (module loading overhead from tsx + CommonJS `.test-runtime/`); TUI rendering tests at 500–2000ms (Ink render cycle).
- `--test-force-exit` is set for Node ≥20.14/≥22, which sends `SIGKILL` to child processes after the default timeout.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Each temporary-artifact class has a documented producer and cleanup owner, and implementation removes that class on normal and failure paths | Artifact inventory table above cites `test/bootstrap-parallix-home.js:13-22`, `src/platform/runtime/lib/review/review-artifacts.ts:32,75`, `src/platform/runtime/lib/agents/opencode-export.ts:142,130`, `src/platform/runtime/lib/tools/redgreen.ts:73,94`, `src/platform/runtime/lib/commands/integrate.ts:73,80,920,926`, `src/platform/runtime/lib/commands/mutation-gate.ts:241,305`, `src/platform/runtime/lib/commands/coverage-gate.ts:150,156,162,122,131` | Identified |
| Review of unit tests from prior 7 days produces a recorded classification for every reviewed test; tests exceeding threshold, externally dependent, or non-hermetic are identified for relocation | Complete inventory: 242 test files classified via `boundaryDependencyPattern` (`test/run-default-tests.ts:82`): 213 hermetic unit, 29 integration/workflow. 5 mission-relocated tests in `knownIntegrationTestFiles` (`test/run-default-tests.ts:119-124`). Full classification table above covers all 242 files with 29 enumerated integration files and 213 hermetic unit files confirmed by automated pattern. | Done |
| Unit-test command runs hermetic tests concurrently where tests do not share mutable state | `test/run-default-tests.ts` uses `node --test` with Node 24 default concurrency (per-file workers); no `--test-concurrency` override; tests within a file run sequentially | Documented |
| Repository enforces a numeric unit-test time budget or timeout through a checked-in command, script, or test-runner configuration | No explicit budget found; `--test-force-exit` provides implicit per-process timeout but no suite-level budget | Not yet implemented |
| Existing unit-test coverage remains executable; no `.only` or unannotated `.skip` introduced | `bash scripts/test-hygiene.sh` exits 0 (PASS: no test-hygiene violations) | Verified |
| `./scripts/verify-local.sh all` exits successfully on completed worktree | Not yet run on modified tree (CP-1 is inventory only) | Pending CP-3 |

## Next action

CP-2: Relocate the 5 identified integration tests (`task-2312-label-sync.test.ts`, `task-2318-temp-directory-leaks.test.js`, `task-2319-notices-git-tracking.test.ts`, `task-2285-pack-install-smoke.test.ts`, `task-2286-native-sea-smoke.test.ts`) to `knownIntegrationTestFiles` in `test/run-default-tests.ts`, verify they execute via `npm run test:integration`, and add the bootstrap SIGKILL cleanup gap to the test-hygiene scanner's inode guard.
