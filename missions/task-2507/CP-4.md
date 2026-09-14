# CP-4 — Final verification and diff inspection

## Summary

Ran the mission-declared gate on the committed tree and inspected the whole mission diff against the mission parent
commit `77b3d16d6`.

- `./scripts/verify-local.sh all` exits `0` (2448 passing assertions reported by the runner; log kept at
  `/tmp/2507-final.log` for this session only).
- `git diff --stat 77b3d16d6..HEAD` touches nine files: the handler, four test files, the durable-state inventory
  fixture, and the three checkpoint documents. `git diff 77b3d16d6..HEAD -- backlog/` is empty — no backlog task
  file was created, renamed, moved, or edited by this mission, and
  `backlog/tasks/task-2507 - Stop-integration-failure-handling-from-mutating-main-or-inventing-backlog-IDs.md`
  is untouched.
- Working tree carries only the pre-existing `package-lock.json` modification present at session start; all mission
  and checkpoint files are committed.

Net behaviour change: a gate failure that reproduces in the primary checkout now reports the probe detail, the gate
command, the base branch and commit, the exit code, and the gate error, then returns `{ route: 'mainline' }`, which
`integrate.ts` turns into an abort before merge. Nothing is written or committed to the base worktree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Mainline-reproduced failure leaves the base worktree byte-for-byte unchanged, `git status --porcelain` empty, no file, no commit | `"TASK-2507: a gate failure reproduced in the primary checkout leaves the base worktree byte-for-byte unchanged and uncommitted"` in `test/task-2507-mainline-gate-mutation-repro.test.ts` | PASS |
| Implementation constructs no `TASK-MAINGATE` identifier and renders no backlog Markdown | `"TASK-2507: the integration-failure handler constructs no TASK-MAINGATE identifier and renders no backlog Markdown"` (asserts the source of `src/adapters/cli/commands/integrate-gate-rebound.ts` contains no `TASK-MAINGATE`, no `status: backlog`, no `writeFileSync`/`getTaskStorage`/`'commit'`) | PASS |
| Mainline-reproduced failure reports gate evidence and terminates without a backlog task | `"TASK-2492/TASK-2507: a gate failure reproducing on main reports the evidence and never bounces"` in `test/task-2492-integration-gate-rebound.test.ts` | PASS |
| Mission-only failure still takes the bounded rebound path, including its retry bound | `"TASK-2507: a gate failure that reproduces only in the mission worktree still bounces once within its retry bound and leaves the base worktree clean"` | PASS |
| Red-to-green reproduction test (bug-labelled mission) | `test/task-2507-mainline-gate-mutation-repro.test.ts` — red at parent `77b3d16d6` (CP-1 records the two assertion failures), green at `HEAD` | PASS |
| Repository verification gate passes on the final tree | `./scripts/verify-local.sh all` — exit status 0 | PASS |
| Lint and static analysis clean on every changed file | `./scripts/verify-local.sh static-analysis` — ESLint, `npm run typecheck`, test-hygiene, test typecheck all pass | PASS |
| No focused or bare skipped tests introduced | test-hygiene stage of `./scripts/verify-local.sh static-analysis` — "no test-hygiene violations" | PASS |
| No backlog file mutated as a side effect of this mission | `git diff 77b3d16d6..HEAD -- backlog/` produces no output | PASS |
| Docs unaffected | no authored doc describes the removed mainline-ticket behaviour (`grep -rn "MAINGATE\|mainline" docs` returns nothing); `docs/adr/0041-integration-pipeline-gates.md` and `docs/adr/0048-...` are unchanged | PASS |

Next action: hand off to review — all four checkpoints and the mission gate `./scripts/verify-local.sh all` are committed and green; no further mission work remains.
