# Checkpoint 2: Persistent Ownership and Orphan Recovery

## Summary
Implemented manifest-based SIGKILL orphan recovery in `src/platform/runtime/lib/commands/coverage-gate.ts`:

**Design**: Reused the per-run manifest protocol from TASK-2326's test bootstrap. Each coverage-gate process writes its scratch directory paths to a PID-scoped JSON file (`<PID>.json`) in a shared manifest directory. The manifest is flushed synchronously after each scratch directory creation, before any child work that could be SIGKILL'd.

**Recovery entry point**: `recoverOrphanedScratchDirs()` scans the manifest directory for PID-scoped files, checks each PID with `process.kill(pid, 0)`, and removes registered roots from processes that are no longer alive. Called at the start of `main()` so every coverage-gate invocation cleans up after any previous terminated run.

**Implementation details**:
- `COVERAGE_GATE_MANIFEST_DIR`: Shared manifest directory (auto-created or overridden via `PARALLIX_COVERAGE_GATE_MANIFEST_DIR` env var for testing)
- `flushCoverageManifest()`: Writes `PER_RUN_SCRATCH` array to `<PID>.json` (synchronous, best-effort)
- `recoverOrphanedScratchDirs(manifestDir?)`: Scans manifests, checks PID liveness, removes orphaned roots and stale manifest files
- Updated `createPerRunScratchDirs()`, `createPerRunTmpRoot()`, `createMockGraphifyBin()` to call `flushCoverageManifest()` after recording in `PER_RUN_SCRATCH`
- Added `recoverOrphanedScratchDirs()` call at the start of `main()`
- Exported `createPerRunTmpRoot`, `createMockGraphifyBin`, `flushCoverageManifest`, `recoverOrphanedScratchDirs`, `COVERAGE_GATE_MANIFEST_DIR`

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: Every scratch root recorded in durable per-run ownership state before child work | `src/platform/runtime/lib/commands/coverage-gate.ts:228`, `:235`, `:242` — `flushCoverageManifest()` called after each `PER_RUN_SCRATCH.push()` in `createPerRunScratchDirs`, `createPerRunTmpRoot`, `createMockGraphifyBin` | PASS |
| SC3: Recovery removes SIGKILL-orphaned roots and ownership record | `src/platform/runtime/lib/commands/coverage-gate.ts:138` — `recoverOrphanedScratchDirs()` with `process.kill(pid, 0)` at `:148` | PASS |
| SC5: Normal/error cleanup preserved | `src/platform/runtime/lib/commands/coverage-gate.ts:263` — `cleanupPerRunScratch()` unchanged; `test/coverage-gate.test.ts` all 18 tests pass | PASS |
| Recovery called at startup | `src/platform/runtime/lib/commands/coverage-gate.ts:362` — `recoverOrphanedScratchDirs()` called in `main()` before test discovery | PASS |
| Manifest overridable for testing | `src/platform/runtime/lib/commands/coverage-gate.ts:105` — `PARALLIX_COVERAGE_GATE_MANIFEST_DIR` env var support | PASS |

## Next action
Add ownership-boundary coverage for live concurrent runs and unregistered matching roots, confirm verifier passes, and produce final Goal Check evidence — proceed to CP-3.
