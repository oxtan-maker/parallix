# CP-3: Final Verification

The task-specific regression is fixed and green, and the docs gate passes. The required `all` gate still fails in this environment because of an unrelated existing runtime-smoke test that executes `node px.ts --version` directly under Node `v22.22.2`, which throws `ERR_UNKNOWN_FILE_EXTENSION` for `.ts`. That failure is outside the post-integrate hook seam changed in this mission, so the mission cannot be handed off as fully verified from the current environment.

## Goal Check

| Goal | Evidence | Status |
|------|----------|--------|
| Post-integrate hook happy path survives `npm pack` lifecycle chatter and reaches tarball install correctly | [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-2206/scripts/refresh-global-px.sh:33), [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-2206/scripts/refresh-global-px.sh:34), [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-2206/scripts/refresh-global-px.sh:42), test name `refresh-global-px.sh passes a real tarball path to npm install even when npm pack prints lifecycle output` | PASS |
| Invalid publish states still fail non-zero instead of corrupting the install seam | [test/task-2206-post-integrate-hook-errors.test.js](/home/magnus/code/parallix-task-2206/test/task-2206-post-integrate-hook-errors.test.js:112), test name `refresh-global-px.sh still fails closed when npm pack itself fails` | PASS |
| Mission-declared docs gate passes | `./scripts/verify-local.sh docs` → `PASS: all required documentation present` | PASS |
| Mission-declared all gate passes | `./scripts/verify-local.sh all` failed at [test/px-runtime-smoke.test.js](/home/magnus/code/parallix-task-2206/test/px-runtime-smoke.test.js:8) under Node `v22.22.2` with `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for .../px.ts` | BLOCKED |

Next action: Resolve the unrelated `test/px-runtime-smoke.test.js` Node-runtime expectation or rerun the mission gates in a supported Node environment, then rerun `./scripts/verify-local.sh all` before handoff.
