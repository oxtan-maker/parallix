---
id: TASK-2201
title: 'retake on 1359: fix hallucinated real-agent smoke test'
status: backlog
assignee: []
created_date: '2026-07-06 15:46'
labels:
  - ai_sdlc
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-1359 ("Tier 2: non-blocking real-local-model smoke test for the agent-launcher surface") was marked done, but the delivered `test/e2e-real-agent-smoke.test.js` + `docs/real-agent-smoke.md` diverge substantially from the mission brief and from what was actually asked for. All 5 acceptance criteria on TASK-1359 are still unchecked in the completed record. Treat this as a redo, not a polish pass.

Confirmed problems (verified against the current tree):
- **Violates the core "non-blocking" requirement.** AC #1 explicitly said "explicitly non-blocking (nightly/on-demand, never in the merge gate)". Instead it was wired into `config/integration-pipelines.json` as `custom-agent-smoke` and the docs say outright: "This is a **blocking** integration gate... Also runs as part of `px integrate`... whenever changed areas include `workflow` or `lib`". This is the opposite of what was asked and will make every ordinary mission touching lib/workflow depend on a real local model being up.
- **Does not test the complete Parallix lifecycle.** It only runs `px draft --agent custom` once and stops. It never exercises active/review/integrate with the real agent, so it can't catch the classes of bugs that only show up later in the lifecycle.
- **Unclear whether it exercises the mission-branch's own code.** `CLI_ENTRY` is resolved from `packageJson.bin.px` in whatever tree the test happens to run from — it's not verified that this reliably points at the code under test on a mission branch/worktree rather than a stale global/installed `px`.
- **Test mission/prompt looks fabricated rather than representative.** The task drafted inside the throwaway repo ("draft a small, plausible mission contract for adding a tiny greeting helper function") is an invented placeholder, not a real Parallix prompt/task — so it doesn't validate against how Parallix actually asks agents to do things.
- **Not the smallest possible mission for the goal.** Spec asked to "make the test mission as simple as possible"; scope should be re-examined for the minimum surface needed to catch TASK-1351/TASK-1273-class bugs.
- **Stats/telemetry isolation is unverified.** The spec required "steer away telemetry (config) to another location so that test do not corrupt the real telemetry" and "test the telemetry output". The test sets `PARALLIX_HOME`/`XDG_DATA_HOME` to tmp dirs, but this has not been confirmed to fully prevent writes to the real developer/repo telemetry (e.g. via config-driven stats paths that bypass `PARALLIX_HOME`), and telemetry output assertions are thin (one regex on stdout, no check of the actual stats file content).
- **Reviewer-forcing requirement unclear.** Spec said "force custom as reviewer on its own pr as well" — not evidently implemented/verified in the delivered test.

Original task for reference: TASK-1359 (backlog/completed/task-1359 - Tier-2-non-blocking-real-local-model-smoke-test-for-the-agent-launcher-surface.md), implemented in missions/task-1359/.

Ask for this retake:
1. Re-read the original TASK-1359 description/AC and its mission history, and treat the delivered implementation as needing a rewrite, not incremental fixes.
2. Make the gate genuinely non-blocking (nightly/on-demand runner, explicitly excluded from `px integrate` and any merge-gate pipeline).
3. Decide and document how much of the lifecycle it should cover — at minimum, justify why stopping at `draft` is sufficient, or extend it to cover more of draft→active→review→integrate with the real agent.
4. Verify and pin down that the CLI under test is unambiguously the mission-branch's own code.
5. Replace the fabricated throwaway task/prompt with something that reflects a real Parallix-shaped prompt/workflow, kept as small as possible.
6. Verify telemetry isolation end-to-end (prove no writes land outside the tmp dirs) and assert on the actual stats file content, not just a stdout line.
7. Implement or explicitly drop the "force custom as reviewer on its own PR" requirement, with a stated reason if dropped.
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
