# CP-4: Finalize backlog barrel

Finalized `backlog.ts` as a compatibility barrel over the file-I/O, metadata, and transitions adapters. The barrel is 39 lines and preserves all 30 exports present before the split; the refreshed project graph reflects the new module relationships.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Backlog compatibility barrel is below 400 lines | `./scripts/verify-local.sh integrate` | PASS |
| All prior backlog exports are retained | `test/task-1039-handoff.test.ts`, `./scripts/verify-local.sh integrate` | PASS |
| Focused adapters provide file I/O, metadata, and transitions | `test/task-2312-label-sync.test.ts`, `./scripts/verify-local.sh integrate` | PASS |
| Final integration verification passes | `./scripts/verify-local.sh integrate` | PASS |

Next action: Hand off the committed refactor for the mission lifecycle's review stage.
