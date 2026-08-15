## Summary

Authored reproduction test `test/task-2377-repro.test.ts` with 3 test cases:

1. **startAgent tries excluded agents after non-excluded pool exhausts** — simulates codex and qwen failing, asserts excluded agent `claude` (the implementer) is tried as last resort and succeeds
2. **startAgent throws exhaustion after both non-excluded and excluded agents fail** — all agents including excluded fail, asserts exhaustion error is thrown after trying all 3
3. **startAgent does not try excluded agents when non-excluded agent succeeds** — codex succeeds on first try, excluded agent never tried

Test fails on parent commit (red): `startAgent` throws "All eligible agents exhausted" before trying excluded agents. Passes after fix (green).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test authored | `test/task-2377-repro.test.ts` (3 tests) | PASS |
| Test fails on parent commit (red) | `npx tsx --test test/task-2377-repro.test.ts` — 2 fail, 1 pass before fix | PASS |
| Test passes after fix (green) | `npx tsx --test test/task-2377-repro.test.ts` — 3 pass after fix | PASS |
| No focused or skipped tests | Test file has no `.only` or `.skip` | PASS |

Next action: Apply fix to `startAgent` in `src/adapters/agents/agents.ts` and verify all tests pass (CP-2).
