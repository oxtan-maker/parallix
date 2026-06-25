# CP-4

Updated `printIntegrationPreflight()` to detect an active rebase in the integration checkout and fail preflight with a dedicated `rebase-in-progress` blocker. The dry-run diagnostics now show the current rebase head, exact conflicted files, and the concrete recovery commands to continue, abort, or skip the in-progress rebase before retrying.

## Goal Check Table

| Check | Evidence |
| --- | --- |
| Integration preflight now accepts an injected rebase-state detector and checks the base worktree before the existing index-conflict scan | [lib/commands/integrate.js](/home/magnus/code/parallix-task-1328/lib/commands/integrate.js:938), [lib/commands/integrate.js](/home/magnus/code/parallix-task-1328/lib/commands/integrate.js:1092) |
| Active rebase detection adds `rebase-in-progress` to the failure set and prints recovery commands for the integration checkout | [lib/commands/integrate.js](/home/magnus/code/parallix-task-1328/lib/commands/integrate.js:1094) |
| Regression coverage verifies `px integrate --dry-run` reports the rebase state, conflicted mission-local files, and retry guidance | Test `printIntegrationPreflight fails fast on an in-progress rebase in the integration checkout` in [test/integrate.test.js](/home/magnus/code/parallix-task-1328/test/integrate.test.js:835) |
| CP-4 verification passed | Test run `node --test test/integrate.test.js` |

Next action: add the end-to-end regression in `test/rebase_diagnostics.test.js` that exercises `px status`, `px rebase`, and `px integrate --dry-run` against the TASK-1322 recovery state, then capture CP-5.
