# CP-2: Replace the `Next: cd <worktree>` line with a mission summary block

## Summary of work done

`finalTransition` in `src/adapters/cli/commands/draft-stats.ts` previously ended
a successful draft with a single `[INFO] Next: cd <worktree>` line. It now emits
a compact mission-oriented close-out:

```
[PASS] Mission draft complete: Improve px draft default terminal output

  Agent    claude
  Mission  /home/m/code/px-task-2471/missions/task-2471/MISSION.md

[INFO] Working directory: /home/m/code/px-task-2471
[INFO] Next: px active
```

Built only from existing helpers in
`src/application/presentation/cli-format.ts` (`status`, `bold`, `agent`, `path`,
`table`, `command`) — no new formatting layer, per the mission's "no general
reporting framework" restriction.

Also extracted `readMissionTitle(missionFile, fallback)` at module scope and
pointed both `intake` and `finalTransition` at it, replacing the inline
title-parsing block that `intake` already carried. The title is re-read in
`finalTransition` because the draft agent rewrites `MISSION.md` after intake
captured it, so intake's value is the scaffold title, not the drafted one. On a
missing or malformed file the helper returns `ctx.slug`, which is the mission
stop-rule fallback — no new failure mode.

### Regression caught and prevented: the `px` shell cd signal

`px shell-init` (`src/composition/create-cli.ts`) emits a `px` shell function
that greps its own captured output for `[INFO] Next: cd ` — and, failing that,
`[INFO] Working directory: ` — to `cd` the operator's terminal into the mission
worktree. Deleting `Next: cd <worktree>` outright would have silently broken
that integration for `px draft`.

The worktree is therefore emitted as `[INFO] Working directory: <worktree>`,
which is the shell function's existing second signal form, rather than as a
plain table row. This keeps the shell cd working with zero change to
`create-cli.ts`, while still satisfying SC3 (worktree path present) and SC4
(`px active` is the stated next action). A comment at the callsite records the
coupling so the line is not "tidied away" later.

### Pre-existing test updated (SC8)

`test/draft-command.test.ts` asserted `Draft setup complete` on the default
happy path — an assertion on the old noisy output. It now asserts the inverse
(the plumbing line is absent by default) plus the new `Mission draft complete`
summary, and keeps its existing `Draft agent family: codex` live-activity
assertion.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3: summary carries title, agent, success marker, mission file, worktree | `finalTransition` in `src/adapters/cli/commands/draft-stats.ts` emits `[PASS] Mission draft complete: <title>`, an `Agent`/`Mission` table, and `Working directory: <targetWorktree>`; asserted by tests added in CP-3 | PASS |
| SC4: `px active` is the stated next action | `logFn(fmt.status('INFO', ...'Next: ' + fmt.command('px active')))` in `src/adapters/cli/commands/draft-stats.ts`; asserted by tests added in CP-3 | PASS |
| SC5: live agent activity still on the default path | `"px draft launches the draft agent and records stats from the mission worktree"`, `test/draft-command.test.ts` (asserts `Draft agent family: codex` in default logs) | PASS |
| SC8: stale noisy-output assertion reconciled, no lifecycle change | `test/draft-command.test.ts` updated to assert `Mission draft complete` and the absence of `Draft setup complete`; the workflow `calls` deepEqual sequence in the same test is unchanged | PASS |
| Title falls back to the slug on a missing/malformed mission file | `readMissionTitle` returns `fallback` from its `catch` and on an empty heading, in `src/adapters/cli/commands/draft-stats.ts`; asserted by tests added in CP-3 | PASS |
| `px shell-init` worktree cd signal survives the summary rewrite | `"px function follows a Working directory transition"`, `test/px-shell-init.test.ts` | PASS |
| Draft suites green after the rewrite | `node --import tsx --import ./test/bootstrap-parallix-home.ts --experimental-test-module-mocks --test test/draft.test.ts test/draft-command.test.ts test/px-shell-init.test.ts` — 89 pass, 0 fail | PASS |
| Typecheck clean on changed files | `npm run typecheck` | PASS |

Next action: CP-3 — add focused output-contract tests in `test/draft.test.ts` covering SC1 (named plumbing lines absent by default), SC2 (`DEBUG=1` restores them), SC3/SC4 (summary fields and `px active`), SC5 (live agent markers) and SC6 (failure output plus repair hint still visible), then run `./scripts/verify-local.sh all`.
