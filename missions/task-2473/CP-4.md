# CP-4 — Resolved decision: `px review --continue` clears a `human-intervention` stop

## Feedback under review

The delivered `px review --resume` recovery was flagged as CLI bloat: there is
already a `--continue` flag, so a separate flag to recover a stopped review was
questioned, and the operator-facing cost of "why was it stopped"
(`--actor` attribution + cleared-reason audit event) was challenged. The
reviewer then confirmed: `px review --continue` should recover a stopped review,
attributed to the operator with zero ceremony.

## Decision

`px review --continue` clears a persisted `human-intervention` stop and then
relaunches the loop. `--resume` is kept for the explicit "I fixed it manually,
clear the flag and stop" intent. The two are complementary: `--continue`
relaunches, `--resume` only clears.

Why this is safe (and why the earlier pushback — the pre-image of this CP — was
overturned):

1. **`--continue` is only ever human-invoked.** Its only dispatch site is
   `ReviewCommandUseCase.dispatch` (`--continue` → `continue`,
   `src/application/review-command-use-case.ts:57`), reached via the
   `px review` CLI entry (`src/interfaces/cli/review.ts`). The
   claude/pi/opencode agent adapters push their *own* `--continue` flag
   (`src/adapters/agents/claude.ts`, `src/adapters/agents/pi.ts`,
   `src/adapters/agents/opencode.ts`); they never run `px review --continue`.
   So the "a stuck review resumes itself" risk behind `--resume`'s `--actor`
   boundary does not apply to `--continue`. A guard that cannot detect its
   trigger (`running-sessions.ts` shows a live `px review` process proves
   nothing about the role behind it) is dead code, so no guard is added.

2. **Attribution is to the operator, never the implementer.** The implementer
   is the agent that got stuck — in the task-2465 shape it is exactly the party
   that *requested* the intervention
   (`applyImplementerCommand` writes `requestedBy: 'implementer'`). Crediting it
   would let a stuck review resume itself, the very bug `--resume`'s `--actor`
   boundary exists to block. The operator is the human at the terminal, derivable
   from git config `user.name` with no flag. So `--continue` resolves the
   clearing actor as `--actor` (if given) → current git user → `operator`
   (fallback when git config is empty), never the stored implementer.

3. **The "why was it stopped" cost is a constraint, not fluff.** Clearing is a
   review-state mutation on a security boundary (reviews gate integration). The
   audit event is the trail an operator reads in `review-events/`. It is kept;
   only the ceremony (a required `--actor`) is removed for `--continue`.

## Work done

- `src/adapters/review/review-commands.ts`:
  - `clearHumanInterventionIfPresent(slug, args, options, { requireExplicitActor })`
    — the shared clearing primitive. Loads the named mission from the bound
    `MissionStore`, no-ops when the review is not in `human-intervention`
    (`reviewStatus` reports `approved` ahead of a stale intervention, so an
    approved review is never a candidate), otherwise applies `resumeReview`,
    persists the recovered domain review directly via `store.save` (the Review
    aggregate is the sole write authority, ADR 0053), and records a `human_note`
    audit event attributed to the resolved operator. `requireExplicitActor`
    selects the two attribution policies.
  - `continueReviewClearsIntervention(slug, args, options)` — the `--continue`
    entry point: calls the shared primitive with `requireExplicitActor: false`
    (git-user attribution, zero ceremony) and returns whether it cleared.
  - `resumeIntervenedReview` now routes through the same shared primitive with
    `requireExplicitActor: true`, so the explicit `--resume` path keeps its
    named-operator boundary and its existing tests stay green.
- `src/adapters/review/review-workflow-adapter.ts`: the `continue` operation
  calls `continueReviewClearsIntervention` before relaunching the loop, passing
  the `log`/`error`/`exit`/`resolveWorktreeFn`/`missionStore`/`createEventFn`/`runFn`
  seams.
- `src/application/rebound-kernel.ts`: the `artifact-incomplete` recovery
  dossier now says "rerun `px review <slug> --continue`" (was `px handoff`),
  which is the command that now clears the stop.
- `test/task-2473-resume-review-repro.test.ts`: three tests — `--continue`
  clears an intervened review attributed to the git user, falls back to `operator`
  when no git user resolves, and leaves a non-intervened review untouched.

## Gotcha fixed during delivery

The adapter's `continue` initially omitted the `exit` seam, so
`clearHumanInterventionIfPresent` fell back to `process.exit(1)` whenever no
`missionStore` was bound — killing the worker on every `--continue` with no
store (the review-command tests provide `startReviewLoopFn` but no
`missionStore`). Passing `exit: o.exit` restores the caller's exit handling.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `--continue` clears a `human-intervention` stop and relaunches the loop | `continueReviewClearsIntervention` → `clearHumanInterventionIfPresent` → `resumeReview` + `store.save` in `src/adapters/review/review-commands.ts`; `continue clears a human-intervention stop attributed to the git user` test in `test/task-2473-resume-review-repro.test.ts` | Pass |
| Attribution is to the operator, never the stuck implementer | git-user resolution (`user.name`) with `--actor`/`operator` fallback; `requireExplicitActor: false` for `--continue`, `true` for `--resume` | Pass |
| Non-intervened / approved reviews left untouched | `clearHumanInterventionIfPresent` guards `reviewStatus(review) !== 'human-intervention'`; `continue leaves a non-intervened review untouched` test | Pass |
| Existing review-command and workflow behaviour retained | `test/review-commands.test.ts` 30/30; `test/task-2332.14-review-use-case.test.ts`, `test/current-work-publication.test.ts`, `test/task-2373-repro.test.ts`, `test/task-2428-review-board-characterization.test.ts` all green | Pass |
| `--resume` boundary and reload-invariant tests still pass | `test/task-2473-resume-review-repro.test.ts` 13/13 (all `--resume` assertions unchanged) | Pass |
| Static analysis clean | `./scripts/verify-local.sh static-analysis`: ESLint, `tsc --noEmit`, test-hygiene, test typecheck all PASS | Pass |
| Mission gate passes | `./scripts/verify-local.sh all` exits 0 (2468 tests pass / 0 fail) | Pass |

## Next action

CP-5: transition the task from `ready-for-integration` to `review` and hand off
the `--continue` / `--resume` dual-surface review to `review` for approval;
confirm the `review-gate` and `integration-gate` exit zero on the final tree.
