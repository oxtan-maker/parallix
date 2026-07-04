# CP-3

Implemented the fresh-JS strategy. The shared build-freshness module now exposes reusable status/message helpers, integrate-time verification rejects stale compiled runtime artifacts before capturing or re-checking the publish proof, and the package release hooks now fail closed through `publish:guard` for both `prepack` and `prepublishOnly` instead of rebuilding stale output.

## Goal Check Table

| Check | Evidence |
| --- | --- |
| Freshness enforcement still covers `px`, `index`, and every `lib/commands/*.ts` sibling pair. | [lib/core/build-freshness.ts](/home/magnus/code/parallix-task-1417/lib/core/build-freshness.ts:11), [lib/core/build-freshness.ts](/home/magnus/code/parallix-task-1417/lib/core/build-freshness.ts:32), [lib/core/build-freshness.ts](/home/magnus/code/parallix-task-1417/lib/core/build-freshness.ts:88) |
| Integrate’s verification proof now fails if the publish tree contains stale compiled runtime files. | [lib/core/verification.ts](/home/magnus/code/parallix-task-1417/lib/core/verification.ts:126), [lib/core/verification.ts](/home/magnus/code/parallix-task-1417/lib/core/verification.ts:182) |
| The real package release flow is wired to the guard for both pack and publish hooks. | [package.json](/home/magnus/code/parallix-task-1417/package.json:49) |
| The regression and verification tests are green on the new behavior. | Test: `prepublishOnly fails closed when a guarded compiled file is stale`; Test: `prepublishOnly still passes when guarded compiled files are fresh`; Test: `captureVerifiedTreeProof fails when guarded compiled output is stale` via `node --require ./test/bootstrap-parallix-home.js --test ./test/task-1417-stale-publish-build-check.test.js ./test/verification.test.js` |

Next action: update operator-facing publish docs to describe the new build-first, fail-closed release sequence and record the chosen strategy in the task artifact.
