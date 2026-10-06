---
id: TASK-2658
title: Add opt-out Jev routing for repeat review findings
status: done
assignee: [codex]
created_date: '2026-10-06 09:45'
updated_date: '2026-10-06 09:50'
labels:
  - ai_sdlc
dependencies: []
references:
  - docs/adr/0065-local-review-classification-evidence.md
  - backlog/docs/task-2650-evidence/final-validation.md
  - ../parallix-artice-data/task-2650/
priority: medium
ordinal: 164008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement an opt-out Jev fast path for repeated review findings using mechanically collected, revision-pinned evidence. Keep the normal general reviewer as fallback. No LLM prepares the evidence packet.

TASK-2650 found 18/46 autonomous development routes (11 finding clears, seven implementer returns). A fresh, frozen 20-mission validation produced three clears, zero implementer returns and 17 reviewer routes; all clears agreed with historical approvals and all six historical rejections escalated. Fourteen Jev calls and six context fallbacks took 7.81 seconds of packet/API work. This estimates 14.7% net review-time savings against the operator's two-minute median, not measured end-to-end savings. Three clears do not establish a low false-pass probability.

Use the tested mechanical builder: actual previous review comment and actual implementer response, pinned prior/candidate revisions, cited source/diff, unique explicit basename resolution, complete selected files when the entire packet fits and otherwise declared line windows/omissions. No language parser, repository-specific bug rules, extension substitution, LLM summarizer or tactical manual selection. The delivered policy uses selected-choice scores: resolved >=52%, unresolved >=89%, otherwise normal review; TASK-2650 retains its original 51%/90% reference. Jev does not supply repair details; an unresolved return reports only likely unresolved findings and lets the implementer make changes or request general review.

The classified scope is the complete original finding set. A partial clear cannot approve the whole PR; broader/new review obligations must remain with the normal reviewer. Preserve executable gates and existing review/persistence authorities. Enable the eligible route by default when the existing Jev decision adapter reports available, unless the operator explicitly opts out. Reuse the adapter already merged to main and its operator-environment availability/provider authority; do not add another provider adapter or credential/configuration authority. Opt-out, unavailable or invalid configuration, timeout and API failure all retain normal review. Record the scope and routing reason, and support same-scope shadow comparison for correctness observation without requiring a separate opt-in rollout. Report actual end-to-end latency and historical/live disagreements, including new findings, without filtering raw errors away.

Decision: docs/adr/0065-local-review-classification-evidence.md. Compact fresh results: backlog/docs/task-2650-evidence/final-validation.md. Detailed packets, scores and scripts: ../parallix-artice-data/task-2650/final-mechanical-validation/.

Telemetry is part of this mission, following ADR 0051/0053 and existing statistics conventions. Persist bounded, typed decision measurements through application-owned ports into the operator-local SQLite authority; expose aggregates through existing on-demand projections/exports. Keep large evidence artifacts outside the repository and reference them by hash/location. Classifier telemetry must not masquerade as agent-authored PR reviews or become a second workflow authority.

Correlate each real decision/attempt with repository, mission, review round, pinned revisions, packet and builder/prompt/policy versions, actual classifier provider/model, selected label/score, resulting route and fallback reason. Attribute implementer and ordinary reviewer families separately. Measure preparation, classifier, retries/fallback, and whole review-cycle time with enough precision to retain subsecond work. Missing observations are unavailable, never zero; retries must not double-count a decision or disappear from timing.

Weekly comparisons follow existing completed-mission cohort and full-history semantics. Report eligible decisions, calls, clears, implementer returns, escalations, reviewed/adjudicated false clears and false returns, unobserved outcomes, and net end-to-end time by agent family/model. Keep actual PR review rounds, request-changes/fix rounds and classifier attempts distinct. Join shadow/reviewer outcomes at the same revision and original-finding scope; record new findings or subsequent confirmed misses separately. An unreviewed automatic clear is unobserved for correctness, not automatically counted as correct because it merged.

