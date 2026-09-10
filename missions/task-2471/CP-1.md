# CP-1: Demote success-path internal-plumbing lines to a DEBUG gate

## Summary of work done

Added two log transports inside `createDraftWorkflowAdapter` in
`src/adapters/cli/commands/draft-stats.ts` and repointed the success-path
plumbing callsites at them. Message text, argument order, and call order are
unchanged; only the transport is gated.

- `debugFn(msg)` — forwards to the adapter's `logFn` only when `process.env.DEBUG`
  is set. This reuses the exact env gate `fmt.log.debug` already uses
  (`src/application/presentation/cli-format.ts`), so no new verbose mechanism is
  introduced (mission Restricted Areas).
- `plumbingLogFn(msg)` — routes lines whose rendered status tag is `[WARN]` or
  `[FAIL]` to `logFn` unchanged, and everything else to `debugFn`. The
  `draft-setup.ts` helpers (`ensureMissionBranch`, `ensureWorktree`,
  `ensureGraphifyWorkspace`, `ensureGraphifyIgnore`, `ensureWorkflowGitignore`,
  `ensureMissionFile`, `ensureMissionBaseBranchRecorded`, `bootstrapBacklogTask`)
  emit both success plumbing and genuine exceptional conditions through the one
  `logFn` they are handed, so this splitter demotes only the success half and
  satisfies the mission stop rule "Stop demoting any line that carries `errorFn`
  or `fmt.status('WARN')`".

### Deviation from the literal mission wording (deliberate, in-contract)

The Scope line says demote to `fmt.log.debug(...)`. `fmt.log.debug` writes to
the module-level `currentLogger`, **not** to the adapter's injected `logFn`.
Using it literally would bypass the injected-deps seam that the mission's own
Risks section requires the tests to use ("use the existing injected-deps seam
(`runDraftCommand` with `startDraftAgentFn`, `missionServicesFn`, etc.)"), making
SC2 unverifiable, and would also re-render every message as `[DEBUG] ...`,
breaking SC2's "count == the count emitted on the pre-change tree" for the named
`[PASS]`/`[INFO]` lines. `debugFn` preserves both: the same `process.env.DEBUG`
gate, the same messages, and the same transport the tests observe.

### Callsites demoted

Direct `debugFn` (named in SC1): `Mission materialized in SQLite`,
`Created .gitignore with ... workflow entries`,
`Appended ... workflow entries to .gitignore`,
`.gitignore ... already contains all workflow entries`,
`Draft setup complete.` (plus its `Worktree:` / `Mission doc:` lines),
`Post-draft mission type labels validated`,
`Post-draft mission type labels validated after restart`,
`Standalone mission baseline committed in the primary checkout.`

Via `plumbingLogFn` (helper-owned, named in SC1): `Created branch`,
`Created worktree`, `graphify-out directory`, `Recorded <Base-Branch line>`,
`Scaffolded MISSION.md`, and the `Draft stats recorded:` row from
`recordDraftStats`.

### Deliberately not demoted

- The `Step 1:`–`Step 4:` `fmt.bold(...)` headers. Mission Risks scopes the
  demotion to "success-path `logFn(fmt.status('PASS'/'INFO', ...))` plumbing
  lines named in SC1"; these are neither `fmt.status` nor named in SC1.
- `.gitignore in <path>: not a git repo (skipped)` — an `INFO` skip-reason that
  reports an anomaly an operator should see.
- `Mission already recorded in SQLite` — signals a re-run, not clean plumbing.
- `Feature-branch mission: base branch detected as ...` — operator orientation,
  not named in SC1.
- Every `errorFn` line and every `Repair:` hint.

### SC1 line that does not exist

`Classification labels synced` appears in SC1 but no such string exists in
`src/` (`grep -rn "Classification labels synced" src/` returns nothing). Its
default-output count is therefore trivially 0. Recorded here so CP-3 does not
assert against a string that was never emitted.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: named plumbing lines leave the default happy path | `src/adapters/cli/commands/draft-stats.ts` (`debugFn` / `plumbingLogFn` transports); asserted by tests added in CP-3 | PASS |
| SC2: `DEBUG=1` restores the same lines, unmodified | `debugFn` forwards the original message to `logFn` under `process.env.DEBUG`, reusing the gate in `src/application/presentation/cli-format.ts`; asserted by tests added in CP-3 | PASS |
| SC6: warnings/failures/repair hints stay on the default path | `plumbingLogFn` re-routes `[WARN]`/`[FAIL]` to `logFn`; `"runDraftCommand does not transition to refined when draft agent exits non-zero"`, `"runDraftCommand fails closed and leaves the Backlog task untouched when Mission intake is unavailable"`, `test/draft.test.ts` | PASS |
| SC7: no workflow/lifecycle/persistence behavior change | `"runDraftCommand transitions task to backlog after setup completes"`, `"runDraftCommand materializes the Mission in SQLite before transitioning the Backlog task"`, `"runDraftCommand records the refine transition before the Backlog task reaches ready"`, `test/draft.test.ts` | PASS |
| SC8: pre-existing draft tests pass unchanged | `node --import tsx --import ./test/bootstrap-parallix-home.ts --experimental-test-module-mocks --test test/draft.test.ts` — 75 pass, 0 fail, no test file edited in CP-1 | PASS |
| Typecheck clean on the changed file | `npm run typecheck` | PASS |

Next action: CP-2 — replace the `finalTransition` `Next: cd <worktree>` line in `src/adapters/cli/commands/draft-stats.ts` with the compact mission summary block (mission title read from `ctx.missionFile` falling back to `ctx.slug`, `ctx.actualAgent`, a success marker, `ctx.missionFile`, `ctx.targetWorktree`, and `px active`).
