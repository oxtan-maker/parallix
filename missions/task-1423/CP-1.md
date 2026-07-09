# CP-1: Trace review parity, audit draft/active, close the test-coverage gap

## Summary

Investigation confirmed that `px draft --agent <family>` and `px active --implementer <family>`
already implement the full override contract this mission asked for, and that the
operator docs already describe the precedence rules — none of this was added by
this checkpoint. Per the mission's Risks section ("the repository may already
contain part or all of this behavior... close the remaining gap with tests/docs
only") and the Stop Rules, the only real gap was test coverage: no test exercised
the `--agent` / `--implementer` CLI flags directly against `runDraftCommand` /
`active()`. This checkpoint adds that direct coverage. `selectAgent`/`startAgent`
and all `lib/review/**` behavior outside the one line below were untouched.

**Round 5 correction:** the round-5 reviewer (codex) correctly flagged that an
earlier version of this checkpoint claimed `lib/review/**` was entirely
untouched, which was inaccurate. `lib/review/review-commands.ts:407` does
differ from the mission base (`ccfcc19d3d65a74c2b5d4fc9b9fa397bf96504ce`) by
one wording change in a findings-message string. That edit is not new scope
creep: it fixes a pre-existing mismatch between this source string and the
assertion in `test/review-commands.test.js:166` (`performStaticReview rejects
placeholder-only Goal Check evidence rows`) — a test file that is byte-identical
to the mission base (`diff` against `git show
ccfcc19d3d65a74c2b5d4fc9b9fa397bf96504ce:test/review-commands.test.js` is
empty) and whose assertion already failed against the mission-base source
wording before this mission started. Reverting the wording edit was verified to
reintroduce that `verify-local.sh all` failure; the edit is required to keep
the mission's own declared gate green and is scoped to a single string literal,
not a behavioral or policy change to `selectAgent`/`startAgent`/review-loop
semantics. `npm run build:cjs` was re-run so the compiled
`lib/review/review-commands.js` matches the `.ts` source. The Goal Check
evidence below is updated to reflect this accurately.

Findings from the audit:

- `lib/commands/draft.ts:140-151` already parses `--agent` via a local `flagValue`
  helper, prints `Usage: px draft <slug> --agent <family>` and exits 1 on a
  missing value, and threads `preselectedAgent` into agent selection at
  `lib/commands/draft.ts:278` (`agent = preselectedAgent || selectAgentFn(...)`),
  which is what reaches `startDraftAgentFn` at `lib/commands/draft.ts:283-288`.
- `lib/commands/active.ts:50-62` mirrors this for `--implementer`, printing
  `Usage: px active <slug> --implementer <family>` on a missing value, and
  threads `preselectedImplementer` into `selectLaunchAndRecordFn` at
  `lib/commands/active.ts:90-97` as `preselectedAgent`.
- Fallback bookkeeping already matches the requested contract: `draft.ts`'s
  `recordDraftImplementer` (`lib/commands/draft.ts:382-420`) records the agent
  that `startDraftAgentFn` actually returned (`actualAgent`), not the
  preselected one, and calls `enforceTaskAssignee` with it. `active.ts`'s
  `selectLaunchAndRecord` (`lib/commands/active.ts:171-265`) records the
  implementer from `startAgent`'s `onLaunch` callback (the actually-launched
  family after any limit-hit fallback), independent of `preselectedAgent`.
  `applyExecuteFallback` (`lib/commands/active.ts:272-291`) additionally
  re-records the resolved agent if it diverges from what was preselected.
- `docs/agents.md:87-99` already documents `px draft task-XXX --agent codex`,
  `px active task-XXX --implementer claude`, and states the flags "take
  precedence over both the config and random selection" with `WORKFLOW_AGENT`
  as the fallback — matching the mission's success criteria on docs verbatim.
