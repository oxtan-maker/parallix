# Mission: Improve px draft default terminal output (task-2471)

## Goal
Refine only the default terminal output of `px draft` so a first-time operator can read, without filtering, what mission was created, inspect it before execution, and know the next action. On the success path the command must end with a compact mission-oriented summary that surfaces the mission identity/title, the drafting agent, a completed-success indication, the mission file/path, the mission worktree, and `px active` as the next action — while demoting the internal plumbing lines (SQLite persistence, Backlog sync, base-branch record, graphify workspace, .gitignore maintenance, stats recording, label sync) from the default happy-path output so they appear only under the existing `DEBUG` env-var mode (`fmt.log.debug`). The live drafting-agent activity during the run must stay visible, and all warnings, failures, fallbacks, and exit-coded errors must remain on the default path unchanged.

Round 2 (operator review of the round-1 delivery): suppressing plumbing was necessary but not sufficient — what remained was still a machine narrating itself. The whole drafting run, opening line to closing summary, must read as the record of one mission: the mission and where it will live stated up front, one line naming the agent that writes the contract, the agent's own live output in between, and a closing summary that adds elapsed wall-clock time and the mission branch. The two loudest remaining noise sources on that path are shared with every other command and are in scope for that reason: the launch echo dumps the entire harness prompt (hundreds of lines) into the terminal, and the no-output watchdog reports "still waiting" while the agent is visibly streaming.

## Why Now
This is part of the trust-layer repositioning and the README first-run demo. The README demo runs `px draft "create a hello world program"` and replays it via asciinema; today the default output is dominated by internal implementation steps (branch/worktree/graphify/SQLite/label lines), which distracts a first-time operator from the mission result. The demo must still show the drafting agent working (asciinema replay timing handles fast-forwarding idle waits separately — out of scope here), so the fix is presentation-only: quiet the plumbing, elevate the mission result.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: trust-layer repositioning, README first-run demo legibility, `px draft` happy-path summary currently emits only `Next: cd <worktree>` instead of a mission-oriented summary.

## Scope
- Change only the terminal presentation/reporting of `px draft` (`src/adapters/cli/commands/draft-stats.ts` `createDraftWorkflowAdapter` steps and the `finalTransition` summary; any supporting helper in `src/application/presentation/cli-format.ts` needed for the summary).
- Demote internal-plumbing `logFn(fmt.status('PASS'/'INFO', ...))` lines emitted on the success path to `fmt.log.debug(...)` (gated by `process.env.DEBUG`), keeping the exact same callsites and messages — only the transport changes.
- Replace the final `Next: cd <worktree>` summary with a compact mission summary block that includes: the mission identity/title, the drafting agent family, a completed-success indication, the mission file path, and the mission worktree path, followed by the next action `px active`.
- Keep live agent-activity lines visible during the run (e.g. "Launching draft agent...", "Draft agent family: ...", the agent's own streamed output).
- Preserve all warnings, failures, fallbacks, non-zero exits, and repair hints on the default path — these already use `errorFn`/`fmt.status('WARN')` and must not be demoted.
- Ensure `DEBUG=1` surfaces the previously-default plumbing lines so no operator-visible information is permanently lost.
- Update/add focused tests under `test/` for the new default-output contract and the `DEBUG` demotion, covering both the success summary and that failure/fallback output remains visible.

Round 2 additions:
- Replace the four numbered plumbing steps (`Step 1: Setting up branch` … `Step 4: Ensuring Backlog task exists`) and the `Starting mission draft automation for:` opener with one operator-facing header: the mission being drafted plus the branch and worktree it will occupy.
- Collapse `Launching draft agent...` + `Draft agent family: <family>` into one pre-launch line naming the agent that writes the contract.
- Add elapsed wall-clock time and the mission branch to the closing summary.
- Demote the routine safety-harness fallback commit and the lifecycle/assignee bookkeeping (`Task <slug> transitioned to …`, `Enforcing draft agent … as assignee`) to the plumbing channel, keeping the unexpected-dirty-file and shared-conflict warnings and the agent-fallback line on the default path.
- Summarize the prompt argument in the shared launch echo (`src/adapters/agents/agents.ts`) rather than echoing it verbatim, with `DEBUG=1` restoring the full command.
- Suppress a no-output watchdog tick while the agent's output stream is still moving (report only once the last visible output is at least 15 s old).
- Update `docs/agents.md` for the two shared behavior changes above.

## Out of Scope
- `px active` output.
- `px integrate` output.
- `px diff` behavior or output.
- `px stats` or telemetry schema/storage.
- Replay-speed editing beyond what `scripts/retime-first-value-demo.mjs` already applies; any change to the README's prose or structure. (Round 2: documentation is no longer out of scope — the shared watchdog and launch-echo behavior described in `docs/agents.md` changes, so that document must follow. Re-recording `docs/assets/first-value-demo.cast` and re-rendering its GIF with the existing `scripts/record-first-value-demo.sh` / `scripts/render-first-value-demo.mjs` is in scope on operator request: the checked-in demo is the README's first impression and shows the pre-change output until it is re-run.)
- New lifecycle concepts or a general reporting framework.
- Changes to agent prompts or mission drafting semantics except where strictly required to present existing results.
- Workflow/lifecycle/state changes: draft workflow steps, lifecycle transitions, agent selection/failover, mission contents, SQLite persistence, telemetry collection, worktree/branch creation.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no subjective adjectives or vague quantifiers.