Operator planning assumptions: 40–70 completed missions/week and 0.4–2.7 PR rounds/mission depending on agent family. Derive actual weekly counts from telemetry rather than baking these figures into reports.

Redraft decision: the operator supersedes this follow-up's original opt-in pilot plan with an opt-out default conditional on Jev availability. ADR 0065 and TASK-2650 retain their historical conclusions; this mission must not silently rewrite the research as if default enablement had been its original recommendation.

Performance replication checkpoint: use TASK-2650's frozen development and fresh-validation inputs, scripts, hashes and outputs from backlog/docs/task-2650-evidence/archive-index.json and /mnt/data/code/parallix-artice-data/task-2650/ (final-mechanical-validation/). Replay through the production packet/routing path without manual context selection or threshold tuning. The development reference is 18/46 autonomous routes (11 clears, seven returns), with both TASK-2599 failures escalated. The fresh reference is 3/20 clears, zero returns, 17 escalations (11 abstentions, six context fallbacks), 14 calls, agreement on all three clears and escalation on all six historical rejections. Retain every case and fallback in the denominator. Compare packet/request hashes and report raw per-case differences, actual provider/model, policy/builder versions, revisions, environment, repeat count and timing distribution; hosted model variability must be reported, not hidden by retries or cherry-picked runs. Record missing archive inputs as blocked evidence, never a successful replication.

Reproduce the original accounting separately: 7.81 seconds of packet/API work and (3*120 - 7.81)/(20*120) = approximately 14.7% estimated net savings. That two-minute operator median is an assumption, not per-case measured ordinary-review time. Measure the production path's complete preparation, classification, retry/fallback and ordinary-review cycle against a matched ordinary-review baseline at the same revision/finding scope; report actual end-to-end savings separately from the historical estimate. Investigate and explain any coverage, safety or latency regression before marking the checkpoint complete; do not promise exact hosted scores or a universal 14.7% speedup. Preserve negative results and unobserved correctness outcomes.

