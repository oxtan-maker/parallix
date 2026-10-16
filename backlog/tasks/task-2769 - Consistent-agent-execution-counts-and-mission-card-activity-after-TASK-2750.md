---
id: TASK-2769
title: Consistent agent execution counts and mission-card activity after TASK-2750
status: backlog
assignee: []
created_date: '2026-10-16 07:38'
labels:
  - bug
dependencies: []
priority: high
ordinal: 256008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Outcome
The web header and mission cards agree about which provider agents are actually running. Preparation, capacity waits, gates and stopping remain visible as workflow activity without becoming running-agent counts. Unknown observation remains unknown.

## Baseline
Reviewed HEAD: aa1bd73db547afd62a19b82619ca71e96b93a87a (TASK-2750). Verify starting HEAD and current instructions before editing.
TASK-2749 already delivered canonical identity, MissionTerminalCapability, repository-owned retained history, compatibility attribution and history UI. TASK-2750 reuses it for durable admission, fenced ownership, independent supervisors/executors, capture correlation and recovery. Reuse both contracts. Their completed task files are historical references, not proof of runtime behavior.
Source-review hypotheses to verify: the legacy running-sessions scan recognizes public agent-launching px commands rather than new worker entry points; coordinator liveness does not prove provider execution; projectWorkflowBoard overlays open owners as unverified current work; card liveAgent derives from spinning work and its family. Selected or previously executing families may not be executing now.
Trace production admission -> worker/provider launch -> recorded execution identity -> observation -> projection -> transport -> mounted browser. Reproduce the actual mismatch before editing. Correct these hypotheses when evidence disagrees.

## Required behavior
- Define the counting unit: confirmed executing provider invocations, grouped by actual family and scoped to repository/mission. Wrapper processes, workflow owners, consoles and duplicate observations add no agents. State whether provider-internal subagents are observable; never invent their count.
- One application-owned execution observation supplies header totals and per-card agent indicators. Reuse existing run records, operation correlation, process-start identity checks and typed liveness support. Keep workflow activity separate from provider execution.
- Preserve repository + canonical MissionId + operation + provider-run attribution. Do not borrow another repository's same-named mission, a previous attempt's family, an assignee, or a supervisor PID as execution evidence. Deduplicate by existing invocation identity.
- Confirmed start/exit changes execution independently of workflow lifetime. Preflight, capacity waiting and post-agent gates can remain busy with zero confirmed providers. Pending stop remains unconfirmed until termination is established. Fallback/retry and delayed old-owner events must not resurrect or double-count executions.
- Failed, timed-out or partial observation preserves uncertainty. Never silently convert unknown to zero/stopped, or present a previous positive reading as current without freshness. Partial observations show confirmed counts with their limitation rather than claiming a complete exact total. Missing tmux or interrupted capture alone does not prove provider exit.
- Observe CLI-owned and board-owned launches. Browser reload and web-host restart rediscover execution without relaunching it. Preserve existing TUI/CLI activity semantics and workflow controls; update shared consumers where corrected meaning requires it.
- Bound/coalesce observation through existing composition outside slow HTTP execution paths. No per-card subprocess fanout or full retained-transcript reads on each poll. Resolve only owned resources through typed ports. Preserve loopback/session protections and safe rendering.

