# CP-1: Reproduction

Review found that the first audit missed the no-slug command path. The declared
reproduction now covers the integration lane with a real liveness probe and
shows the board treats fresh integrate work as working rather than attention.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Fresh integrate work projects as working | `test/task-2411-integrate-work-detection.test.ts`, `"running integrate projects as working, not integrate-lane"` | PASS |
| The reproduction uses the production liveness seam | `test/task-2411-integrate-work-detection.test.ts`, `processLivenessProbe` | PASS |
| The TUI attention rail excludes the running integration mission | `test/task-2411-integrate-work-detection.test.ts`, `"running integrate projects as working, not integrate-lane"` | PASS |

Next action: publish current work for the adapter-inferred slug used by bare `px integrate`.