README checkpoint: consult docs/doc-standards.md and make a targeted README.md update explaining Jev's user benefit, availability-dependent default, operator opt-out and normal-review fallback. Verify claims against the delivered CLI/configuration and adapter behavior. Preserve the product framing, parallel missions, agent-agnostic workflow and path to first value. Integrate concise prose into existing relevant content; do not add a mission-sized Jev section, duplicate command/provider inventories, rewrite unrelated prose or insert benchmark/checkpoint history. Link a deeper user-facing guide only if operational detail needs it. Review section purposes for duplication and run ./scripts/verify-local.sh docs.
px stats weekly decision counts: the default current-week output must show how many actual PR decisions were made by the classifier, with clears and implementer returns separately and a total. Count each applied decision once by its decision timestamp in the statistics week, including decisions on missions still open; completed-mission/full-history cohorts remain separate comparisons. Do not count API calls, retries, abstentions, fallbacks, unavailable attempts or shadow-only judgments as classifier-made PR decisions. Expose those separately to explain coverage. Show total actual PR decisions made in the same week across ordinary reviewers and the classifier, the classifier-made count, and classifier share = classifier-made decisions / total PR decisions * 100. Use the same applied-decision identity and timestamp rules for numerator and denominator; count real verdict decisions rather than API attempts or entire PRs. A zero total yields an unavailable percentage, not a division error or fabricated share; incomplete instrumentation must visibly qualify both total and percentage. Follow existing stats week/date/timezone semantics and make the period explicit. A genuine zero is zero; missing or incomplete historical instrumentation is unavailable/partial coverage, not a fabricated zero. Extend the owning stats/projection suite with week-boundary, open-mission inclusion, route distinction and retry-idempotency assertions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Feature is opt-out and enabled for eligible repeat findings whenever the existing Jev adapter is available; explicit opt-out, unavailable/invalid configuration and runtime failures use normal review; ordinary reviews, executable gates and existing approval authorities retain their contracts.
- [x] #2 Evidence is collected mechanically from pinned source with actual prior review and implementer response; missing revision, ambiguous/missing material, oversized input, API failure or insufficient evidence routes to the normal reviewer. Extraction works independently of programming language.
- [x] #3 At fixed 52% resolved / 89% unresolved selected-choice scores, eligible complete finding sets clear, unresolved sets return a likely-unresolved signal with CHANGES_MADE or reviewer escalation available, and partial clears/new or broader obligations retain general review. No fabricated repair instructions are emitted.
- [x] #4 Focused contract checks retain both TASK-2599 safety failures, revision drift, partial finding sets and failure fallbacks. Independent validation reports Jev decision counts and historical/reference agreement when Jev decides, retaining raw false clears, false returns, abstentions and context fallbacks. General-reviewer variability is excluded from acceptance.
- [x] #5 Decision measurements use Parallix application/domain contracts and operator-local SQLite authority (ADR 0051/0053), retaining scope, revisions, packet/policy identity, classifier identity/score, route/fallback and precise preparation/classification/retry/review-cycle time. No fake PR review records, repository telemetry dumps, missing-as-zero measurements or double-counted retries.
- [x] #6 Existing weekly/on-demand projections expose eligible-decision denominators, autonomous coverage, fallback mix, independently observed false clears/returns, unobserved outcomes and measured end-to-end time by implementer/reviewer family and model. Use completed-mission/full-history cohort semantics; distinguish review rounds, fix rounds and classifier attempts. Shadow comparisons join the same revision/finding scope and retain new findings separately.
- [x] #7 Focused telemetry checks prove retry idempotency with retained attempt cost, unavailable-versus-zero data, subsecond precision, completed-cohort full-history attribution and unobserved-versus-correct outcomes; telemetry never changes review authority.
- [x] #8 Replication retains the frozen TASK-2650 denominators, safety cases, raw disagreements and historical timing accounting. Delivered-policy Jev counts and correctness are compared with the reference; the operator-accepted score variability and 52%/89% tradeoff are explicit. General-reviewer timing and verdict differences are supplementary evidence.
- [x] #9 README.md concisely documents Jev benefit, availability-dependent default, opt-out and fallback under docs/doc-standards.md, preserving balanced product emphasis and first value; docs verification passes.
- [x] #10 px stats current-week output reports deduplicated applied classifier PR decisions, total and clear/implementer-return counts, by decision timestamp including open missions. Calls/retries, abstentions, fallbacks and shadow judgments stay separate; existing week semantics, total PR decisions and classifier percentage (classifier decisions / total * 100), with matching period/counting rules and unavailable percentage when total is zero; unavailable/partial coverage is explicit.
<!-- AC:END -->



## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Implementation evidence

See backlog/docs/task-2658-evidence/validation.md for the Goal Check, focused verification, raw external artifact locations and accepted coverage and correctness limitations. The operator waived the missing TASK-2451 snapshot as a standalone blocker; its case remains unavailable in the denominator. Finding-signal agreement does not establish matching whole-PR routing or end-to-end savings.

## Operator evaluation correction

Acceptance evaluates Jev decision counts and agreement with historical reviewers when Jev clears or returns findings. Nondeterministic general-reviewer verdict differences and their timing are excluded. Keep all cases, abstentions, missing context and negative Jev results visible. Regenerated fresh evidence reproduces 3/20 decisions with 3/3 historical agreement; development produces 17/46 versus 18/46, all 17 agreeing with archived labels. A separate live run of frozen original requests incorrectly clears TASK-2544 at the fixed 51% threshold; see backlog/docs/task-2658-evidence/validation.md. This correction supersedes the earlier requirement to establish matched general-reviewer end-to-end savings for acceptance.

## Operator threshold adjustment

The operator authorized 52% resolved / 89% unresolved after replaying the retained scores. New decisions use repeat-findings-52-89-v2; earlier 51%/90% evidence and applied decisions retain their historical meaning. This supersedes current-policy threshold references above, without rewriting the TASK-2650 benchmark. Do not retune the held-out validation after seeing its outcomes. See backlog/docs/task-2658-evidence/validation.md for the fresh independent results and retained historical-verdict disagreement.
