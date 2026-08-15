---
id: TASK-2377
title: >-
  Consolidate agent rebound onto one verified kernel with per-failure budgets
status: backlog
assignee: []
created_date: '2026-08-15'
labels: [ai_sdlc]
dependencies: []
ordinal: 97912
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Investigation of the task-2369.13 incident (flaky unit gate misclassified as a Git hook failure, implementer "relaunched" with no evidence of a fix) found that agent rebound is fragmented across nine separate implementations, each with its own classification regexes, prompt builders, retry caps, and post-bounce verification behavior.

Current state (invariants this wave must fix):

1. **Nine bounce paths**: pre-review gate auto-bounce, pre-review rebase hook bounce (parent-side), CLI `px rebase` hook bounce, CLI `px integrate` squash hook bounce, a dead duplicate integrate implementation, handoff-time checkpoint relaunch, handoff-time gate relaunch, review-loop artifact/timeout recovery relaunches, and launcher-level family failover.
2. **Classification is regex-on-combined-text in four places**: a canonical `classifyHookFailure`, two copied hook regexes (pre-review rebase, pre-review gate handling), and the ADR-0048 classifier whose output is overridden twice in the pre-review gate path (an ad-hoc human-only regex, then a remap that relabels every non-hook gate failure as a Git blocker). The ADR-0048 `GateFailure` class is effectively dead in that path.
3. **The pre-review rebase spawns a nested `px rebase` CLI subprocess.** The parent can only see combined stdout text, so a genuine gate failure whose output contains hook-like words (a full unit-suite run does) is misclassified as a hook failure, consuming the wrong budget and sending the wrong fix prompt. The nested CLI also bounces internally from the same persisted counter, so two processes split one budget without either knowing what the other consumed.
4. **Retry state is dual-persisted**: review-state.json metadata counters and SQLite `mission_reviews` columns, synced both ways, while the domain's `recordGateFailureRetry`/`recordHookFailureRetry` methods are called nowhere.
5. **Most bounces are unverified claims.** The pre-review hook path launches the agent and returns without re-running anything. Only some paths re-run the failing check. `startAgent` also treats an ambiguous null exit status as success, so "relaunched" is logged even when the launch outcome is unknown.
6. **The SC20 shutdown test flakes for a structural reason**: Ink enables PTY raw mode in an effect after the first frame paints; a Ctrl+C arriving before that is converted by the line discipline into SIGINT to the shared foreground process group; the board registers no SIGINT handler anywhere, so the process dies by signal and the harness's outer shell (WCE) exits before writing its terminal-restore postcondition file. This flake injects false gate failures into the pipeline above.

**Target architecture** — one rebound kernel, typed evidence at the source, mandatory verification:

- A single application-level `rebound(reason, context)` entry point. `reason` is a structured value (gate failure with area/command/exit code/output, hook failure with the hook identity from git state, artifact-incomplete, agent-timeout, handoff-verification), never a regex match on combined text.
- The kernel owns: the single ADR-0048 classification table (no per-site overrides), one fix-prompt builder, the agent launch (ambiguous null exit = failure), and a **launch → verify → relaunch** loop where `verify` re-runs the failing check. A bounce reports `fixed` only when `verify` passes; exhaustion strands the mission with the last diagnostic.
- **Budget is per local failure** (deliberate policy, replacing the cumulative persisted counters): each rebound invocation — one failing occurrence — gets a fresh in-memory budget (default 2 attempts). Nothing is persisted across occurrences; a mission that fails the same gate tomorrow gets a fresh budget. This removes the dual persistence, the split-brain counter, and the cross-process budget accounting entirely.
- The pre-review rebase runs **in-process** through the existing rebase-workflow port; no nested CLI subprocess, no text-based reclassification.

**Preserved invariants**: ADR-0048 fail-closed failure classes and dispatch actions; autonomous agent-family failover; review-round max-attempt caps; git-only repairs (dirty worktree, behind-main) remain agent-less and outside the kernel; the `px rebase` / `px integrate` CLI commands remain standalone.

Wave plan (subtasks): TASK-2377.01 (SC20 shutdown race), TASK-2377.02 (in-process pre-review rebase + typed evidence), TASK-2377.03 (kernel + first consumer: pre-review gate/hook bounces), TASK-2377.04 (review-loop bounces + delete dual persistence), TASK-2377.05 (CLI + handoff bounces).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SC20 (and the other SC2x shutdown tests) pass deterministically on real PTY processes with a red-to-green reproduction of the raw-mode/SIGINT race; the board registers a SIGINT handler that exits cleanly and restores terminal state.
- [ ] #2 The pre-review rebase path spawns no CLI subprocess; verification-gate and hook evidence is typed (area, command, exit code, output); a gate failure whose output contains hook-like text is classified as a gate failure, never a hook failure.
- [ ] #3 Every agent bounce path (pre-review gate, pre-review hook, CLI rebase, CLI integrate, handoff checkpoint, handoff gate, artifact recovery, timeout recovery) calls the single rebound kernel; a bounce is reported as fixed only after the failing check re-runs and passes; exhaustion strands with the last diagnostic.
- [ ] #4 Budgets are per local failure: in-memory per rebound invocation, no persisted retry counters; review-state.json metadata counters, the SQLite retry columns and their mapping sync, and the orphaned domain record methods are removed.
- [ ] #5 One classifier (the ADR-0048 table, with the ad-hoc human-only override folded in and the Git-blocker remap deleted) and one fix-prompt builder; the copied hook regexes, the override rules, and the dead duplicate integrate implementation (after TASK-2372) are gone.
- [ ] #6 The existing bounce regression suites (pre-review gate, gate-failure prompt, per-round gate, rebounce reproduction, rebase, integrate, handoff, repair-handoff, review-artifact) stay green, with any expectation changes for the removed cumulative-budget semantics documented in the subtask checkpoint.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
