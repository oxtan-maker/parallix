---
id: TASK-2860
title: >-
  Block agent-started review/integration even when no workflow operation fences
  the launch
status: backlog
assignee: []
created_date: '2026-11-17 11:49'
labels:
  - bug
dependencies: []
references:
  - src/application/ports/mission-write-authorization.ts
  - src/composition/workflow-authorization.ts
  - src/adapters/agents/agent-launch-preparation.ts
  - src/application/review-command-use-case.ts
  - docs/adr/0031-ai-agent-instruction-boundary-and-command-floor.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An implementer agent must never start, resume or finish review (or integration, or execution) of its own Mission; the parent workflow owns those lifecycle stages. Parallix already refuses `px review --submit/enter`, `px integrate` and `px active` for an "inherited agent CLI", but that refusal only applies when the agent's environment carries the parent workflow operation id and generation. Those are added to the agent's environment only when the launching process itself holds a workflow operation. When the agent is launched without one, the agent's `px review --submit --push` passes the guard and runs a real review preparation and reviewer launch from inside the agent's confined shell.

Observed on Mission task-2859.22 (2026-11-17): the codex implementer ran `px review --submit --push --implementer codex` from its own shell. The review loop was started from that confined process (read-only repository `.workflow`, read-only `~/.claude` and `~/.pi`), so both reviewer launches failed on their session directories (`ENOENT … mkdir '/home/<user>/.claude/projects/<slug>/memory'`, `ENOENT … mkdir '/home/<user>/.pi/agent/sessions/…'`). The real review stage afterwards then reported "degraded: only one independent reviewer is available (claude: ENOENT …)" and exhausted its artifact-recovery budget (`REVIEWER_ARTIFACT_RETRY_EXHAUSTED`), blocking the Mission until an operator resumed it.

Verified while investigating: with `PARALLIX_WORKFLOW_OPERATION` and `PARALLIX_WORKFLOW_GENERATION` set, `px review --submit --push` is correctly refused (source entry and installed `px`), and Codex passes those variables through to its shell. The guard's first release (inherited fence 2026-10-20, `assertWorkflowControl` 2026-11-01) predates the failing run, so this is not a merge-timing issue. The failing run's agent environment therefore did not carry the workflow operation. Which launch path produced that environment is not yet proven; the Mission must establish it.

Desired outcome: no agent launch can start or resume review, integration or execution of a Mission, regardless of how the launching process was started. Existing refusal wording and the allowed agent writes (evidence, verdicts, resolutions, status reads) stay as they are.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A reproduction first: an agent launch whose launching process holds no workflow operation lets `px review --submit` start a review today (red on current behavior); after the fix the same invocation is refused with the existing inherited-agent message (green), retained in the suite that already owns the inherited-agent refusal.
- [ ] #2 The launch path that produced the unfenced agent environment on task-2859.22 is identified and stated in the Mission evidence, with the evidence that distinguishes it from the fenced path.
- [ ] #3 `px review` (enter and submit), `px integrate` and `px active` started from any agent launch are refused, including when no workflow operation is present in the launching process; the refusal does not depend on a single optional environment variable alone.
- [ ] #4 Read-only and assigned-work commands an agent legitimately runs (`px status`, `px review --status`, `px checkpoint ...`, `px verdict ...`, `px resolve ...`, `px mission ...`) keep working from an agent launch.
- [ ] #5 Operator-run `px review`, `px integrate` and `px active` outside an agent launch are unaffected, and the workflow-owned review loop still launches its reviewers.
- [ ] #6 The Mission is manually exercised end to end with a disposable `PARALLIX_HOME` and a disposable repository: an agent-like launch without a workflow operation is refused, an operator invocation still works.
- [ ] #7 Live documentation describing which commands an agent may run is updated if user-facing behavior or constraints changed; no implementation inventory or test evidence is added to live docs.
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
