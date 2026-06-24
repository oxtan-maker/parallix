# CP-1 — Make board mutations completed/archive-aware + add recurrence gate (task-1343)

## Summary of work done

TASK-1343: a "Reorder tasks in backlog" / ordinal write path recreates a
`status: backlog` copy in `backlog/tasks/` for a task whose canonical record
already lives in `backlog/completed/` (or `backlog/archive/`). The reorder write
path itself is the external backlog.md CLI (the `261e5acb "Reorder tasks in
backlog"` commit added the duplicate files; no `ordinal`/`reorder` code exists in
this repo — confirmed by grep). Parallix's `lib/tools/backlog.js` is already
completed-aware for *lookups*, so the fix here is to (a) detect the duplicate and
fail a gate, and (b) provide a completed/archive-aware prune so a board mutation
cannot leave a stale duplicate behind.

Changes:

- **Detection / guard.** `checkBacklogIntegrity()` now scans `backlog/tasks/`,
  `backlog/completed/`, **and** `backlog/archive/tasks/`, and emits a new
  `duplicate-completed` issue (with `taskId` + `canonicalFile`) whenever a task id
  appears in `tasks/` while a canonical copy exists in `completed/` or `archive/`.
  The existing filename-vs-frontmatter `id-mismatch` check is preserved.
- **Mutation hygiene.** New `pruneStaleBacklogDuplicates()` treats the
  completed/archive copy as canonical and removes the stale `backlog/tasks/` copy,
  returning the removed `{taskId, file, canonicalFile}` records.
- **Gate wiring.** The `px draft` preflight (`lib/commands/draft.js`) and the
  `test/backlog_gate.test.js` gate already run `checkBacklogIntegrity` and fail on
  any issue — both now surface `duplicate-completed` with a type-aware message, so
  a recurrence cannot silently ship.
- **Regression test.** `test/backlog_reorder_completed_duplicate.test.js`
  reproduces the evidence from the task (a recreated `status: backlog` + `ordinal:`
  copy alongside a `done` completed copy) and asserts the gate flags it and the
  prune clears it.
- **Docs.** New §4.4 "Backlog integrity gate" in `docs/authority-reference.md`
  describes the reorder/board operation defect and the gate/prune invariant.

## Goal Check

| AC | Requirement | Evidence (file:line / test) | Status |
|----|-------------|------------------------------|--------|
| #1 | Reorder/board mutations never keep a `backlog/tasks` file for an id already in `completed`/`archive` | `pruneStaleBacklogDuplicates` removes such files — `lib/tools/backlog.js:226`; test `pruneStaleBacklogDuplicates removes the stale copy and clears the gate` | PASS |
| #2 | On a (tasks/ + completed/) duplicate, completed copy is canonical and the stale tasks copy is removed | `lib/tools/backlog.js:226-244` keeps `canonicalFile`, removes `file`; test asserts `completed copy must remain canonical` + `resolveTaskFile` returns completed copy | PASS |
| #3 | A gate/guard fails when an id appears in both `backlog/tasks` and `backlog/completed` (or archive) | `duplicate-completed` issue at `lib/tools/backlog.js:205-214`; gate `test/backlog_gate.test.js:6` asserts `issues.length === 0`; draft preflight `lib/commands/draft.js:185`; test `checkBacklogIntegrity flags a reorder-recreated backlog copy of a completed task` | PASS |
| #4 | Automated regression reproduces the reorder-recreates-completed scenario and passes after fix | `test/backlog_reorder_completed_duplicate.test.js` (4 tests incl. `checkBacklogIntegrity also flags a tasks/ copy that duplicates an archived task`) — all pass | PASS |
| #5 | Behavior documented where the reorder/board operation and the workflow gate are described | `docs/authority-reference.md:119` §4.4 "Backlog integrity gate (completed/archive-aware board mutations)" | PASS |

### Gate evidence

- `./scripts/verify-local.sh docs` → `PASS: all required documentation present`
- `npm test` → `tests 1648 / pass 1626 / fail 0 / skipped 22`
- Targeted: `node --test test/backlog.test.js test/backlog_gate.test.js test/backlog_reorder_completed_duplicate.test.js test/draft*.test.js` → 123 pass, 0 fail

## Mission Gates

- [x] `./scripts/verify-local.sh docs` — PASS

Next action: Commit mission artifacts (CP-1.md, MISSION.md) plus the code/test/doc changes on `mission/task-1343`, then hand off to review.
