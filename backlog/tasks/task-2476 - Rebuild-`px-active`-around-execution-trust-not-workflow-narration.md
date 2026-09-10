---
id: TASK-2476
title: 'Rebuild `px active` around execution trust, not workflow narration'
status: backlog
assignee: []
created_date: '2026-09-10 06:12'
updated_date: '2026-09-10 06:14'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Rebuild the default `px active` execution-and-handoff presentation so a first-time operator can understand one coherent story:

**what mission is running → which agent is implementing it → what the agent is visibly doing → whether meaningful verification passed → why the result is ready for review.**

This is not primarily a log-reduction task.

TASK-2471 demonstrated that suppressing existing logs can produce a superficially quieter command while leaving the actual operator experience incoherent. The implementation must improve the information model of the command, not merely delete or demote output.

The implementation agent's live streamed work must remain visible. The README asciinema replay is responsible for fast-forwarding uninteresting agent time.

## Why Now

The current `docs/assets/first-value-demo.cast` still exposes implementation machinery rather than an operator-facing execution record.

Examples from the current recording include:

```text
[INFO] Running execute preflight...
[INFO] Running mission startup preflight for: parallix-adhoc-0001
[PASS] PWD: matches expected mission worktree path ...
[PASS] Environment verdict: USABLE — this repository is ready for workflow commands.
[INFO] Launching execute agent...
[INFO] Selected agent for step "active": claude
[INFO] No prior claude session ... launching fresh.
```

After execution, the handoff becomes a numbered internal trace:

```text
[INFO] Starting handoff for mission ...
[INFO] Step 1: Running final verification gate for area: docs...
[INFO] Step 1: Gate executed; stored proof ...
[INFO] Step 1.5: Rebasing onto primary branch before handoff...
[INFO] [INFO] Review provider disabled...
[INFO] Step 1.7: Capturing Net Engineering Lines...
[INFO] [PASS] NEL captured: 10 NEL (undefined bucket)
...
```

The user should not have to translate these mechanics into:

> implementation finished, the repository verified it, and an independent reviewer is about to inspect it.

There is also a trust problem in the current demo itself: `scripts/record-first-value-demo.sh` creates a verification script whose body is only `exit 0`. The demo therefore visually claims successful verification without actually testing the demonstrated `hello.sh` change.

The current cast also reports verification area `docs` for a `hello.sh` change. Either the area inference is wrong or the label is meaningless to the user; it must not be presented as trustworthy evidence without resolving that discrepancy.

## Required operator experience

The exact wording/layout is implementation-owned, but the default output must establish this hierarchy:

1. Mission identity.
2. Actual implementing agent.
3. Real live agent work.
4. Implementation completion.
5. Repository verification result.
6. Transition to independent review.

The command should expose **outcomes and trust evidence**, not the internal sequence used to obtain them.

A selected-agent → fallback-agent change is important and remains visible.

Ordinary details such as PWD validation, SQLite transitions, task-file synchronization, proof hashes, graphify absence, disabled-provider branches, NEL persistence and handoff step numbering are diagnostics, not the main operator story.

## Mandatory anti-agent-slop feedback loop

This section is a hard acceptance requirement.

The mission is **not complete** because:

* unit tests pass;
* fewer lines are printed;
* old `INFO` lines moved to DEBUG;
* the implementation matches a mocked expected-output fixture.

The executing agent MUST:

1. Replay and inspect the existing `docs/assets/first-value-demo.cast` and rendered GIF before implementation.
2. Write down every visible defect in the active/handoff section before changing code.
3. Make the implementation changes.
4. Run the real `scripts/record-first-value-demo.sh` using real configured agents and an isolated `PARALLIX_HOME`.
5. Inspect the resulting raw `.cast`, not merely the command exit code.
6. Render and visually inspect the GIF.
7. Record every new defect exposed by the real run.
8. Fix every in-scope defect found.
9. Re-record and inspect again.
10. Repeat until no known in-scope defect remains.

The recording is an **executable acceptance artifact**, not documentation produced after the fact.

If a replay reveals a warning, contradictory fact, malformed status prefix, duplicate message, incorrect identity, false verification claim, wrong area, renderer problem or hidden lifecycle failure, the agent must investigate the underlying cause.

It is forbidden to make a defect disappear solely by lowering its log level.

