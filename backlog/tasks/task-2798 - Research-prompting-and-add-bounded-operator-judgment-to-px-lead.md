---
id: TASK-2798
title: Research prompting and add bounded operator judgment to px lead
status: backlog
assignee: []
created_date: '2026-10-20 10:59'
updated_date: '2026-10-20 18:22'
labels:
  - enhancement
  - research
dependencies: []
priority: high
ordinal: 277008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add bounded operator judgment to px lead, informed by intensive primary-source research and a detailed review of the existing implementation. Diagnose the mixture of product bugs, prompt mismatches, and intentional authority limits before selecting a design. Do not assume a longer prompt, a standard template, or a persistent fleet-wide LLM is the answer.

Research is a required first phase

Conduct substantial research into established agent prompting and orchestration patterns: routing, orchestrator/workers, evaluator/optimizer, tool/observation loops, context assembly, long-running harnesses, structured decisions, escalation, and outcome-based evaluation. Record search dates, primary sources, applicable reference implementations, contrary evidence, and limitations for our models and tasks. Distinguish common patterns from experimentally demonstrated improvements; do not claim a universally best prompt.

Produce concrete candidate prompts, evidence envelopes, decision schemas, tool contracts, and worked examples. Compare improvements to the existing recovery prompt and evidence plumbing with a bounded judgment agent and the persistent-supervisor alternative rejected by ADR 0059. Explain which responsibilities belong in deterministic code and which benefit from model judgment. Research must lead to a measured recommendation, not a literature list or untested prompt rewrite.

Inspect the actual final prompt and tool/session configuration delivered by every relevant adapter for normal execute, act-on-review, command-local gate repair, fresh lead recovery, and proposed operator judgment. Audit role, authority, termination rules, evidence freshness, context size, session reuse, and fallback identity. A runner role named execute does not prove execute-core.md was included. Preserve distinct role permissions rather than granting ordinary implementers recovery orchestration authority.

Proposed boundary to evaluate

Code retains authoritative Mission state, version checks, process/run ownership, leases/capacity, action admission, bounded retries, execution, gates, independent review, and human integration. An agent can diagnose evidence, assess useful progress, and propose a bounded next action. Candidate decisions include wait, request evidence, supported continuation, supported steering, an ownership-checked stop/restart, an eligible runner change, a deduplicated issue proposal, or escalation. Any contract correction requires applicable operator authorization; this session's px-0016 permission is not general authority.

Validate proposals against a typed contract, current Mission state/version, operation identity, evidence references, and supported actions immediately before execution. Reject stale, unsupported, malformed, or unauthorized proposals. Structured JSON alone is not an authority boundary. Do not kill raw PIDs on model instruction, launch a duplicate live worker, invent review approval, weaken gates, manufacture database state, merge, or treat a quiet worker as stuck. A credible live process and useful task progress are different signals; use evidence rather than a blind age threshold. If an owned stop is unavailable, report the limitation instead of bypassing ownership.

Define bounded invocation triggers and finite action/token/time/cost budgets. Avoid asking a model on every unchanged poll. Keep current repository/Mission state authoritative and preserve ADR 0059's rationale against a second LLM-owned state machine. Record concise decisions and evidence, not hidden reasoning. Consult existing tickets before filing an evidence-backed bug; do not file speculative routing changes.

Evaluation and delivery

Compare current continuous lead, focused evidence/prompt fixes, and bounded judgment using matched cases, runner settings, budgets, and repeated trials. Evaluate real outcomes independently of agent success claims: correct continuation, false interventions, preserved review/approval and history, duplicate workers/issues, unnecessary gate reruns, latency, tokens, and actions. Include negative controls and concurrency/stale-state cases. Account for model strength separately from orchestration changes, including the configured local Qwen family where applicable.

