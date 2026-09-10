# CP-3: Focused output-contract tests and the verification gate

## Summary of work done

Added a `TASK-2471` block of focused tests to `test/draft.test.ts` covering the
new default-output contract, built on the existing `draftDepsForIntake` seam so
nothing spawns a real agent, touches the network, or writes SQLite.

Shared fixtures:

- `TASK_2471_PLUMBING_LINES` — the SC1 message list.
- `task2471DraftDeps(overrides)` — wraps `draftDepsForIntake` with setup-helper
  doubles that emit the *real* plumbing messages through the `logFn` the adapter
  hands them. The demote/keep routing is therefore what is under test, not the
  doubles.
- `runDraftCapturingOutput({ debug, overrides })` — runs a draft with output
  captured, setting and restoring `process.env.DEBUG` around the call.
- `missionFileStub(missionFile)` / `writeMissionFile(heading)` — point the
  scaffold step at a real `MISSION.md` while still emitting the
  `Scaffolded MISSION.md` plumbing line.

Tests added (9):

| Test | Criterion |
|---|---|
| `"px draft default output omits every internal-plumbing line"` | SC1 |
| `"px draft demotes the .gitignore plumbing line and DEBUG restores it"` | SC1 + SC2 |
| `"px draft with DEBUG set restores every demoted plumbing line"` | SC2 |
| `"px draft default output ends with a mission summary naming px active"` | SC3, SC4 |
| `"px draft default output keeps the live drafting-agent activity visible"` | SC5 |
| `"px draft keeps setup-helper warnings on the default path"` | SC6 |
| `"px draft failure path keeps the FAIL line, the repair hint and a non-zero exit"` | SC6 |
| `"px draft summary falls back to the slug when the mission file has no title heading"` | stop-rule fallback |
| `"px draft summary falls back to the slug when the mission file is missing"` | stop-rule fallback |
| `"px draft emits the worktree as the shell-init cd signal"` | regression guard |

Two findings surfaced while writing them:

1. **`Created .gitignore` needs a real git worktree.** `ensureWorkflowGitignore`
   is called directly rather than through a dep seam, so against the synthetic
   `/wt-tst` path it takes the `not a git repo (skipped)` branch and the line
   never fires — its absence would have proved nothing. It was split into its
   own test that `git init`s a temp worktree, so the demotion and the `DEBUG=1`
   restore are both genuinely exercised.

2. **`readMissionTitle` was too loose.** The parse reused from `intake` returned
   the file's first line verbatim when it was not a `# Mission:` heading, so a
   malformed mission file would have put junk in the summary instead of falling
   back. It now requires the heading and returns `ctx.slug` otherwise, matching
   the mission stop rule. No existing test pinned the loose behavior
   (`grep` over `test/` for intake title assertions returns none).

`Classification labels synced` from SC1 is not asserted: no such string exists
in `src/` (`grep -rn "Classification labels synced" src/` is empty), so its
default-output count is trivially 0 and asserting it would pin a phantom.

## Gate result

`./scripts/verify-local.sh all` — **2455 pass / 0 fail**, exit code 0.

An earlier run of this gate failed one test,
`test/task-2284-catalog-round-trip.test.ts` — "round trip is lossless across
every task record in backlog/tasks, backlog/completed, and backlog/archive/tasks":

```
'backlog/tasks/task-2473 -Wire-resumeReview-into-a-CLI-command-so-stopped-reviews-can-recover.md: re-serialization is not byte-identical'
```

The cause was **not** the filename. That record's frontmatter wrote its `labels`
block sequence at zero indentation:

```yaml
labels:
- ai_sdlc
- bug
- workflow
```

Every other block-form task record in the catalog indents its items by two
spaces, which is also the form `setTaskLabels` in
`src/adapters/backlog/task-metadata.ts` writes. Both the round-trip helper's
`BLOCK_ITEM` pattern in `test/helpers/task-2284-catalog-round-trip.ts` and
production's `parseTaskLabels` require at least one leading whitespace
character, so neither recognized the list and the labels were dropped. The
field-level diff could not catch it — the loss is symmetric, which is precisely
why that test also asserts byte equality.

