# CP-2: Repair the Tarball Install Seam

Updated the post-integrate hook to stop treating the full `npm pack` stdout stream as the tarball path. The hook now captures pack output, extracts the last `.tgz` line, and fails explicitly if no tarball filename is reported. This keeps the happy path working when `prepack`/`publish:guard` prints lifecycle chatter while preserving non-zero failure when packing itself fails.

## Goal Check Table

| Goal | Evidence | Status |
|------|----------|--------|
| Happy-path hook extracts a real tarball filename before install | [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-2206/scripts/refresh-global-px.sh:33), [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-2206/scripts/refresh-global-px.sh:34), [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-2206/scripts/refresh-global-px.sh:42) | PASS |
| Missing/invalid tarball reporting still fails closed | [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-2206/scripts/refresh-global-px.sh:35), [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-2206/scripts/refresh-global-px.sh:38), test name `refresh-global-px.sh still fails closed when npm pack itself fails` | PASS |
| Regression coverage is green after the fix | [test/task-2206-post-integrate-hook-errors.test.js](/home/magnus/code/parallix-task-2206/test/task-2206-post-integrate-hook-errors.test.js:93), [test/task-2206-post-integrate-hook-errors.test.js](/home/magnus/code/parallix-task-2206/test/task-2206-post-integrate-hook-errors.test.js:112), `node --test test/task-2206-post-integrate-hook-errors.test.js` | PASS |

Next action: Run the mission-declared verification gates, update mission-relevant notes if needed, and write the final checkpoint with gate evidence.
