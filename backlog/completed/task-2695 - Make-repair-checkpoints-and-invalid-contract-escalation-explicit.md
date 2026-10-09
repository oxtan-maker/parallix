---
id: TASK-2695
title: Make repair checkpoints and invalid-contract escalation explicit
status: done
assignee: [codex]
created_date: '2026-10-09 05:49'
labels:
  - bug
  - workflow
dependencies: []
priority: high
ordinal: 199008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2694 exposed a shared recovery-authority conflict. Its locked gate selected test/unit/interfaces/web/web-transport.cases.ts, a support module rejected by test discovery; the runnable owner is presentation-web-contract.test.ts. Operator-authorized correction executes all 170 cases. Mechanical invalidity is verified; why the drafting agent chose that path is not established. A discovered invalid locked contract must route to human review rather than authorizing the implementer to rewrite its own checks. And a drafting agents mission that is mechanically disprovable later must rebounce to drafter agent before drafting is complete.

Conflicts: prompts/execute-core.md:18 forbids changing the mission and requires stopping; src/application/rebound-kernel.ts REPAIR_AUTHORITY permits configuration repair; buildFreshDiagnosticRepairPrompt prohibits replacing checks; the declared-gate-validation remedy explicitly requests replacing the declaration and refers to checkpoint documentation despite the retired document flow.

Operator-requested behavior: Parallix creates a new durable repair checkpoint before launching a dedicated repair prompt. The agent fixes an authorized repair and records evidence on that checkpoint. Parallix reruns the actual required check to establish success. If the agent discovers that the locked gate or contract is invalid and needs human judgment, it reports a structured blocked-contract outcome on the first attempt, with evidence and a proposed correction; Parallix stops automatic repair retries and exposes the decision to the operator. Do not silently replace, weaken or bypass gates.

Trace exact launch paths before changing prompts: retained TASK-2694 runs are execute-codex runs, whereas rebound-kernel launches a dedicated prompt (default act-on-review step) and resumes the first repair session, then uses a fresh-ephemeral second repair. Determine whether normal active relaunch, inherited execute context, or prompt composition caused the conflicting execute instruction to appear. Audit checkpoint recording and handoff validation against the requested repair flow; avoid assuming the entire checkpoint system is defective or removing validation to accommodate it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Trace and retain a focused reproduction of TASK-2694-style invalid locked gate handling, including actual prompt selection, session reuse and checkpoint validation; distinguish verified causes from hypotheses.
- [ ] #2 Parallix creates and persists an incident-associated repair checkpoint before a dedicated repair launch; agent evidence is written to that checkpoint without overwriting earlier implementation proof.
- [ ] #3 Dedicated repair prompts consistently define repair authority, evidence writes and human escalation; resumed and fresh sessions obey the same boundaries without contradictory execute or act-on-review instructions.
- [ ] #4 An agent can submit a structured invalid-contract blocker with exact failing command, diagnostic, reason operator authority is needed and proposed correction; the first such report stops automatic retries and routes to human review.
- [ ] #5 Mechanically detectable invalid declarations are distinguished from agent-discovered contract problems; both fail closed without treating unrelated successful tests as proof of the locked gate.
- [ ] #6 Only a successful harness rerun of the authorized required check establishes repair success; checkpoint and handoff validation preserve prior evidence and verify the repair checkpoint.
- [ ] #7 Extend the owning recovery, prompt, checkpoint and workflow contracts with isolated focused regressions for successful repair, first-attempt contract escalation, relaunch and stale evidence; run static analysis and a safe manual isolated end-to-end flow.
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
