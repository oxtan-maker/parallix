---
id: TASK-2691
title: >-
  Evaluate repair-diff and recorded-obligation packets for Jev findings and
  implement proven packing
status: backlog
assignee: []
created_date: '2026-10-08 15:03'
labels:
  - ai_sdlc
dependencies:
  - TASK-2690
references:
  - TASK-2689
  - >-
    /mnt/data/code/parallix-artice-data/jev-live-audit-2026-10-08/context-inputs.json
  - >-
    /mnt/data/code/parallix-artice-data/jev-live-audit-2026-10-08/context-packets.json
  - docs/adr/0065-local-review-classification-evidence.md
  - >-
    /mnt/data/code/parallix-artice-data/jev-live-audit-2026-10-08/prior-research-map.json
priority: medium
ordinal: 195008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hypothesis: findings about missing implementation, out-of-scope changes or unrecorded verification need a mechanically collected change manifest and recorded obligations, rather than only cited candidate source. This is distinct from the dependency/source-presentation experiments in TASK-2650 and early report-content feedback owned by TASK-2689.

Diagnostic examples: TASK-2665 rounds 2/3 concern an implementation absent from the branch; TASK-2653 round 5 concerns removal of out-of-scope statistics work; TASK-2683 round 2 and TASK-2653 round 2 include missing declared verification; TASK-2668.05 round 6 names absent docs/tests/inventory. Current packets may contain complete cited files yet omit the mission goal/scope, the complete changed/deleted-path manifest, prior content or checkpoint evidence needed to judge the actual finding. A repaired symptom is insufficient if required behavior was removed.

Compare the unchanged baseline with separate arms adding (a) complete change-status/rename/deletion manifests and focused before/after excerpts, (b) recorded goal/scope/success criteria and candidate-time checkpoint evidence, and (c) the smallest supported combination. Manifest enumeration is deterministic; behavioral adequacy stays a classifier judgment. Deleted or absent cited files require tree evidence and prior source instead of silently disappearing. Diff ranges can contain rebase/upstream changes: establish revision provenance before attributing a change to the repair, and do not hide uncertainty with a merge-base heuristic. Bind recorded state to the actual candidate/time; later checkpoints and reviewer outcomes must not leak into replay. Missing historical state remains missing. Supplied command text or Goal Check rows are claims unless backed by the existing authoritative verification contract; no new parser can certify runtime execution.

Use the dependency mission's frozen baseline/protocol and preserve its accepted selector as a separate comparison where applicable. Exclude the deliberately artificial TASK-2675 JEV-PROOF finding from ordinary-quality estimates, retaining it as an explicit control. Keep TASK-2665 repeated rounds clustered, not independent evidence of effectiveness.

Research first; implement only a packing rule that passes the frozen evaluation. No threshold retuning, local LLM packaging, new review authority, partial-set PR approval, or operational statistics/Forgejo writes during experiments. Preserve the current 52% clear / 89% return policy and complete-finding-set scope. Keep packet preparation, bytes/tokens, API cost, fallback work, selected routes and applied verdicts separate. A missing or larger input stays in the denominator. Development controls are not independent fresh cases; repeated rounds/calls within a mission are clustered. Pre-register sample selection, exclusions, model, byte cap, labels, randomized paired-call order, repeats and the adoption bar before validation. At minimum require a positive paired gain in independently adjudicated correct routes, no new observed false clears/returns or safety-control regressions, and a measured net workflow benefit after preparation/fallback cost; report uncertainty and do not infer a low error bound from zero errors in a small sample. Historical whole-PR verdicts must distinguish original-finding resolution from new findings. Later repairs, later reviewer answers and labels never enter candidate packets. Retain every arm and negative result externally. Changes to ports-and-adapters principles, dependency direction, typed application ports, composition authority or adapter boundaries require the repository-mandated measured proposal and explicit subsequent operator decision before dependent implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Candidate-time source and recorded-state provenance is demonstrated for each replay; unavailable historical state remains visible, and reconstructed packets are distinguished from hash-matched originals.
- [ ] #2 Paired arms isolate change manifests/before-after context from mission obligations/checkpoint content; deleted/renamed files, rebase-only changes, missing artifacts, stale proof, fabricated command claims and unknown criteria have retained controls.
- [ ] #3 Any packing rule selects evidence generically, retains full changed-path coverage metadata and material omissions, fits the real encoded request budget, and never treats unchanged source or a written test command as evidence execution occurred.
- [ ] #4 A frozen fresh-family validation meets the pre-registered correct-route, error and net-benefit bar; findings concerning verification are scored separately from executable-source findings and whole-PR disagreements are adjudicated by scope.
- [ ] #5 Implement only the supported packing fields through existing authorities; no overlap with TASK-2689 early report-status workflow and no weakened review obligations. If supported and implemented, extend the existing owning suites using ADR 0057 tiers, run focused contracts and static analysis, maintain finite budgets and file caps, and manually exercise the real classifier route in an isolated end-to-end fixture without altering real mission statistics. Update live documentation only for changed behavior and run docs verification when applicable. If unsupported, deliver the retained evidence and negative decision without production code.
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
