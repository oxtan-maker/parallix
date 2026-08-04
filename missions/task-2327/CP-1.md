# Checkpoint 1: Failing Reproduction Test

## Summary
Authored `test/task-2327-coverage-gate-tmp-leaks.test.js` with three subprocess-based regression tests that verify coverage-gate SIGKILL orphan recovery:

1. **Main regression** (SC1/SC2/SC3): Spawns a child process that creates all three scratch directory types (`node-coverage-*`, `coverage-gate-tmp-*`, `graphify-*`), writes them to a per-run manifest, SIGKILLs the child, verifies directories persist after SIGKILL, then runs `recoverOrphanedScratchDirs()` and confirms all registered roots are reclaimed.

2. **Live concurrent safety** (SC4): Two children share a manifest directory; one is SIGKILL'd and the other stays alive. Recovery removes only the dead child's roots, preserving the live child's directories.

3. **Unregistered directory safety** (SC4): Three unregistered directories with matching prefixes exist alongside a registered one. Recovery removes only the registered directory, leaving unregistered ones untouched.

The test file is registered in `test/run-default-tests.ts` as an integration test (crosses process boundary via `spawn`) and in `test/default-test-suite.test.ts` expected list.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Reproduction test is red at parent commit (orphaned dirs persist after SIGKILL) | `test/task-2327-coverage-gate-tmp-leaks.test.js:148` — asserts `leakedAfter.length === manifestRoots.length` after SIGKILL | PASS |
| SC1: Same test is green after fix (recovery reclaims roots) | `test/task-2327-coverage-gate-tmp-leaks.test.js:159` — asserts `stillLeaked.length === 0` after `recoverOrphanedScratchDirs()` | PASS |
| SC2: All three prefix classes recorded in durable per-run state | `test/task-2327-coverage-gate-tmp-leaks.test.js:118-130` — asserts manifest contains `node-coverage-*`, `coverage-gate-tmp-*`, `graphify-*` | PASS |
| SC3: Recovery removes SIGKILL-orphaned roots and ownership record | `test/task-2327-coverage-gate-tmp-leaks.test.js:159-170` — asserts all roots removed and manifest file deleted | PASS |
| Test registered in integration suite | `test/run-default-tests.ts:127`, `test/default-test-suite.test.ts:59` | PASS |

## Next action
Implement registration (manifest flush after each scratch dir creation) and orphan recovery (`recoverOrphanedScratchDirs`) in `src/platform/runtime/lib/commands/coverage-gate.ts` — proceed to CP-2.
