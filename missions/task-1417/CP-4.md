# CP-4

Updated the operator-facing release documentation and the task artifact to match the chosen packaging strategy. The docs now say to rebuild before `npm pack`, and they explicitly state that `npm pack`, `npm publish`, and integrate-time verification all refuse stale compiled runtime artifacts.

## Goal Check Table

| Check | Evidence |
| --- | --- |
| Operator docs now name the actual release sequence and the fail-closed guard behavior. | [docs/authority-reference.md](/home/magnus/code/parallix-task-1417/docs/authority-reference.md:327), [docs/authority-reference.md](/home/magnus/code/parallix-task-1417/docs/authority-reference.md:343) |
| The mission task record captures the chosen compiled-JS strategy and shared guard scope without changing the workflow-owned assignee field. | [backlog/tasks/task-1417 - ensure-no-stale-js-files-before-publishing.md](/home/magnus/code/parallix-task-1417/backlog/tasks/task-1417%20-%20ensure-no-stale-js-files-before-publishing.md:64) |

Next action: run the required integration gates, update the graphify knowledge graph, and write the final checkpoint with real verification evidence.