## Agent slop guardrails
1. No web-only counter patch, optimistic browser running map, tighter polling workaround, timer-based execution assumption, or counting active lanes as agents. Fix the authority and affected consumers together.
2. No renaming coordinator counts to agent counts, marking all open owners live, treating selected family as execution, or removing indicators to hide disagreement. Workflow activity must remain visible.
3. No second terminal manager, logger, capture store, identity scheme, workflow table, provider lifecycle state machine or competing source of truth. Extend the existing contract cohesively. If evidence is missing, identify the exact gap and add the smallest evidence at its owner.
4. No native-handle reconstruction in browser/interface code, arbitrary-path API, terminal-text parsing for liveness, live-session migration or session renaming.
5. Do not redo TASK-2749/2750. Preserve retained-history paging/search/follow, operation correlation, admission, fencing, recovery and stop semantics. Expand their implementation only for a reproduced defect necessary for this outcome. The separate projection-error/256-entry operation-log fix is excluded.
6. No lifecycle-policy change, async-runner rewrite, automatic merge, gate bypass, new E2E framework, convenience dependency, unrelated refactor or formatting churn.
7. Preserve ports/adapters, dependency direction, typed ports and composition authority. No OS probing in domain policy or adapter imports into application policy. Architectural-principle changes require the repository's explicit subsequent operator decision; this task grants no exception.
8. No weakened assertions, changed expectations that bless the bug, duplicated production algorithms in tests, mocked-away failing boundaries, new skips, changed verification gates or raised budgets to obtain green results.
9. Do not infer root cause from names/comments/old tasks. Do not claim browser verification from source review, fixture JSON or server responses alone. Historical completion labels do not establish current correctness.
10. Keep evidence in the normal checkpoint: requirement, production behavior exercised, before/after result, exact command/browser sequence and limitations. Separate source inspection, automated checks and manual observations. No invented latency, fabricated red-on-parent evidence or unsupported universal claims.
11. An unexercised required scenario remains incomplete with its reason stated. Do not declare delivery from unit tests alone, substitute an investigation-only report when implementation is possible, or quietly narrow the outcome.

## Decisive verification
Read ADR 0057 before selecting tests. Trace each behavior to its owning suite and extend nearby assertions. Retain focused bug reproductions red on parent and green with the fix. Exercise production launch/observation/projection/transport boundaries with isolated deterministic fixture providers and existing mounted-browser tooling; do not duplicate implementation in fixtures.
- Hold preflight/capacity: workflow preparation remains visible; confirmed provider count is zero and cards do not claim an executing family.
- Start one provider, then a second mission's provider: header family counts and card indicators agree. Cover both CLI and board paths, duplicate wrappers, and identical mission IDs in two repositories.
- End/crash a provider while holding a post-agent gate: execution stops while workflow activity remains. Interrupt capture separately; preserve unknown where death cannot be confirmed.
- Exercise different-family fallback, retry, pending stop, confirmed stop/restart and delayed superseded-owner events. No stale family, cross-mission termination, overlapping replacement or duplicate count.
- Reload browser and restart web host during execution: rediscover without duplicate launch. Inject failed/timeout/partial probes and reused/mismatched process identities; totals and cards consistently express uncertainty.
- Preserve history and allowed controls throughout; do not rerun an unrelated complete historical terminal acceptance matrix.
Manually inspect the running browser against isolated data for held preparation, live execution, provider exit with gates still running and concurrent missions. Record actual header/card observations and cleanup. Automated checks do not waive this requirement.
No paid/model-backed runs, operator-database mutations, real mission deletion or real Forgejo traffic. Cases own cleanup on success/failure/timeout/signal/child exit. Use barriers rather than long sleeps. Unit cases finish within 500 ms alone; no created/modified integration case or suite may exceed 3.5 seconds. Keep finite CPU budgets and classify new integration suites in the existing registry. Respect source/test size caps. Run focused regressions and required static analysis, not repeated full gates. Do not add or restore gates.

## Delivery
Update live docs narrowly for changed user-visible semantics under docs/doc-standards.md; keep code inventories/test evidence in checkpoints. Report counting semantics, unsupported provider visibility, partial/unknown behavior and remaining limitations. Follow normal review; no automatic integration or origin push.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retained focused reproductions fail on parent and pass with the fix for actual CLI/board header-card mismatches.
- [ ] #2 One shared application execution observation drives header family totals and card indicators with repository/mission/operation/run attribution and deduplication.
- [ ] #3 Preparation, capacity waits and gates remain visible without false agent counts; start/exit, fallback, retries and stop/restart update both surfaces consistently.
- [ ] #4 Probe failure, partial observation, process identity mismatch and host restart expose honest uncertainty without stale live or fabricated zero claims.
- [ ] #5 Isolated mounted-browser checks and manual running-browser sequences demonstrate concurrency and transitions; exact evidence and cleanup are recorded.
- [ ] #6 Existing terminal/history and workflow ownership contracts remain intact; focused checks and required static analysis pass without weakened tests, gate changes or increased budgets.
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
