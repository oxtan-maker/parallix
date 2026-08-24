# CP-2 — publish draft current work

Implemented the defaulted `CurrentWorkPort` seam in `DraftCommandUseCase`.
After preflight resolves a valid mission slug, the use case publishes an
`execute` running event, blocks the same operation on a thrown workflow error,
and ends it after the final transition. Publication failures are best-effort.
The CLI composition now supplies its production current-work recorder.

The existing execute ownership behavior remains explicit: CLI dispatch passes
`detached: false`, while board dispatch defaults to `true`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Draft publishes correlated running and ended events | `test/task-2406-draft-current-work.test.ts`, `"draft publishes running with phase execute before workflow and ended after finalTransition"`, `npm test -- test/task-2406-draft-current-work.test.ts test/draft-command-use-case.test.ts test/board-controller.test.ts` | PASS |
| Draft publishes blocked and rethrows workflow errors | `test/task-2406-draft-current-work.test.ts`, `"draft publishes blocked with the workflow error and rethrows it"`, `npm test -- test/task-2406-draft-current-work.test.ts test/draft-command-use-case.test.ts test/board-controller.test.ts` | PASS |
| Invalid draft slugs do not publish or fail through observability | `test/task-2406-draft-current-work.test.ts`, `"draft skips current-work publication for an unparseable slug"` | PASS |
| Production draft composition supplies the current-work port | `src/composition/create-cli.ts`, `DraftCommandUseCase(adapter, services.currentWork)` | PASS |
| CLI execution stays attached while board execution defaults detached | `test/board-controller.test.ts`, `"controller honors attached CLI launches while defaulting board launches to detached"` | PASS |

Next action: run the mission’s full `./scripts/verify-local.sh all` gate and record final durable verification evidence.
