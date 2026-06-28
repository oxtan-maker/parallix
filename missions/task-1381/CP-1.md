# CP-1: Failing Reproduction Test

## Summary

The reproduction test for task-1381 already existed in `test/px-shell-init.test.js` at lines 126-158. The test `px function silently skips cd when target directory is missing (task-1381)` creates a fake `px` binary that emits a `[INFO] Next: cd <missing-dir>` signal pointing to a non-existent directory, then runs the shell function and asserts that no error text is written to stderr and the exit code is 0.

Before the fix, the test fails because the shell function in `px.js:65` writes `[px] ERROR: target directory '<path>' not found.` to stderr.

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Test exercises missing-directory path | `test/px-shell-init.test.js:132-158` — test name: `px function silently skips cd when target directory is missing (task-1381)` |
| 2 | Test fails before fix (stderr contains ERROR) | `test/px-shell-init.test.js:151` — `assert.doesNotMatch(stderrOutput, /ERROR: target directory/)` fails with actual: `[px] ERROR: target directory '/tmp/px-shell-init-missing-...' not found.` |
| 3 | Test asserts exit code 0 | `test/px-shell-init.test.js:155` — `assert.equal(result.status, 0, ...)` |

## Next action: Fix px.js shellInit() to silently skip the cd when the target directory does not exist (remove the error-emitting else branch).
