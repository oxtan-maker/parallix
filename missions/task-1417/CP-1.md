# CP-1

Added a publish-path regression at `test/task-1417-stale-publish-build-check.test.js` that creates a temporary package fixture, forces a stale `lib/commands/stats.ts` / `stats.js` pair by mtime, and exercises `npm run prepublishOnly`. The stale-path assertion is intentionally red on the current code because `prepublishOnly` still rebuilds instead of rejecting the stale tree; the fresh-path control stays green.

## Goal Check Table

| Check | Evidence |
| --- | --- |
| Reproduction test targets the real package publish hook and simulates a stale guarded pair in a temp fixture. | [test/task-1417-stale-publish-build-check.test.js](/home/magnus/code/parallix-task-1417/test/task-1417-stale-publish-build-check.test.js:19), [test/task-1417-stale-publish-build-check.test.js](/home/magnus/code/parallix-task-1417/test/task-1417-stale-publish-build-check.test.js:51) |
| Red result proves the current publish hook does not fail closed on stale compiled output. | Test: `prepublishOnly fails closed when a guarded compiled file is stale` via `node --require ./test/bootstrap-parallix-home.js --test ./test/task-1417-stale-publish-build-check.test.js` failed with `0 !== 1` after `npm run build:cjs` completed inside the fixture. |
| Happy-path control exists so the mission can preserve publish behavior once the guard is wired correctly. | [test/task-1417-stale-publish-build-check.test.js](/home/magnus/code/parallix-task-1417/test/task-1417-stale-publish-build-check.test.js:78), Test: `prepublishOnly still passes when guarded compiled files are fresh` |

Next action: trace the release/integration path and wire a fail-closed freshness guard into the actual publish flow instead of allowing `prepublishOnly` to silently repair stale artifacts.
