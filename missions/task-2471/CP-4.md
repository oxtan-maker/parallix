# CP-4: Round 2 — the drafting run as one mission record

## Why a round 2

Round 1 (CP-1 … CP-3) suppressed the plumbing and appended a summary. The
operator review was that removing noise is not the same as delivering the
experience: what was left still read as a machine narrating its own steps.
Reconstructing the real run from `docs/assets/first-value-demo.cast` made the
remaining problems concrete — the recording, not the unit-test fixture, is what
an operator actually sees:

- the launch echo dumped the entire harness prompt (roughly 60 lines for
  `draft`) into the terminal before the agent said anything;
- the no-output watchdog announced `Still waiting on claude … last visible
  output 0s ago` while the agent was visibly streaming;
- four numbered `Step N:` lines narrated branch/worktree/scaffold/backlog work,
  then a fifth phase (the agent) ran unnumbered;
- the agent was announced twice (`Launching draft agent...`, then
  `Draft agent family: claude` after it finished);
- the routine end-of-draft fallback commit was reported as two `WARN` lines,
  which reads as trouble on every successful run;
- the summary never said how long the draft took, or which branch it is on.

## What the run looks like now

Default output, plumbing steps and agent stream elided:

```text
Drafting mission task-tst
  branch    mission/task-tst
  worktree  /wt-tst

Running codex to write the mission contract...
<the agent's own live output>

[PASS] Drafted task-tst in 12s: Improve px draft default terminal output
  contract  /wt-tst/missions/task-tst/MISSION.md
  branch    mission/task-tst
  agent     codex

[INFO] Working directory: /wt-tst
[INFO] Next: px active
```

## Changes

| Change | Where |
|---|---|
| Header replaces `Starting mission draft automation for:` and the four `Step N:` lines (those move to the DEBUG channel) | `src/adapters/cli/commands/draft-stats.ts` (`setup`, `scaffold`) |
| One pre-launch agent line replaces `Launching draft agent...` + `Draft agent family:` | `draft-stats.ts` (`launchAgent`) |
| Summary gains elapsed wall-clock time and the mission branch; `detailRows` replaces `fmt.table` so no line ends in whitespace | `draft-stats.ts` (`finalTransition`, `detailRows`) |
| Lifecycle/assignee bookkeeping demoted (`Task … transitioned to …`, `Enforcing draft agent … as assignee`); an agent fallback stays on the default path | `draft-stats.ts` (`transition`, `finalTransition`, `recordDraftImplementer`) |
| Routine fallback commit demoted from `WARN` to the plumbing channel; unexpected-dirty-file and shared-conflict warnings untouched | `src/adapters/cli/commands/draft-conflicts.ts` (`enforceDraftCommitSafety`) |
| Launch echo summarizes the prompt argument as `<prompt: n chars>`; `DEBUG=1` restores the verbatim command | `src/adapters/agents/agents.ts` (`startAgent`) |
| Watchdog tick suppressed while the output stream is younger than 15 s | `agents.ts` (`QUIET_STREAM_REPORT_MS`) |
| `branchName` carried on the draft context | `src/application/ports/cli-workflows.ts` |
| Shared behavior documented | `docs/agents.md` (Launch output watchdog, Launch echo) |
| Recorded consumer-requirement line numbers realigned after the `agents.ts` edits | `src/application/consumer-domain-requirements.ts` |

The last two shared changes (launch echo, watchdog) reach every `px` command
that launches an agent, not just `draft`. They are the two largest noise
sources on the drafting path and are not fixable inside `draft` presentation,
so `MISSION.md` was amended to take them in scope rather than shipping a draft
that is still unreadable in the demo.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC9: header up front, `Step N`/`Draft agent family` gone by default, restored under DEBUG | `"px draft opens by naming the mission and where it will live"`, `"px draft default output omits every internal-plumbing line"`, `"px draft with DEBUG set restores every demoted plumbing line"`, `test/draft.test.ts` | PASS |
| SC10: summary reports slug, elapsed time, title, contract, branch, agent | `"px draft default output ends with a mission summary naming px active"`, `"px draft reports how long the draft took"`, `test/draft.test.ts` | PASS |
| SC11: no emitted line ends in whitespace | `"px draft detail rows carry no trailing whitespace"`, `test/draft.test.ts` | PASS |
| SC12: routine harness commit demoted, real warnings and agent fallback kept | `"px draft demotes the routine safety-harness commit but keeps unexpected dirty files loud"`, `"px draft keeps an agent fallback visible while demoting assignee bookkeeping"`, `"px draft keeps setup-helper warnings on the default path"`, `test/draft.test.ts` | PASS |
| SC13: launch echo hides the prompt, DEBUG restores it | `"startAgent summarizes the prompt in the launch echo and restores it under DEBUG"`, `test/agents.test.ts` | PASS |
| SC14: no watchdog chatter while streaming; silence still reported | `"startAgent stays quiet while the agent is still streaming output"`, `"startAgent logs no-output diagnostics with agent, step, and child pid"`, `test/agents.test.ts` | PASS |
| SC5 (amended): the running agent is announced once before its output | `"px draft default output keeps the live drafting-agent activity visible"`, `test/draft.test.ts` | PASS |
| SC6/SC7: failure path, repair hint, non-zero exit, transition order unchanged | `"px draft failure path keeps the FAIL line, the repair hint and a non-zero exit"`, `"runDraftCommand materializes the Mission in SQLite before transitioning the Backlog task"`, `"runDraftCommand records the refine transition before the Backlog task reaches ready"`, `test/draft.test.ts`; the workflow `calls` deepEqual sequence in `test/draft-command.test.ts` is unchanged | PASS |
| `px shell-init` worktree cd signal preserved | `"px draft emits the worktree as the shell-init cd signal"`, `test/draft.test.ts`; `"px function follows a Working directory transition"`, `test/px-shell-init.test.ts` | PASS |
| Docs follow the shared behavior change | `./scripts/verify-local.sh docs` — PASS; `docs/agents.md` "Launch output watchdog" and "Launch echo" | PASS |
| Verification gate green on the final tree | `./scripts/verify-local.sh all` — 2455 pass, 0 fail, exit 0 | PASS |
| Lint, typecheck, test-hygiene clean | `./scripts/verify-local.sh static-analysis` — all four stages PASS, exit 0 | PASS |
| No `.only` / bare `.skip` introduced | `./scripts/verify-local.sh static-analysis` test-hygiene stage PASS | PASS |

Not done, deliberately: the README asciinema recording is not re-recorded — it
is out of scope in `MISSION.md`, and the `.cast` in `docs/assets/` still shows
the pre-change output.
