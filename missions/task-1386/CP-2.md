# CP-2: Integrate validateDeclaredGates into runDeclaredGates and confirm validation-failed propagation

## Summary

Successfully integrated `validateDeclaredGates` into `runDeclaredGates` function. The validation now runs before any gate command is executed via `spawnSync`, and `validation-failed` results are properly propagated with distinct error messages.

## Round 1 Fix (Reviewer: claude, REQUEST_CHANGES)

Integrated the same fixes from CP-1 that resolved false positives on realistic gate commands. The integration point at `lib/commands/handoff.ts:567-570` remains unchanged — only the internal logic of `validateDeclaredGates` was tightened.

## Implementation Details

- Added pre-validation call in `runDeclaredGates` at lib/commands/handoff.ts:567-570
- If validation fails, the function returns the validation result immediately without executing any gate commands
- The `validation-failed` reason is distinct from `gate-failed`, allowing callers to distinguish configuration errors from genuine gate failures
- Error messages clearly identify the specific gate command and the validation issue

## Verification

### Integration Tests
- Test 1: Valid gates pass through validation and execute normally (5.965ms)
- Test 2: Invalid file reference fails with `validation-failed` before execution (0.236ms)
- Test 3: Syntax error (unclosed quote) fails with `validation-failed` before execution (0.191ms)

### Propagation Tests
- Mixed valid/invalid gates fail on the first invalid command
- The `performHandoff` function in handoff.ts:348 correctly receives and propagates the `validation-failed` reason
- Error messages in `performHandoff` include the gate command and validation error

### Regression Tests (Round 1)
- Glob patterns like `test/*.test.js` pass validation (no false positive)
- Directory references like `lib/agents/` pass validation (no false positive)
- Apostrophes inside double-quoted strings pass validation (no false positive)
- Escaped quotes inside double-quoted strings pass validation
- Realistic multi-clause gate text passes validation
- Non-existent file paths still correctly fail with `validation-failed`
- Genuine syntax errors (unclosed quotes) still correctly fail

## Files Modified

- `lib/commands/handoff.ts`: Integrated validation call in `runDeclaredGates`
- `lib/commands/handoff.js`: Compiled JavaScript output
- `test/handoff.test.js`: Added integration tests + regression tests

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| `runDeclaredGates` calls `validateDeclaredGates` before executing any gate command via `spawnSync` | lib/commands/handoff.ts:567-570 | PASS |
| `validation-failed` results are propagated without executing further commands | lib/commands/handoff.ts:567-570, test/handoff.test.js:1223-1237 | PASS |
| Error messages identify the specific gate command and validation issue | lib/commands/handoff.ts:435-544, test/handoff.test.js:1130-1370 | PASS |
| Existing `runDeclaredGates` tests continue to pass | test/handoff.test.js:841-1123 (all 11 original tests pass) | PASS |
| New integration tests confirm validation-failed propagation | test/handoff.test.js:1223-1237 (2 tests) | PASS |
| Regression tests confirm no false positives on realistic gate text | test/handoff.test.js:1250-1370 (12 regression tests) | PASS |
| Static-analysis gate passes | ./scripts/verify-local.sh static-analysis: ESLint + tsc + test-hygiene all clean | PASS |
| Tests are portable (no hardcoded absolute paths) | Round 3 fix: all 23 tests use `path.join(__dirname, '..')` | PASS |
| Backtick/em-dash stripping preserved in runDeclaredGates | Round 4 fix: restored stripping logic (handoff.ts:580-586), 4 regression tests | PASS |

Next action: Proceed to CP-3 to perform end-to-end testing with invalid gate commands.
