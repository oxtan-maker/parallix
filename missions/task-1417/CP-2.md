# CP-2

Traced the real release path and pinned the two entrypoints that matter for this bug. `px integrate` already captures a verification proof for the exact tree it is about to publish, and the package release path runs through `package.json` scripts. The stale-build defect existed because the package hook rebuilt artifacts instead of rejecting drift, while the verification proof did not include a freshness check for the shipped runtime surfaces.

## Goal Check Table

| Check | Evidence |
| --- | --- |
| Integrate’s publish-facing path is the verification proof capture/check sequence. | [lib/commands/integrate.ts](/home/magnus/code/parallix-task-1417/lib/commands/integrate.ts:801), [lib/commands/integrate.ts](/home/magnus/code/parallix-task-1417/lib/commands/integrate.ts:811) |
| The package publish-facing path is controlled by `package.json` scripts. | [package.json](/home/magnus/code/parallix-task-1417/package.json:49) |
| The regression test exercises that package hook with a temporary fixture and a stale guarded pair. | [test/task-1417-stale-publish-build-check.test.js](/home/magnus/code/parallix-task-1417/test/task-1417-stale-publish-build-check.test.js:19), [test/task-1417-stale-publish-build-check.test.js](/home/magnus/code/parallix-task-1417/test/task-1417-stale-publish-build-check.test.js:76) |

Next action: replace publish-time self-repair with a shared fail-closed freshness guard and route integrate verification through the same check.