Use disposable fixtures for model exercises and manual public-CLI validation. Extend owning suites; use unit doubles for decision validation and narrow adapter tests only for real boundaries. Follow ADR 0057, unit headroom and integration runtime limits, fixture cleanup, and operator-owned gate configuration. Do not add verification gates. Decompose implementation into cohesive follow-up Missions after research if needed. Preserve ports/adapters, typed application ports, and composition authority; architectural-principle changes require the explicit subsequent decision required by AGENTS.md.

Initial primary-source reading, to deepen and critically assess:
- https://www.anthropic.com/engineering/building-effective-agents
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- https://arxiv.org/abs/2210.03629 (ReAct)
- https://arxiv.org/abs/2303.11366 (Reflexion)
- https://arxiv.org/abs/2405.13966 (counterevidence about ReAct prompting generalization)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Complete and record intensive primary-source prompting/orchestration research, including reusable candidate prompts, contrary evidence, model applicability, and a reasoned recommendation.
- [ ] #2 Produce a detailed source-backed lead audit classifying confirmed defects, prompt mismatches, intentional limits and hypotheses; deduplicate all bug follow-ups against existing tickets.
- [ ] #3 Capture and verify actual final prompts, tools, authority and fresh-session behavior across relevant roles/adapters; preserve ordinary implementer versus recovery permissions.
- [ ] #4 Compare current continuous lead, focused evidence/prompt fixes and bounded judgment in repeated matched evaluations with independent outcome checks; report false interventions and cost as well as success.
- [ ] #5 Define the deterministic-code/agent boundary, typed proposal contract, freshness/ownership checks and finite invocation/action budgets before implementation; preserve existing architectural principles and ADR 0059 rationale.
- [ ] #6 Any delivered intervention uses supported ownership-aware public/application ports, avoids duplicate live work, and respects explicit operator authority, independent review and human integration.
- [ ] #7 Cover retained failures and negative controls, including the withdrawn review-to-active diagnosis and contract corrections without authorization; preserve gate and history invariants.
- [ ] #8 Extend appropriate owning tests, perform disposable manual public-CLI end-to-end validation for implementation Missions, and update concise live documentation for delivered behavior without adding or restoring gates.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Detailed source/session review, anchored to main 5fdf4538afe348071bd84c057e43869d799234c7 (2026-10-20). This is an audit snapshot, not a live implementation inventory.

1. Lead already involves agents. src/application/recovery-supervisor.ts chooses admitted actions deterministically, checks liveness before dispatch and again inside a recovery claim, retries synchronous actions, and limits recovery attempts per failure. LEAD_LANES covers active/review/integration and excludes integrate authority. Progress includes lane, gate, round, phase, approval, checkpoint and HEAD. src/composition/lead-supervisor.ts forwards ordinary active/review work and reconciles current-work evidence. src/composition/cli-command-registry.ts:93-118 launches a fresh execute-role recovery agent with the assigned family and FRESH_SESSION_MARKER_PORT. Lead is not an entirely agent-free orchestrator; it lacks the broader judgment proposed here.

2. Liveness is intentionally conservative. src/application/current-work.ts keeps a publisher proved alive live regardless of age. A model repeatedly doing irrelevant work can therefore remain protected from replacement. This is a boundary of present supervision, not evidence that all long/quiet work is broken. Separate useful progress, capacity waits, long gates, and genuine looping before adding intervention.

3. Recovery prompt mismatch is concrete. recovery-supervisor.ts:216-246 says board evidence is not a diagnosis, asks investigation and supported continuation, and forbids weakening gates, self-approval, merging and out-of-scope repairs. It still refers to changing the scope of MISSION.md, whereas execute-core.md identifies px status as authority and rejects mission files. Its contract/checkpoint escalation guidance is less explicit. It does not explicitly prohibit ticket creation; it lacks an explicit deduplication/reporting workflow. Do not assert that it automatically inherits execute-core: registry passes the recovery instruction directly, while normal active assembly occurs separately in adapters/cli/commands/active.ts. Verify actual adapter input before alleging conflicting composed prompts.