## Demo verification requirement

Replace the demo's unconditional-success verifier.

The disposable demo repository must have a deterministic verification command that:

* fails against the seeded broken state;
* passes after the mission fixes the program;
* materially tests the behavior shown in the diff.

For the current greeting example, a simple executable assertion is enough, e.g. the verifier runs `hello.sh` and checks the exact expected output.

The checkpoint evidence must show the red state and green state.

## Scope

* Default `px active` execution presentation.
* Active preflight presentation.
* Execution-agent launch presentation.
* Active → handoff presentation up to the point autonomous review begins.
* The demo's meaningful verification setup.
* Fix incorrect/misleading area presentation for the demo.
* Related focused tests.
* Re-recording and re-rendering the first-value demo.

## Out of Scope

* Reviewer findings/verdict presentation after review starts — TASK-2477.
* Implementer response to reviewer findings — TASK-2478.
* `px integrate` presentation — TASK-2479.
* Redesigning TASK-2471's draft summary except for unavoidable shared-launch regressions.
* Weakening verification, lifecycle, persistence or recovery semantics.
* A general reporting architecture unless a local solution is demonstrably impossible.

## Success Criteria

1. A real recorded `px active` run names the mission and actual implementer before the agent's work.
2. The implementer is not redundantly announced multiple times on the happy path.
3. Actual agent streaming remains visible.
4. Selected→actual fallback remains visible when it occurs.
5. Numbered handoff implementation steps are absent from normal happy-path output.
6. Nested prefixes such as `[INFO] [INFO]` and `[INFO] [PASS]` do not occur.
7. Happy-path PWD checks, lifecycle bookkeeping, persistence detail, proof hashes and disabled-provider notices do not dominate the operator output.
8. Real verification is clearly reported.
9. The demo verifier fails on the broken seeded program and passes on the corrected program.
10. The demo no longer misleadingly presents `docs` as evidence for the `hello.sh` implementation unless that classification is proven semantically correct.
11. Execution completion and readiness for review are explicit; the user need not infer them from task-state transitions.
12. Failures, repair instructions, rebase conflicts, missing artifacts and degraded/fallback situations remain loud.
13. The first-value cast is re-recorded against the final tree.
14. The final GIF is rendered and inspected.
15. The final checkpoint contains a `## Demo Replay Findings` section listing every finding and disposition.
16. Relevant active/handoff test files are run directly by filename and pass before the umbrella gate.
17. `./scripts/verify-local.sh all` passes afterward.

## Agent-slop guardrails

* Do not solve this by searching for noisy strings and changing `log()` to `debug()`.
* Do not measure quality by line count.
* Do not hide the agent's real output.
* Do not hide genuine warnings because they look bad in the demo.
* Do not leave a false warning in place merely because tests expect it.
* Do not use `exit 0`, `true`, or another unconditional verifier in the demo.
* Do not describe a stored proof hash as meaningful evidence to the user by itself.
* Do not print the same fact from both the application layer and shared launcher.
* Do not fake PTY output or inject canned agent output into the recording.
* Do not rely solely on `./scripts/verify-local.sh all`; TASK-2471 proved focused files can still be broken.
* Do not mark the mission complete without inspecting both the raw cast and rendered GIF.

## Checkpoints

### CP 1 — Current-run defect inventory

Replay the existing demo and capture the active/handoff defects before implementation.

Add characterization tests for both:

* the required positive operator story;
* the known current defects.

### CP 2 — Execution story

Rebuild the active portion around:

```text
mission
→ implementer
→ live work
→ implementation completed
```

Preserve fallback and failure semantics.

### CP 3 — Verification and handoff story

Rebuild handoff around:

```text
real repository verification
→ verification passed
→ independent review starting
```

Replace the fake demo verifier and prove red→green behavior.

### CP 4 — Real replay closure

Re-record, inspect `.cast`, render GIF, inspect visually, fix everything found, repeat as necessary.

Then run focused test files directly and finally the repository gates.

## Gates

* Focused active/handoff tests run directly.
* Demo verifier red→green reproduction.
* Real `scripts/record-first-value-demo.sh`.
* Raw cast inspected.
* GIF rendered and inspected.
* `./scripts/verify-local.sh static-analysis`.
* `./scripts/verify-local.sh all`.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
