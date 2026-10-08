---
id: TASK-2692
title: >-
  Evaluate structured gate-failure evidence for Jev repair reviews and implement
  if useful
status: backlog
assignee: []
created_date: '2026-10-08 15:03'
labels:
  - ai_sdlc
dependencies:
  - TASK-2691
references:
  - /mnt/data/code/parallix-artice-data/jev-live-audit-2026-10-08/analysis.json
  - >-
    /mnt/data/code/parallix-artice-data/jev-live-audit-2026-10-08/context-packets.json
  - src/application/integrate/gates.ts
  - src/application/review-classification/classify-review.ts
  - docs/adr/0065-local-review-classification-evidence.md
  - >-
    /mnt/data/code/parallix-artice-data/jev-live-audit-2026-10-08/prior-research-map.json
priority: high
ordinal: 196008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hypothesis: integration-repair Jev abstentions are driven by information lost before packet assembly and selection of incidental log references, not simply insufficient context capacity. The October 6-8 live snapshot has 39 gate-repair rounds with zero Jev decisions; reconstruction gives seven source-less packets and a median packet of about 34 KB. Many others contain complete coverage-report files or test-runner source while changed repair paths are absent. Integration failure capture currently persists only the last 4,000 characters of concatenated stdout/stderr. Quality-gate logs can contain no actionable finding; integration logs can end in coverage tables, unrelated successful tests, resource errors or harness timeouts. Packing cannot recover a failure omitted upstream. The generic gate packet also substitutes a fixed verification claim for an actual repair explanation. These gate rounds were not the original ADR finding-resolution workload.

First trace the complete output through capture, durable failure cause and classifier input. Separate full-output-unavailable historical cases from recoverable outputs; never invent the missing failure. Prototype a bounded mechanical evidence record from actual output: failed command/exit, failing case identifiers, assertion/diagnostic blocks and relevant stack frames, plus tail, explicit dropped blocks and exact source provenance. Prefer structured TAP/JUnit/compiler/checker diagnostics when actually available; unrecognized output retains a bounded raw fallback. Do not infer an environment flake or code defect from an error keyword alone. Add the pinned repair manifest and relevant before/after source, actual retained implementer explanation when available as an unverified claim, and revision-bound verification facts only when the existing authority supplies them. Compare capture quality and packet selection as separate arms against the current tail-only baseline.

Evaluate unit assertion, coverage/quality, static analysis, resource exhaustion and agent-harness failures separately. If reliable failure evidence is unavailable, report that limitation rather than increasing confidence or autonomously clearing a gate. The classifier continues to judge the repair obligation; executable gates retain authority and broader changes retain their review obligation.

Research first; implement only a packing rule that passes the frozen evaluation. No threshold retuning, local LLM packaging, new review authority, partial-set PR approval, or operational statistics/Forgejo writes during experiments. Preserve the current 52% clear / 89% return policy and complete-finding-set scope. Keep packet preparation, bytes/tokens, API cost, fallback work, selected routes and applied verdicts separate. A missing or larger input stays in the denominator. Development controls are not independent fresh cases; repeated rounds/calls within a mission are clustered. Pre-register sample selection, exclusions, model, byte cap, labels, randomized paired-call order, repeats and the adoption bar before validation. At minimum require a positive paired gain in independently adjudicated correct routes, no new observed false clears/returns or safety-control regressions, and a measured net workflow benefit after preparation/fallback cost; report uncertainty and do not infer a low error bound from zero errors in a small sample. Historical whole-PR verdicts must distinguish original-finding resolution from new findings. Later repairs, later reviewer answers and labels never enter candidate packets. Retain every arm and negative result externally. Changes to ports-and-adapters principles, dependency direction, typed application ports, composition authority or adapter boundaries require the repository-mandated measured proposal and explicit subsequent operator decision before dependent implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A loss audit identifies what full output existed, what the 4,000-character tail retained, which cited paths are incidental and which required evidence is irrecoverable; gate repairs are evaluated separately from original-finding rounds.
- [ ] #2 Capture-only, repair-source-only and combined paired arms are frozen before calls; failing diagnostics outside the tail, coverage noise, multiple failures, stderr/stdout ordering, unfamiliar formats and absent diagnostics have retained controls.
- [ ] #3 Any proposed record is mechanically extracted, bounded, revision/command bound and copied from real evidence, with declared omissions; resource/harness errors do not become automatic flake exemptions and written verification claims are not execution proof.
- [ ] #4 Fresh independent gate-repair mission families validate the frozen arm across failure categories and report correct decisions, false clears/returns, retained abstentions and preparation/capture/fallback cost; no historical missing-output case is silently reconstructed or dropped.
- [ ] #5 Implement capture/packing changes only if the adoption bar is met, through approved existing boundaries, with safe publication and ordinary-review fallback; otherwise retain the negative finding. If supported and implemented, extend the existing owning suites using ADR 0057 tiers, run focused contracts and static analysis, maintain finite budgets and file caps, and manually exercise the real classifier route in an isolated end-to-end fixture without altering real mission statistics. Update live documentation only for changed behavior and run docs verification when applicable. If unsupported, deliver the retained evidence and negative decision without production code.
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