4. Execute and recovery intentionally differ. prompts/execute-core.md makes goal/scope/criteria/checkpoint/gate obligations immutable without authorization, requires checkpoint checks, and reserves lifecycle transitions for the parent. Fresh recovery explicitly needs supported continuation. Preserve these roles. Gate rerun drift was observed in workers, but is not proof of an internally impossible prompt. Inspect final context and measured behavior.

5. Evidence plumbing has confirmed independent defects. TASK-2796 owns lost current rebase diagnostics and misleading attribution of an unrelated recent gate failure. The rebase ancestry check itself was correct. TASK-2797 owns shell-substitution gate-path validation; its focused red/green fix is already in px-0017 awaiting integration. TASK-2794 owns cancellation archive/retired-ledger policy contradiction. Fix or link these owners rather than duplicating them as an operator-agent feature.

6. Cancellation and identity need narrow evidence. Forwarded active work can borrow a controller inside the lead process, unlike an independently attributed workflow operation. In this session px stop did not settle that attempt; exact process identity was manually established before exceptional recovery signals. This is not a proposed product API. TASK-2792 already owns stop/ownership cleanup; reproduce the borrowed-forward case there before calling it a new bug. Recovery-family fallback also deserves a probe: launcher preparation may select another family, while registry records chosen-agent statistics after launch without the usual implementer identity callback. First decide whether the recovery agent is a helper or becomes the implementer; this is a source-level hazard, not a demonstrated publication defect.

7. Other unproven risks: failureFingerprint normalizes all digits and truncates diagnostic text, potentially conflating distinct failures; asynchronous forwarding logs errors rather than exposing them through synchronous retry accounting; fresh-session composition tests mock the launcher and do not establish final adapter resume behavior. Add targeted probes before claiming bugs or changing budgets.

8. The session is observational evidence with confounders. Six Missions reached integration with current independent approvals, but much of the work used lead --once followed by public commands, human interpretation, subagent rebase recovery and explicit operator decisions. --once intentionally performs one supervisory pass and then settles forwards without resuming continuous supervision. Default lead is the correct baseline. px-0016's contract correction required the user's explicit decision to retain main's publication fallback; an autonomous agent must request/represent that authority. Exceptional process signals, runner-family choices and manual follow-ups are not a validated prompt or controlled proof of superiority.

9. Retain a false-positive case. The proposed review-to-active routing bug TASK-2795 was withdrawn into draft after documentation confirmed that transition is intentional. Active repair must be able to proceed; changing the lane to avoid investigating it was the wrong diagnosis. Include this as a negative evaluation case. px-0008 remains parked per operator instruction; px-0016 must not be parked.

10. Existing-ticket audit found no bounded operator-judgment owner. Related owners: TASK-2791 shared verification serialization, TASK-2792 cancellation, TASK-2794/2796/2797 above, px-0017 reviewer recovery, task-checkpoint-evidence-prompts, and historical TASK-2489/2515/2622.12/2642/2730/2747/2760/2761/2779/2780. Check their current status and scope before creating follow-ups. Both native Mission records and Backlog were inspected.

Evaluation examples must include: a stale historical gate error versus a current rebase failure; legitimate long-running verification; live nested-command loops; capacity waits; an out-of-scope main defect requiring a deduplicated report; contract/main mismatch with and without explicit operator authority; uncertain ownership preventing stop; progress racing a proposed intervention; fresh-session isolation; selected-family fallback identity; malformed or instruction-bearing evidence; and the withdrawn review-to-active diagnosis.

Owning verification areas for subsequent work include recovery-supervisor and recovery-claim contracts, lead-review-forwarding, current-work/workflow-operation ownership, CLI registry composition, and the established prompt suites. Source-role probes and decision logic should use unit doubles. Model comparisons belong in agent-e2e/disposable experiments, not ordinary unit tests or new gates. Existing gate configuration and finite CPU limits remain operator-owned.

