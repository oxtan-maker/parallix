# CP-1: Reproduce and Diagnose the Hook Failure

Added a focused regression around the real `scripts/refresh-global-px.sh` contract using stubbed `npm`/`git`/`px` binaries in a temp repo. The red run reproduced the backlog symptom exactly: lifecycle output from `npm pack` was captured into `TARBALL`, so the install step received a multiline pseudo-path and failed with `ENOENT`/exit `254`.

Root cause: [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-2206/scripts/refresh-global-px.sh:33) stores raw `npm pack` stdout in `TARBALL`, then [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-2206/scripts/refresh-global-px.sh:37) passes that unfiltered value to `npm install -g`. The new regression fixture in [test/task-2206-post-integrate-hook-errors.test.js](/home/magnus/code/parallix-task-2206/test/task-2206-post-integrate-hook-errors.test.js:54) makes `npm pack` emit the same lifecycle chatter shown in the backlog log, and the main assertion in [test/task-2206-post-integrate-hook-errors.test.js](/home/magnus/code/parallix-task-2206/test/task-2206-post-integrate-hook-errors.test.js:93) currently fails because the hook tries to install `./> fixture@1.0.1 prepack ... fixture-1.0.1.tgz`.

## Goal Check Table

| Goal | Evidence | Status |
|------|----------|--------|
| Reproduce the current self-update failure with automated coverage | [test/task-2206-post-integrate-hook-errors.test.js](/home/magnus/code/parallix-task-2206/test/task-2206-post-integrate-hook-errors.test.js:93), `node --test test/task-2206-post-integrate-hook-errors.test.js` failed with `ENOENT "./> fixture@1.0.1 prepack\n> npm run publish:guard\n\nfixture-1.0.1.tgz"` | PASS |
| Identify the concrete blocking seam with file references before implementation | [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-2206/scripts/refresh-global-px.sh:33), [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-2206/scripts/refresh-global-px.sh:37) | PASS |
| Confirm invalid publish states still fail non-zero in the harness | [test/task-2206-post-integrate-hook-errors.test.js](/home/magnus/code/parallix-task-2206/test/task-2206-post-integrate-hook-errors.test.js:112), test name `refresh-global-px.sh still fails closed when npm pack itself fails` | PASS |

Next action: Change the hook to extract only the actual tarball filename from `npm pack`, then rerun the new regression plus the required repo gates.
