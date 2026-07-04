# CP-3: px.ts Preflight

## Summary

Mirrored the freshness check in `px.ts` `run()` before the `_require` calls at lines 224-227 (formerly 218-221).

Changes:
- **Modified**: `px.ts:7` (import `assertBuildFreshness`), `px.ts:217-220` (call before `_require` block, with custom exitFn that sets `process.exitCode` and throws)

The preflight check in `px.ts` uses the same `assertBuildFreshness` utility, ensuring consistent behavior across both entry points.

Manual verification: `node px.ts stats` with a stale `lib/commands/stats.js` correctly exits with code 1 and prints the `npm run build:cjs` instruction.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Preflight imported in px.ts | `px.ts:7` (`import { assertBuildFreshness }`) | PASS |
| Preflight called before _require | `px.ts:217` (`assertBuildFreshness(runtimeDir, ...)`) | PASS |
| Custom exitFn for px.ts return pattern | `px.ts:218-219` (`process.exitCode = code; throw new Error(...)`) | PASS |
| Manual verification: px.ts rejects stale | Command output: `[parallix] Stale build detected...` + exit code 1 | PASS |
| Reproduction test covers both entry points | `test/task-1413-stale-build.test.js:46` (uses `CLI_ENTRY` = `px.js`) | PASS |

Next action: Harden e2e harness and integration gate (CP-4).
