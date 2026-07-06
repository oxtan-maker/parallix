---
id: TASK-2201
title: 'retake on 1359: fix hallucinated real-agent smoke test'
status: backlog
assignee: []
created_date: '2026-07-06 15:46'
updated_date: '2026-07-06 15:57'
labels:
  - ai_sdlc
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-1359 ("Tier 2: non-blocking real-local-model smoke test for the agent-launcher surface") was marked done, but the delivered `test/e2e-real-agent-smoke.test.js` + `docs/real-agent-smoke.md` diverge substantially from the mission brief and from what was actually asked for. All 5 acceptance criteria on TASK-1359 are still unchecked in the completed record. Treat this as a fix-in-place: preserve what already works and correct the flow/config, not a from-scratch rewrite.

Note: the original AC #1 called for this to be "non-blocking (nightly/on-demand, never in the merge gate)". The delivered implementation instead made it a blocking `px integrate` gate. On review, blocking is actually the right call here — a smoke test that never gates anything provides little value — so this is NOT a defect to fix. Keep it blocking.

Parts of the existing implementation that are good and must be preserved, not thrown away:
- The pinned-model configuration approach (`workflow.config.json` `adapters.agents.models.custom` set explicitly in the throwaway repo so the test stays reproducible independent of this repo's own config).
- The failure classification buckets (`local-model-environment` / `opencode-launcher-failure` / `parallix-workflow-failure`) and their regex-based detection — this is genuinely useful for making red runs diagnosable and should carry over.
- The telemetry isolation mechanism (`PARALLIX_HOME`, `XDG_DATA_HOME` pointed at tmp dirs) — the mechanism is right, it just needs to be verified end-to-end and extended with real assertions on stats file content.
- The overall shape of `docs/real-agent-smoke.md` (prerequisites, invocation, runtime expectations, failure-bucket explanation) — update it to match the corrected flow, don't discard it.
- Registration as a blocking gate in `config/integration-pipelines.json`.

Confirmed problems (verified against the current tree) — these are what actually needs fixing:
- **Does not test the complete Parallix lifecycle.** It only runs `px draft --agent custom` once and stops. It never exercises active/review/integrate with the real agent, so it can't catch the classes of bugs that only show up later in the lifecycle.
- **Unclear whether it exercises the mission-branch's own code.** `CLI_ENTRY` is resolved from `packageJson.bin.px` in whatever tree the test happens to run from — it's not verified that this reliably points at the code under test on a mission branch/worktree rather than a stale global/installed `px`.
- **Test mission/prompt looks fabricated rather than representative.** The task drafted inside the throwaway repo ("draft a small, plausible mission contract for adding a tiny greeting helper function") is an invented placeholder, not a real Parallix prompt/task — so it doesn't validate against how Parallix actually asks agents to do things. Ensure the backlog.md task is instead create a .sh hello world program
- **Not the smallest possible mission for the goal.** Spec asked to "make the test mission as simple as possible"; scope should be re-examined for the minimum surface needed to catch TASK-1351/TASK-1273-class bugs.
- **Stats/telemetry isolation is unverified.** The isolation mechanism (PARALLIX_HOME/XDG_DATA_HOME) is the right approach (see preserve-list above) but has not been confirmed to fully prevent writes to the real developer/repo telemetry (e.g. via config-driven stats paths that bypass `PARALLIX_HOME`), and telemetry output assertions are thin (one regex on stdout, no check of the actual stats file content).
- **Reviewer-forcing requirement unclear.** Spec said "force custom as reviewer on its own pr as well" — not evidently implemented/verified in the delivered test.

Original task for reference: TASK-1359 (backlog/completed/task-1359 - Tier-2-non-blocking-real-local-model-smoke-test-for-the-agent-launcher-surface.md), implemented in missions/task-1359/.
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
