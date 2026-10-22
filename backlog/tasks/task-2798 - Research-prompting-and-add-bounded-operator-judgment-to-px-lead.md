---
id: TASK-2798
title: Research prompting and add bounded operator judgment to px lead
status: backlog
assignee: []
created_date: '2026-10-20 10:59'
updated_date: '2026-10-20 18:54'
labels:
  - enhancement
  - research
dependencies: []
priority: high
ordinal: 277008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make `px lead` able to request bounded operator judgment for a stranded Mission while preserving the existing deterministic lifecycle authority. The judgment layer must help lead reach the existing `integration` state; it must never invoke integration, merge, or publication.

Research first: record dated primary-source research on routing, evidence assembly, structured decisions, escalation and evaluation; include contrary evidence and limits for configured models. Audit the final delivered prompts, tool/session configuration and authority boundaries for execute, act-on-review, command-local repair and fresh lead recovery. Do not claim a universal best prompt.

The application remains authoritative for Mission state, versions, review, PR identity, gates, operation ownership, capacity, retries and execution. Before an opt-in judgment invocation, deterministic code assembles a current evidence envelope: Mission version and lifecycle state, review phase, board attention reason, latest checkpoint and next action, owned operation state, retained history references, PR state, and advertised supported actions. It validates freshness and re-reads state/version immediately before executing a proposal.

The agent may classify evidence as a confirmed defect, prompt mismatch, intentional limit or hypothesis, then propose one existing supported action or escalation. It never chooses, substitutes or falls back an implementer or reviewer; recorded Mission selection is preserved. It never manufactures approval/state, weakens gates, replaces a PR, kills a raw PID, launches duplicate work, or integrates. Product-owned operations retain their own stop semantics.

For a confirmed systematic defect rooted in current main, lead first searches for an active Mission blocked by it. If the repair is minor and plainly within that Mission's locked goal and scope, it extends that Mission with root-cause evidence and red/green acceptance detail, then resumes it normally. Otherwise it deduplicates against existing tasks, creates/refines/starts a bug Mission. Lead advances either path only to `integration`.

Keep model consultation opt-in, observable and finite: do not consult on unchanged evidence; bound actions, tokens, time and cost; record decisions and evidence references; escalate when evidence is stale, contradictory, unsupported or budgets are exhausted. Preserve ADR 0059: no persistent LLM supervisor or second state machine.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Record dated primary-source research, contrary evidence, model limits, candidate evidence envelopes and structured decision prompts; make no universal prompt claim.
- [ ] #2 Audit final delivered prompts, tools, session/reuse behavior and authority for execute, act-on-review, command-local repair, fresh lead recovery and judgment; classify findings as confirmed defect, prompt mismatch, intentional limit or hypothesis with source references.
- [ ] #3 Deterministic code assembles and validates a fresh typed evidence envelope containing current Mission version/state, review phase, board reason, checkpoint next action, owned operation state, retained-history references, PR state and advertised supported actions; stale, malformed, contradictory, unsupported and unauthorized proposals are rejected before execution.
- [ ] #4 Judgment proposals preserve recorded implementer and reviewer selection exactly; they cannot select, substitute or fall back agent families, manufacture approval/state, weaken gates, replace PRs, launch duplicate work, kill raw PIDs, merge or integrate.
- [ ] #5 The only delivered outcomes are an existing supported action, escalation, or systematic-defect ownership handling: extend/resume an active blocked Mission for a minor in-scope confirmed main defect, otherwise deduplicate then create/refine/start a bug Mission. Neither path proceeds beyond `integration`.
- [ ] #6 Invocation, action, token, time and cost budgets are finite and observable; unchanged evidence does not invoke the model; budget exhaustion and evidence insufficiency escalate with recorded evidence.
- [ ] #7 Evaluate continuous lead, focused fixes and bounded judgment on repeated matched cases with independent outcome checks, including correct continuations, false interventions, review/history/PR preservation, agent-selection preservation, ownership choice, duplicate work/issues, unnecessary gates, latency, tokens and actions.
- [ ] #8 Retain negative controls; extend owning suites; perform disposable public-CLI validation; update ADR 0059 and live documentation without adding/restoring gates or changing operator-owned budgets.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current policy clarification: lead works the product board and supported actions. It stops at `integration`, never at merge/publication. It must preserve the Mission's recorded implementer and reviewer; unavailability is evidence for escalation, not permission to substitute an agent. Main-root-cause defects are owned by an already blocked active Mission only when minor and in scope; otherwise they receive a deduplicated bug Mission. Raw process inspection may inform application-owned diagnostics but is never a judgment action boundary. Existing historical observations remain evidence only where their source/revision is still valid.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: codex
created: 2026-10-20 18:16
---
2026-10-20 fleet observation: lead PID3085666 start242504266 stayed alive with no children while root log /tmp/parallix-lead-watch-after-stop-20261020.log remained at pass24 integration waits for 79 minutes. Meanwhile external integration attempts returned px-0016, task-2784, task-2785, task-2792 and task-2796 active; lead did not refresh its attention output or launch recovery. Verified identity and no owned children, operator-authorized SIGINT settled it. Distinguish polling stall from legitimate shared gate admission: external holders progressed, but this lead had no child and no changed passes. Diagnosis not yet established; add an isolated long-running monitoring probe for queue refresh after an integration item becomes active. No PR768 or production code changed.
---
<!-- COMMENTS:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