Continuous-lead monitoring evidence, 2026-10-20: fleet included px-0008, px-0015, px-0016, px-0017 and task-2785 after integration verification had returned the latter missions to active. px-0008 was supposed to remain parked per operator instruction, but that conversational decision was not represented in lead admission; do not assume a persisted parking feature exists. Lead offered active twice as its attention reason changed from workflow failure to orphaned-active; both immediately hit the same CP-7/locked-contract blocker. First fresh Codex recovery re-confirmed ready=false, primaryStopReason=human-only-contract-blocker, then attempted px review --continue anyway. It failed EROFS opening the primary checkout .workflow/run-history/.gitignore inside confinement, reported no changes and operator reconciliation required, and used 41,164 tokens. Lead launched a second fresh recovery against unchanged Mission version 46 and orphaned-active evidence. We stopped that run under explicit operator instruction. This demonstrates futile retries within the configured per-failure budget, NOT an observed infinite/unbounded retry defect; do not claim budget exhaustion failed. Evaluate cheap early escalation on authoritative human-only blockers and how explicit operator exclusions become bounded run input.

Other monitoring observations: a Claude worker waited with `until ! pgrep -f test:integration:ci:prebuilt ...`; this pattern can match its own waiting shell. Its /tmp/px17-int.log had already finished (2794 tests, 1 failure), so retain a self-matching wait as an agent-tool negative evaluation case, not an established production-code bug. The recovery EROFS is relevant to px-0018's existing role/confinement audit: supported continuation must have the runtime-owned history access it needs without broadening arbitrary write access. Validate this in isolation, respecting the normal execute/recovery authority distinction. SIGINT settlement evidence is recorded under existing TASK-2792.

Verification observations, not mission correctness conclusions: px-0017 integration output failed standard analysis tools retain every diagnostic in one batch (TASK-2762), with spawnSync node ETIMEDOUT. task-2785 also exceeded CPU limits in historical-stats backfill (0.309s >0.300s) and low-sample metric case (0.243s >0.225s), plus the same analysis-tool timeout. px-0015 reported enabled verification excludes processes across worktrees and retains orphan descendants (TASK-2791). These workers manually invoked raw npm integration suites concurrently; do not infer that configured gate admission failed or retune budgets from this sample. Preserve /tmp/px17-int.log, /tmp/px0015-int.log and /tmp/task-2785-resumed-integration.log while investigating. Sonar analysis later reported a quality-gate failure for task-2785; exact failed conditions require independent inspection. No approvals or successful handoff should be inferred from a worker's summary.

Follow-up monitored reproduction, 2026-10-20 13:02–13:09 UTC: TASK-2797 completed its final verifier (/tmp/task2797-verify.log: 282 files, 4,236 tests, zero failures, last modified 13:02:35). Its live custom worker repeatedly used pgrep -f verify-local to decide whether the verifier was still running. The matching PID was the polling shell itself (command contained that same pattern); no task verifier remained. After sleep90 then sleep150, it interpreted its own PID as ongoing verification and launched sleep180. This is a reproduced live-but-unproductive loop, not an observation timeout. Through supported px stop task-2797, operation 006bcf3a-d45d-4658-bc90-725d212ceba3 settled generation2 stopped at13:08:51Z; exact old owner/launcher/worker PIDs were absent afterward. Actual px active task-2797 --implementer codex then resumed retained code/checkpoints/history. No raw signals, gate changes, fabricated evidence or lost implementation. Include self-matching and unrelated-process polling in operator-judgment replay cases; prefer attributable process/job completion over process-name searches. This extends the existing px-0017 self-matching wait observation rather than creating a duplicate speculative product-code bug.