- `px review --reviewer/--implementer` (`lib/review/review-commands.ts:1513-1514`)
  was not touched. The only `lib/review/**` diff against the mission base is
  the single-line findings-message wording fix at
  `lib/review/review-commands.ts:407`, described above; it does not affect
  `--reviewer`/`--implementer` parsing, review-loop identity persistence, or
  review-state semantics.

Work done this checkpoint: added direct command-level tests to
`test/draft-command.test.js` and `test/active.test.js` that exercise the CLI
flag path end-to-end (bypassing `selectAgentFn`, asserting the override reaches
the launcher, and asserting the fallback-to-recorded-agent behavior), plus
missing-value tests asserting exit code 1 and the exact usage strings named in
the mission's success criteria.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| `px draft <slug> --agent <family>` bypasses random selection and reaches the draft launch path | `lib/commands/draft.ts:140-151` (flag parsing), `lib/commands/draft.ts:278` (`agent = preselectedAgent \|\| selectAgentFn(...)`), `lib/commands/draft.ts:283-288` (launcher call) | PASS |
| Missing `--agent` value exits non-zero with usage text `px draft <slug> --agent <family>` | test `runDraftCommand exits non-zero with usage text when --agent is missing its value` — `test/draft-command.test.js:465-480` | PASS |
| Direct draft test proves the override reaches the launcher without `WORKFLOW_AGENT` | test `runDraftCommand honors an explicit --agent override without consulting selectAgentFn or WORKFLOW_AGENT` — `test/draft-command.test.js:414-463` | PASS |
| `px active <slug> --implementer <family>` bypasses random selection and reaches the execute launch path | `lib/commands/active.ts:50-62` (flag parsing), `lib/commands/active.ts:90-97` (`preselectedAgent: preselectedImplementer` passed to `selectLaunchAndRecordFn`) | PASS |
| Missing `--implementer` value exits non-zero with usage text `px active <slug> --implementer <family>` | test `active() exits non-zero with usage text when --implementer is missing its value` — `test/active.test.js:271-285` | PASS |
| Direct active test proves the override reaches the launcher without `WORKFLOW_AGENT` | test `active() honors an explicit --implementer override without consulting WORKFLOW_AGENT` — `test/active.test.js:234-269` | PASS |
| Bookkeeping records the family that actually launched, not merely the requested one | `lib/commands/draft.ts:382-420` (`recordDraftImplementer` uses `actual`, not `selected`); `lib/commands/active.ts:171-265` (`selectLaunchAndRecord` records via `onLaunch`); regression test `selectLaunchAndRecord records the fallback agent when startAgent falls back from preselected` — `test/active.test.js:949` | PASS |
| Operator docs state the supported draft/active override commands and their precedence over config and `WORKFLOW_AGENT` | `docs/agents.md:87-99` | PASS |
| No regression on `px review --reviewer/--implementer` | `git diff ccfcc19d3d65a74c2b5d4fc9b9fa397bf96504ce -- lib/review/review-commands.ts` shows only the one-line findings-message wording fix at `lib/review/review-commands.ts:407`; `--reviewer`/`--implementer` parsing at `lib/review/review-commands.ts:1513-1514` is unchanged, and `test/review-commands.test.js` (byte-identical to the mission base) passes: `node --test test/review-commands.test.js` — 20/20 PASS | PASS |
| Full verification gate | `./scripts/verify-local.sh all` — 2067 passed, 0 failed, 22 skipped; `./scripts/verify-local.sh static-analysis` — ESLint/tsc/test-hygiene all PASS | PASS |

Full verification: `./scripts/verify-local.sh all` (2067 passing, 0 failing, 22
skipped) and `./scripts/verify-local.sh static-analysis` (ESLint, tsc,
test-hygiene all PASS), both re-run after restoring the
`lib/review/review-commands.ts:407` wording fix.

Next action: Commit this corrected checkpoint (accurate `lib/review/**`
evidence) and hand off for review; no further implementation work is needed
since the CLI override behavior and docs already satisfied the mission before
this checkpoint, and the one `lib/review/review-commands.ts` line is a
pre-existing-gate-fix, not new scope.
