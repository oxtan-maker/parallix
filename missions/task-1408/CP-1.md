# CP-1

Added the runtime smoke regression test at `test/px-runtime-smoke.test.js`. The final mission diff is limited to that new test plus mission-tracking files; earlier out-of-scope changes to `px.ts` and `test/task-1413-stale-build.test.js` were removed during review follow-up.

## Goal Check

| Goal Check | Evidence | Status |
| --- | --- | --- |
| New top-level smoke test exists with the required mission test name | `test/px-runtime-smoke.test.js:8` defines `px runtime smoke test verifies node px.ts executes without module resolution errors` | PASS |
| Smoke test invokes native `node px.ts --version` with no experimental flags | `test/px-runtime-smoke.test.js:9` uses `spawnSync('node', ['px.ts', '--version'], ...)` | PASS |
| Smoke test enforces successful exit and no module-resolution failure | `test/px-runtime-smoke.test.js:15-16` asserts `result.status === 0` and rejects `/ERR_MODULE_NOT_FOUND/` | PASS |
| Test is discoverable by the existing suite glob | `package.json:54` runs `node --test test/*.test.js`, which includes `test/px-runtime-smoke.test.js` | PASS |
| Required mission gate `docs` completed | `./scripts/verify-local.sh docs` passed | PASS |
| Required mission gate `all` completed | `PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" ./scripts/verify-local.sh all` passed | PASS |

Verification note: the default shell `node` on this machine resolves to `v22.22.2`, which fails the native-runtime `px` tests. The required `all` gate passed once rerun with Node `v24.15.0` first on `PATH`, matching the mission's intended runtime.