Repaired by normalizing the record to the canonical two-space indentation. This
is a data-shape fix with no code change: no shared regex was loosened, so none
of the other 2454 tests were put at risk. It also repaired real production data
loss — `getTaskLabels` on that file returned `[]` before and now returns
`["ai_sdlc","bug","workflow"]`, so the record's classification labels were
invisible to `px` while it was stored that way.

Latent gap left in place deliberately: `parseTaskLabels` still drops a
zero-indent block sequence, which is valid YAML. Loosening that regex would
desynchronize it from the round-trip helper, which documents itself as
mirroring the spellings the production module accepts, and it is outside this
mission's scope. Worth its own ticket.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: zero internal-plumbing lines in default output | `"px draft default output omits every internal-plumbing line"`, `"px draft demotes the .gitignore plumbing line and DEBUG restores it"`, `test/draft.test.ts` | PASS |
| SC2: `DEBUG=1` restores every demoted line | `"px draft with DEBUG set restores every demoted plumbing line"`, `test/draft.test.ts` | PASS |
| SC3: summary carries title, agent, success marker, mission file, worktree | `"px draft default output ends with a mission summary naming px active"`, `test/draft.test.ts` | PASS |
| SC4: `px active` is the next action | `"px draft default output ends with a mission summary naming px active"`, `test/draft.test.ts` | PASS |
| SC5: live agent markers still on the default path | `"px draft default output keeps the live drafting-agent activity visible"`, `test/draft.test.ts` | PASS |
| SC6: warnings, FAIL line, repair hint and non-zero exit preserved | `"px draft keeps setup-helper warnings on the default path"`, `"px draft failure path keeps the FAIL line, the repair hint and a non-zero exit"`, `test/draft.test.ts` | PASS |
| SC7: no workflow/lifecycle/persistence change | `"runDraftCommand transitions task to backlog after setup completes"`, `"runDraftCommand materializes the Mission in SQLite before transitioning the Backlog task"`, `"runDraftCommand records the refine transition before the Backlog task reaches ready"`, `test/draft.test.ts`; the workflow `calls` deepEqual sequence in `test/draft-command.test.ts` is unchanged | PASS |
| SC8: pre-existing tests pass; only the stale noisy-output assertion changed | `./scripts/verify-local.sh all`; the sole edit is the `Draft setup complete` assertion in `test/draft-command.test.ts` (CP-2) | PASS |
| Mission stop rule: malformed/missing mission file falls back to the slug | `"px draft summary falls back to the slug when the mission file has no title heading"`, `"px draft summary falls back to the slug when the mission file is missing"`, `test/draft.test.ts` | PASS |
| `px shell-init` worktree cd signal preserved | `"px draft emits the worktree as the shell-init cd signal"`, `test/px-shell-init.test.ts` (`"px function follows a Working directory transition"`) | PASS |
| Gate ran green on the final tree | `./scripts/verify-local.sh all` — 2455 pass, 0 fail, exit code 0 | PASS |
| Inherited round-trip failure repaired at its root | `"round trip is lossless across every task record in backlog/tasks, backlog/completed, and backlog/archive/tasks"`, `test/task-2284-catalog-round-trip.test.ts` (5 pass, 0 fail); `getTaskLabels` on the repaired record returns `["ai_sdlc","bug","workflow"]` | PASS |
| No `.only` / bare `.skip` introduced | `grep -rn "\.only(\|\.skip(" test/draft.test.ts` returns no matches | PASS |
| Lint and typecheck clean on changed files | `npx eslint --max-warnings 300 src/` (the gate's lint scope, per `scripts/verify-local.sh`) exits 0; `npm run typecheck` clean. `npx eslint test/draft.test.ts` reports 10 pre-existing errors, all on lines above the appended TASK-2471 block and outside the gate's lint scope; no new lint error was introduced | PASS |

Next action: hand off to review with `./scripts/verify-local.sh all` green (2455/0, exit 0), flagging for a follow-up ticket that `parseTaskLabels` in `src/adapters/backlog/task-metadata.ts` silently drops a zero-indent YAML block sequence under `labels:`, which is what allowed `backlog/tasks/task-2473 -Wire-resumeReview-into-a-CLI-command-so-stopped-reviews-can-recover.md` to be stored with unreadable labels in the first place.
