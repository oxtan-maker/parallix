---
id: TASK-2658
title: Add opt-in Jev routing for repeat review findings
status: backlog
assignee: []
created_date: '2026-10-06 09:45'
updated_date: '2026-10-06 09:50'
labels:
  - ai_sdlc
dependencies: []
references:
  - docs/adr/0065-local-review-classification-evidence.md
  - backlog/docs/task-2650-evidence/final-validation.md
priority: medium
ordinal: 164008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement an opt-in Jev fast path for repeated review findings using mechanically collected, revision-pinned evidence. Keep the normal general reviewer as fallback. No LLM prepares the evidence packet.

TASK-2650 found 18/46 autonomous development routes (11 finding clears, seven implementer returns). A fresh, frozen 20-mission validation produced three clears, zero implementer returns and 17 reviewer routes; all clears agreed with historical approvals and all six historical rejections escalated. Fourteen Jev calls and six context fallbacks took 7.81 seconds of packet/API work. This estimates 14.7% net review-time savings against the operator's two-minute median, not measured end-to-end savings. Three clears do not establish a low false-pass probability.

Use the tested mechanical builder: actual previous review comment and actual implementer response, pinned prior/candidate revisions, cited source/diff, unique explicit basename resolution, complete selected files when the entire packet fits and otherwise declared line windows/omissions. No language parser, repository-specific bug rules, extension substitution, LLM summarizer or tactical manual selection. Jev routing uses selected-choice scores: resolved >=51%, unresolved >=90%, otherwise normal review. Jev does not supply repair details; an unresolved return reports only likely unresolved findings and lets the implementer make changes or request general review.

The classified scope is the complete original finding set. A partial clear cannot approve the whole PR; broader/new review obligations must remain with the normal reviewer. Preserve executable gates and existing review/persistence authorities. Make the feature disabled by default, record its scope and reason, and support shadow comparison before enabling autonomous routes. Report actual end-to-end latency and historical/live disagreements, including new findings, without filtering raw errors away.

Decision: docs/adr/0065-local-review-classification-evidence.md. Compact fresh results: backlog/docs/task-2650-evidence/final-validation.md. Detailed packets, scores and scripts: ../parallix-artice-data/task-2650/final-mechanical-validation/.

Telemetry is part of this mission, following ADR 0051/0053 and existing statistics conventions. Persist bounded, typed decision measurements through application-owned ports into the operator-local SQLite authority; expose aggregates through existing on-demand projections/exports. Keep large evidence artifacts outside the repository and reference them by hash/location. Classifier telemetry must not masquerade as agent-authored PR reviews or become a second workflow authority.

Correlate each real decision/attempt with repository, mission, review round, pinned revisions, packet and builder/prompt/policy versions, actual classifier provider/model, selected label/score, resulting route and fallback reason. Attribute implementer and ordinary reviewer families separately. Measure preparation, classifier, retries/fallback, and whole review-cycle time with enough precision to retain subsecond work. Missing observations are unavailable, never zero; retries must not double-count a decision or disappear from timing.

Weekly comparisons follow existing completed-mission cohort and full-history semantics. Report eligible decisions, calls, clears, implementer returns, escalations, reviewed/adjudicated false clears and false returns, unobserved outcomes, and net end-to-end time by agent family/model. Keep actual PR review rounds, request-changes/fix rounds and classifier attempts distinct. Join shadow/reviewer outcomes at the same revision and original-finding scope; record new findings or subsequent confirmed misses separately. An unreviewed automatic clear is unobserved for correctness, not automatically counted as correct because it merged.

Operator planning assumptions: 40–70 completed missions/week and 0.4–2.7 PR rounds/mission depending on agent family. Derive actual weekly counts from telemetry rather than baking these figures into reports.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Feature is opt-in and disabled by default; ordinary reviews, executable gates and existing approval authorities retain their contracts.
- [ ] #2 Evidence is collected mechanically from pinned source with actual prior review and implementer response; missing revision, ambiguous/missing material, oversized input, API failure or insufficient evidence routes to the normal reviewer. Extraction works independently of programming language.
- [ ] #3 At fixed 51% resolved / 90% unresolved selected-choice scores, eligible complete finding sets clear, unresolved sets return a likely-unresolved signal with CHANGES_MADE or reviewer escalation available, and partial clears/new or broader obligations retain general review. No fabricated repair instructions are emitted.
- [ ] #4 Focused contract checks retain both TASK-2599 safety failures, revision drift, partial finding sets and failure fallbacks. Independent validation reports raw false passes, false returns, escalation rate and actual end-to-end time against normal review before autonomous rollout.
- [ ] #5 Decision measurements use Parallix application/domain contracts and operator-local SQLite authority (ADR 0051/0053), retaining scope, revisions, packet/policy identity, classifier identity/score, route/fallback and precise preparation/classification/retry/review-cycle time. No fake PR review records, repository telemetry dumps, missing-as-zero measurements or double-counted retries.
- [ ] #6 Existing weekly/on-demand projections expose eligible-decision denominators, autonomous coverage, fallback mix, independently observed false clears/returns, unobserved outcomes and measured end-to-end time by implementer/reviewer family and model. Use completed-mission/full-history cohort semantics; distinguish review rounds, fix rounds and classifier attempts. Shadow comparisons join the same revision/finding scope and retain new findings separately.
- [ ] #7 Focused telemetry checks prove retry idempotency with retained attempt cost, unavailable-versus-zero data, subsecond precision, completed-cohort full-history attribution and unobserved-versus-correct outcomes; telemetry never changes review authority.
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
