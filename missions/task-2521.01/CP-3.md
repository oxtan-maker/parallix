# CP-3: Guard 1 — anti-regression guard against new normal-runtime writes to retired workflow paths

## Summary

Added guard 1: `test/retired-workflow-path-write-guard.test.ts`. It scans every
production `.ts` file under `src/` (excluding port declarations) and flags a file that carries a
write token (`writeFileSync`, `writeFileAtomic`, `mkdirSync`, `renameSync`,
`rmSync`, `cpSync`, `appendFileSync`, `createWriteStream`, `writeJson`,
`writeText`, `writeFile(`) **and** references a retired workflow path
(`missions/`, `MISSION.md`, `CP-<n>.md`, `review-events`, `review-state.json`,
`backlog.md`, `backlog/tasks`, `backlog/completed`, `backlog/archive`) or a
Mission-path resolver anywhere in the file. Any such write in a file that is not registered in
`RETIRED_WORKFLOW_PATH_WRITERS` fails the test.

The guard consults the inventory from CP-2, so the eleven legitimate writers
never false-positive. Every registered pattern must still match its source and
its source must still contain a matching writer, making the allowlist load-bearing.

SC3 proven on the final tree: a throwaway `src/application/_task2521_rogue.ts`
containing `fs.writeFileSync(path.join(missionDir, 'MISSION.md'), ...)` made the
guard fail with
`src/application/_task2521_rogue.ts:3: write to a retired workflow path in an unregistered file`;
removing the file returned the guard to green.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 — no unidentified normal-runtime write remains | `test/retired-workflow-path-write-guard.test.ts`, `"guard 1: no unregistered normal-runtime write to a retired workflow path"` passes on the final tree | PASS |
| SC3 — a newly introduced normal-runtime writer is rejected | `test/retired-workflow-path-write-guard.test.ts`, `"guard 1 fixture: rejects a variable-path write to a retired path in a new file"` | PASS (negative assertion demonstrated) |
| Guard does not false-positive on legitimate writers | The 11 entries in `RETIRED_WORKFLOW_PATH_WRITERS` are exempt; `test/retired-workflow-path-write-guard.test.ts`, `"guard 1: every registered writer names at least one live retired-path pattern"` | PASS |
| Guard logic is exercised by fixtures | `test/retired-workflow-path-write-guard.test.ts` fixtures: rejects synthetic rogue write, permits registered writer, ignores non-retired SQLite writes | PASS |
| New guard passes in the suite | `npm test` → `pass 2641 fail 0` | PASS |

Next action: CP-4 — add guard 2, the executable guard that fails when new
application/interface code resolves or persists through `missions/**` or repo
Backlog task files as Mission persistence.
