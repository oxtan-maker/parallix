# CP-2 — Mainline route reports evidence and stops

## Summary

Removed the synthetic-backlog side effect from the mainline-reproduced failure route in
`src/adapters/cli/commands/integrate-gate-rebound.ts`:

- Deleted `mainlineGateTaskId` and `createMainlineGateTask` (identifier construction, hand-rendered task Markdown,
  `fs` write, `git add`, `git commit`) along with the now-unused `crypto`/`fs`/`path`, `elideBounceOutput`, and
  `getTaskStorage` imports.
- Deleted the `createMainlineGateTaskFn` injection seam from `IntegrationGateRouteOptions`.
- The `mainline` route now reports the probe detail, the failing gate command, the base worktree/branch and base
  commit, the exit code, and the gate error, then returns `{ route: 'mainline'; detail; baseCommit }`. `integrate.ts`
  aborts before merge on any non-`fixed` route, so the stop outcome is unchanged.
- Updated `test/task-2492-integration-gate-rebound.test.ts` (dropped the ticket-writing tests and the mainline-task
  harness seam; the mainline routing test now asserts reported evidence and the absence of a fabricated identifier)
  and removed the stale `mission-write-integrate-gate-rebound` file-write entry from
  `test/fixtures/durable-state-inventory.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Base worktree unchanged, clean, uncommitted on a mainline-reproduced failure | `"TASK-2507: a gate failure reproduced in the primary checkout leaves the base worktree byte-for-byte unchanged and uncommitted"` in `test/task-2507-mainline-gate-mutation-repro.test.ts` — now green | PASS |
| No `TASK-MAINGATE` construction, no hand-rendered backlog Markdown | `"TASK-2507: the integration-failure handler constructs no TASK-MAINGATE identifier and renders no backlog Markdown"` | PASS |
| Mainline failure reports gate evidence and terminates without a backlog task | `"TASK-2492/TASK-2507: a gate failure reproducing on main reports the evidence and never bounces"` in `test/task-2492-integration-gate-rebound.test.ts` | PASS |
| Existing routing behaviour (fixed / exhausted / limit-reached / stranded, bounce prompt) preserved | `npx tsx --test test/task-2492-integration-gate-rebound.test.ts test/task-2504-repro.test.ts` — 18 tests pass | PASS |
| Lint and static analysis clean on changed files | `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED | PASS |

Next action: CP-3 — add regression coverage proving a mission-only gate failure still takes the bounded rebound path at its `INTEGRATION_GATE_REBOUND_LIMIT` retry bound.
