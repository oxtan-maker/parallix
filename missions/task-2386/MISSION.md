# Mission: Make agent handoff prompts completion-safe (task-2386)

Base-Branch: friday-08-21

## Goal
Make every agent-side prompt that shells out during a handoff, rebase conflict,
or rebound unambiguously completion-safe: the agent must run the listed commands
now, verify their result, and emit a final completion report only after the
rebase and every required check actually succeed — never a plan-only or
inspect-and-describe response. In parallel, make the no-output liveness
watchdog observational for the full agent lifetime: it keeps emitting periodic
liveness reports until the agent result settles, including after the first
visible assistant text, and never kills, times out, or cancels an agent.

## Why Now
During TASK-2385 handoff the custom Pi resolver identified the correct shared-file
resolution and announced "Stage + continue" but did not run the commands or
terminate; the handoff then waited indefinitely for an agent result that never
came. The prompts currently invite a description instead of an execution, and the
watchdog goes silent the moment the agent speaks the first time, so a later stall
while a tool or session stays active produces no liveness signal. This mission
closes both gaps.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: regression (handoff hung with no liveness), prompt completion contract, watchdog liveness gap, AC #2/#3/#4 focused tests

## Scope
- In scope
  - Review every agent-side prompt that requires shell work during handoff, rebase conflict, or rebound:
    - `src/application/rebase-workflow.ts` `buildRebasePromptPolicy` / `buildRebasePrompt` (shared-file rebase-conflict prompt, lines ~145–190)
    - `src/adapters/cli/commands/resolve-conflict.ts` conflict-resolution prompt (lines ~15–45)
    - `src/application/rebound-kernel.ts` `buildFixPrompt` / `promptSlotsFor` fix-prompt builder (lines ~240–370)
    - handoff bounce messaging in `src/application/handoff-command-use-case.ts` (shared-file conflict bounce, line ~780)
  - Introduce one concise, shared "completion contract" phrasing (execute now → verify → report completion only after success → report and stop on failure) and reuse it across the prompts above instead of per-prompt prose.
  - Fix the no-output watchdog so it stays observational and keeps periodic liveness reporting until the agent result settles, even after the first visible output:
    - `src/adapters/process/spawn-tee.ts` `scheduleWatchdog` / `noteOutput` (current `if (settled || sawOutput) return;` suppresses later reports)
    - `src/adapters/agents/pi.ts` watchdog wiring (lines ~300–340)
    - `src/adapters/agents/agents.ts` `startAgent` watchdog config pass-through (lines ~467–520)
  - Add focused tests: a shared-conflict resolver prompt test (AC #2), a watchdog observational / never-kill test (AC #3), and a launcher test covering output-then-still-running with later liveness reports (AC #4).
  - Update any prompt/workflow docs that describe handoff or watchdog behavior.

## Out of Scope
- No changes to git/rebase core logic, conflict auto-resolution strategy, or `--theirs` semantics.
- No changes to agent launchers beyond the observational watchdog pass-through.
- No new CLI commands, no new configuration surface, no new dependencies.
- No changes to the no-output watchdog's timing constants' intent (still observational); only its suppression-after-first-output behavior changes.
- No handling of missions or prompts outside the agent-side shell-work set listed above.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC1 Every prompt in scope states the completion contract: execute the listed commands now; report completion only after their required verification succeeds; report and stop on a command failure. Verified by grepping the four prompt sites for the contract language and by the AC #2 focused test.
- SC2 The shared-file rebase-conflict prompt in `src/application/rebase-workflow.ts` directs the agent to execute `git add "<file>"` and `git rebase --continue` (not only to inspect/describe). Verified by `test/rebase.test.ts` matching `git add` and `git rebase --continue` in `buildRebasePrompt` output.
- SC3 The liveness watchdog is observational and never kills, times out, or cancels an agent. Verified by asserting the watchdog path contains no `kill`/`exit`/`terminate`/`cancel` call and by the AC #3 focused test; no launcher is aborted by the watchdog.
- SC4 After the first visible output, a still-running agent still receives periodic liveness reports until it settles. Verified by `test/spawn-tee.test.ts` (or `test/pi-runner.test.ts`) emitting output then keeping the child open and asserting a later `onNoOutput` fires.
- SC5 `./scripts/verify-local.sh static-analysis` passes on the final tree.
- SC6 No focused or unannotated skipped tests introduced (no `.only`, no bare `.skip`).

## Risks and Assumptions
- The watchdog currently stops after `sawOutput`; changing this may increase INFO log volume for normally-chatty agents. Assume a bounded cadence (existing `intervalMs`) is acceptable; watch log noise in the smoke test.
- Reusing a single completion contract across prompts assumes the four sites share the same terminal-condition intent; the rebase-conflict prompt already has a per-file "stop and report" rule, so the shared contract must not weaken it.
- The fix-prompt builder in `rebound-kernel.ts` is context-compaction sensitive; adding contract text must not exceed the mission change-size budget (ADR 0047).
- Assumption: the reproduction is observable via the watchdog unit seam (spawn-tee), not via a full handoff integration run, which is why AC #4 targets the launcher level.

## Checkpoints
- CP 1: Author a failing reproduction test that locks the watchdog-liveness regression before any fix (red).
- CP 2: Apply the shared completion contract to the four prompt sites and confirm the rebase-conflict prompt still commands `git add` + `git rebase --continue`.
- CP 3: Fix the watchdog to remain observational and keep reporting until the agent settles, with no kill/exit/terminate path.
- CP 4: Add AC #2, AC #3, AC #4 focused tests; run the full gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/rebase.test.ts` ``, `` `npm test -- test/spawn-tee.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — must match a test name in the repo, e.g. `"buildRebasePrompt contains mission-specific and shared file sections"` (in `test/rebase.test.ts`) or `"spawnAndTee reports no-output intervals until the child writes output"` (in `test/spawn-tee.test.ts`)
  3. **Test file paths** — e.g., `test/rebase.test.ts`, `test/spawn-tee.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. A raw `grep`/`ls` dump alone is not sufficient evidence: pair it with a test name, test file path, recognized repo command, or ADR reference. This exists because weak agents hand over `ls`/`stat` output or generic "the test passes" prose and expect it to count — it does not.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Shared-conflict prompt commands execute, not describe | `test/rebase.test.ts`, `"buildRebasePrompt contains mission-specific and shared file sections"` matches `git rebase --continue` | PASS |
| Liveness watchdog remains observational | `test/spawn-tee.test.ts`, `grep -n 'kill\|exit\|terminate' src/adapters/process/spawn-tee.ts` empty | PASS |
| Verification gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify git/rebase core, conflict auto-resolution, or `--theirs` logic in `src/application/rebase-workflow.ts` beyond the prompt string it builds.
- Do not add launchers, CLI commands, configuration keys, or dependencies.
- Do not change the no-output watchdog timing constants' intent; only its suppression-after-first-output behavior.
- Do not touch unrelated prompt families (draft, portfolio, review, act-on-review) unless they also shell out during a handoff/rebase/rebound and are in scope.

## Stop Rules
- Stop after the reproduction test is red and the four prompt sites + watchdog are updated, focused tests are green, and `./scripts/verify-local.sh static-analysis` passes.
- Stop if a change would touch git/rebase core, launchers, or add dependencies — escalate instead of expanding scope.
- Stop drafting; do not implement, review, or integrate. This is a draft-only mission contract.

Reproduction-Test: test/spawn-tee.test.ts
