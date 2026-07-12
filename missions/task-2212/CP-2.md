# CP-2: Test-fixture ownership traced

The feature artifact belongs to the feature-branch lifecycle test: `runScenario` creates `feature/e2e-base`, derives `repo-task-2001` as the mission worktree, and currently relies on its function-level `finally` to delete the temporary repository. The stale TASK-2198 artifact belongs to the review unit test: it creates a separate temporary root and task file, then relies on its own `finally` to remove that root. A hard interruption bypasses both `finally` blocks, which is the failure demonstrated in CP-1.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: named regression exercises both reported owners | `"interrupted feature lifecycle leaves no e2e branch or worktree behind (SC1/SC2)"`; `"interrupted review fixture leaves no TASK-2198 stale-active task behind (SC1/SC3)"` | Red cases recorded |
| SC2: e2e branch and worktree owner is identified | `test/e2e-mission-lifecycle.test.js:449`; `test/e2e-mission-lifecycle.test.js:469`; `test/e2e-mission-lifecycle.test.js:574` | Confirmed |
| SC3: TASK-2198 fixture owner is identified | `test/review.test.js:3162`; `test/review.test.js:3170`; `test/review.test.js:3213` | Confirmed |
| SC4: existing cleanup seams are identified | `test/e2e-mission-lifecycle.test.js:572`; `test/review.test.js:3210` | Confirmed — both are in-process `finally` cleanup only |
| SC5: no focused or unannotated skipped test | `test/task-2212-repro.test.js` | Pending final test-hygiene verification |
| SC6: repository verifier passes | `./scripts/verify-local.sh all` | Pending CP5 |

Next action: Add test-owned interruption cleanup that removes only the recorded temporary roots, their worktrees, and their fixture branches without touching developer state.