1. On a successful `px draft` run with `DEBUG` unset, the default output does not contain any of the internal-plumbing status lines: `Mission materialized in SQLite`, `Created .gitignore`, `Recorded <Base-Branch line>`, `graphify-out directory`, `Post-draft mission type labels validated`, `Classification labels synced`, `Created branch`, `Created worktree`, `Scaffolded MISSION.md`, `Draft setup complete`. (Count of these lines in default output == 0.)
2. On the same run with `DEBUG=1`, the default output contains all of the above plumbing lines (count == the count emitted on the pre-change tree), proving the lines were demoted, not deleted.
3. On a successful run, the final summary block contains the mission identity/title (the `# Mission: <title>` line from the mission file), the drafting agent family string (e.g. `codex`/`claude`/`gemini`), a completed-success indication (a line whose text contains `complete` or `success` or a `PASS`/`INFO` marker), the mission file path (the `missionFile` value), and the worktree path (the `targetWorktree` value).
4. On a successful run, the final summary contains `px active` as the next action (a line whose stripped text contains the token `px active`).
5. During the run (DEBUG unset), the output still announces the running agent before its live output: a line matching `Running <family> to write the mission contract`.
6. On a failure path (e.g. draft agent exits non-zero, or intake unavailable), the default output still contains the `FAIL` error line and the repair hint, and the process exits non-zero — unchanged from the pre-change behavior.
7. No workflow/lifecycle/persistence behavior changes: `test/draft.test.ts` transitions still occur in order (backlog → refined → ready), intake still runs before any Backlog task transition, and the refine transition is recorded before the Backlog task reaches ready.
8. All pre-existing tests in `test/draft.test.ts` pass unchanged except assertions that intentionally assert the old (noisy) default output, which are updated to the new contract.
9. With `DEBUG` unset, the first three non-empty lines of a successful run are `Drafting mission <slug>` followed by the `branch` and `worktree` detail rows; the strings `Step 1: Setting up branch`, `Step 2: Ensuring dedicated worktree`, `Step 3: Scaffolding MISSION.md`, `Step 4: Ensuring Backlog task exists` and `Draft agent family` appear zero times, and `DEBUG=1` restores all four `Step` lines and `Draft agent family`.
10. The closing summary line matches `[PASS] Drafted <slug> in <elapsed>: <title>` and the summary rows name the mission contract path, the mission branch, and the agent family.
11. No line emitted by a successful `px draft` run ends in whitespace.
12. The routine safety-harness fallback commit does not appear in default output; the unexpected-dirty-files `WARN` and an agent fallback (`fell back from <a> to <b>`) still do.
13. `startAgent`'s launch echo contains `<prompt: <n> chars>` and no prompt body with `DEBUG` unset, and the verbatim prompt with `DEBUG=1`.
14. A launch whose child writes output continuously emits no `Still waiting on <family>` watchdog line; a silent launch still emits `No output yet from <family>`.
15. `px draft` announces the mission identity it actually uses: for free-text intake the header names the allocated `parallix-adhoc-<NNNN>` slug, not the pre-allocation placeholder.
16. A successful draft emits no `capturing unexpected dirty files` warning for the mission's own artifacts: an untracked ancestor directory of the mission dir (`missions/`) and the harness's own `.gitignore` edit classify as expected.
17. `docs/assets/first-value-demo.cast` is re-recorded against this tree, and its rendered GIF shows the recorded lines rather than overlapping spinner redraws.
18. The closing summary prints the contract's Goal (first paragraph, wrapped, at most 6 lines) and its shape — success-criteria, checkpoint and gate counts plus the NEL bucket — so the operator learns what the implementer is held to without opening a pager. A contract with no Goal section prints no Goal block and the summary still ends with `px active`.
19. The rendered demo GIF keeps the terminal's colours and monospaced columns.

