# CP-4: Archive exclusion

Normal board mission loading now enumerates only active and completed task stores. Archive remains retained on disk but is neither probed nor materialised by the projection.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Archive is neither scanned nor projected | `test/board-readers.worktree-amplification.test.ts`, "board projection does not scan or materialize backlog archive" | PASS |
| In-scope task-store precedence remains intact | `test/adapters/mission-read-adapter.test.ts`, "ConcreteMissionReadAdapter deduplicates task ids across stores preferring lower-priority directory" | PASS |
| Completed-store missions remain projected | `test/adapters/mission-read-adapter.test.ts`, "ConcreteMissionReadAdapter loadAllMissions returns missions from completed store" | PASS |

Next action: Run the full verification gates and capture final board and running-session compatibility evidence.