Monitored recurrence, 2026-10-20 16:41 UTC: unchanged task-2794 revision ca95d156bd202bf4c385f71170d6a0dcd41c1711 failed its second covered integration capture with SC3 exit-control CPU 3.494 > 3.400 seconds, TASK-2771 held-foreground preparation timeout, TASK-2750 wall 6.595 seconds, and TASK-2769 assertion 1 != 0. Evidence: /mnt/data/code/parallix-task-2794/.workflow/recovery-evidence/task-2794/d1964ffb90d7d58ee5ce926bd2274c70e503abd59dfac07b664f8450be2f13fb/attempt-2.stdout.txt. Parent then launched bounded repair attempt 2/2; its fresh worker ran another raw full exact integration command without a tracked change (/tmp/task-2794-fresh-gate.log), again reproducing SC3 while reporting about 55 percent CPU pressure. The worker had no isolated cause or concrete fix and attributed contention only as a contributor. This extends the existing raw-gate contention/judgment observation; it does not prove configured admission failed or justify budget changes. The operator stopped the idle lead watcher and used supported px stop task-2794 to stop futile repetition. Old owner 1896874 and agent 3002923 settled, but a subsequent identity check still found orphan raw-gate npm PID 3009422 start 242485933 and runner PID 3009593 start 242485956; settlement remained under investigation. No approval, successful gate, or complete cleanup should be inferred from worker or stop summaries.

Thorough operator-requested review of PR #768, 2026-10-20. Reviewed actual Forgejo head 41aad7d76 against base main e49a095b; local 60db9e69 differs only in task bookkeeping. PR review 3327 requests replacing ADR 0067 with a compact inline update to ADR 0059; inline comment 18652 remains unaddressed. No external review posted by this audit.

Confirmed P1: src/application/operator-judgment.ts:58 awaits authority.read before its try/deadline; recovery-supervisor.ts:183-195 catches failure before incrementing recovery attempts. Root isolated real-service/supervisor reproduction: budget 1, 720006ms logical elapsed, six failed attempt-1 messages, zero decision records; no bounded escalation. Acquisition and history-write failures must terminate/escalate safely without fabricated evidence, including hung reads.

Confirmed P1: recovery-supervisor.ts:216-221 rechecks only liveness after judgment; cli-command-registry.ts:99 reloads only assignee. Root real-service/supervisor reproduction admitted active v1, changed to integration v2 during the subsequent liveness await, then launched a recovery request still carrying active. Carry admitted mission/version/operation identity through typed launch admission and reject stale continuations. Existing recovery/integration locks have different keys and do not close this race.

Acceptance/evidence P1: scripts/evaluate-lead-judgment.ts:65,72-80 substitutes no-op board dispatch and tool-free classifiers for real baseline/focused recovery. scripts/lead-judgment-evaluation-fixtures.ts:31-49 hardcodes effects by case id and leaves safety counters inert. Root isolated always-continue policy scores correctOutcome=true/safe=true on all six cases while four decisions are inappropriate. Raw decisions and documentation disclose limitations honestly; this is unmet comparative-outcome evidence, not fabrication. Keep this as a classifier/controller pilot; actual workflow outcome/safety comparison and missing replay controls remain required.

Acceptance/evidence P2: scripts/probe-lead-prompts.ts:11-20 captures intermediate builders and directly calls fresh-marker methods, not final adapter launches, configured CLI substitution, tool/session arguments, resume/fallback. Complete the final delivered prompt/tool/session audit with isolated adapter captures.

Design limitation: live credible work returns before judgment (recovery-supervisor.ts:133-137,178-181); 360000ms isolated live-worker observation makes zero judgment calls and starts no 120s window. This implementation cannot assess/escalate a live unproductive agent or request targeted new evidence; stop/restart/steering remain unavailable. Do not claim that it reproduces the operator session's supervision. Reuse of DecisionPort, typed action admission and preservation of human integration authority are sound pieces; the research accurately avoids Qwen-transfer/superiority claims. No gates, budgets or PR code changed by this review.
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