## Risks and Assumptions
- Assumption: demoting plumbing to `fmt.log.debug` is acceptable to operators; if an operator relied on the default PASS lines, `DEBUG=1` recovers them. Marked as a corner with a known ceiling — see `ponytail:` note in code.
- Risk: the summary must read the mission title from the mission file; if the file is absent or malformed, fall back to `ctx.slug` (already the intake behavior). Do not introduce a new failure mode.
- Risk: over-demoting. Lines emitted via `errorFn` or `fmt.status('WARN')` on exceptional paths must not be demoted. Only demote success-path `logFn(fmt.status('PASS'/'INFO', ...))` plumbing lines named in SC1.
- Assumption: `fmt.log.debug` correctly gates on `process.env.DEBUG` (existing behavior in `cli-format.ts`); no new verbose mechanism introduced.
- Risk: tests must not spawn a real draft agent or hit the network/SQLite; use the existing injected-deps seam (`runDraftCommand` with `startDraftAgentFn`, `missionServicesFn`, etc.).

## Checkpoints
- CP 1: Demote success-path internal-plumbing lines to `fmt.log.debug` (DEBUG-gated) in `draft-stats.ts` without touching messages or call order.
- CP 2: Replace the `finalTransition` summary with the compact mission-oriented summary block (identity/title, agent, success, mission file path, worktree path, `px active`).
- CP 3: Add focused output-contract tests (success summary + DEBUG demotion + failure/fallback visibility) and update any pre-existing test asserting the old noisy default output.
- CP 6 (round 2): Print the contract digest in the summary, and restore colour and monospaced columns to the rendered demo.
- CP 5 (round 2): Re-record the first-value demo against this tree, fixing what the recording exposed: the free-text header naming the pre-allocation slug, the bogus unexpected-dirty-file warning, and a GIF renderer that dropped carriage returns and rendered every spinner redraw on top of itself.
- CP 4 (round 2): Rebuild the whole drafting run as one mission record — operator header, single agent line, elapsed-time summary with the branch, demoted lifecycle/harness bookkeeping — plus the two shared fixes (prompt-free launch echo, quiet watchdog while streaming), their tests, and the `docs/agents.md` update.

### Checkpoint Documentation Requirements
Lead with durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...` (for example, `test/draft.test.ts` and `./scripts/verify-local.sh all`). File:line references are accepted when necessary but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:

- A summary of work done.
- The exact heading `## Goal Check`.
- This exact 3-column table header: `| Criterion | Evidence | Status |`.
- At least one durable evidence row per success criterion, naming the focused `test(...)` case(s) in `test/draft.test.ts` or a new test file, the relevant test path, and the repository command run. Cite an ADR only when it genuinely constrains the change.
- A concrete `Next action:` line at the bottom.

Raw `stat`/`ls` output or generic prose alone is not enough. If shell output is included, pair it with one of the accepted references above; do not claim that output "looks better" without a test name, test path, ADR reference, or recognized command/path.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `px active`, `px integrate`, `px diff`, `px stats`, or any telemetry/storage code.
- Do not modify the draft workflow step sequence in `src/application/draft-command-use-case.ts` (the nine-step order) or the `DraftWorkflowPort` shape in `src/application/ports/cli-workflows.ts`.
- Do not change agent prompts (`draft-prompts.ts`), mission drafting semantics, or the `buildDraftPrompt`/`buildRestartPrompt` output contract beyond what is required to present existing results.
- Do not add new dependencies, new verbose/env modes, or a general reporting framework.
- Do not touch README, asciinema, or any documentation/rendering assets.
- Do not modify the backlog task `assignee` field.

## Stop Rules
- Stop if presenting the mission summary requires reading data that the draft workflow does not already expose on `ctx` (e.g. a resolved human title that was never captured) — fall back to `ctx.slug` and note the ceiling, rather than extending the workflow.
- Stop demoting any line that carries `errorFn` or `fmt.status('WARN')`; those are operator-relevant exceptional conditions.
- Stop if a pre-existing `test/draft.test.ts` assertion cannot be reconciled with the new contract without changing workflow/lifecycle behavior.
- Do not run anything beyond the single `./scripts/verify-local.sh all` gate during drafting.
- Do not implement the fix if this is still the draft phase — this document is the only deliverable; the reproduction/implementation happens on execution.
