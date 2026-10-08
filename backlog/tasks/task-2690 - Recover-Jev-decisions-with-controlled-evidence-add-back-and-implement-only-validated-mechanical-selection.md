---
id: TASK-2690
title: >-
  Recover Jev decisions with controlled evidence add-back and implement only
  validated mechanical selection
status: backlog
assignee: []
created_date: '2026-10-08 15:03'
labels:
  - ai_sdlc
dependencies: []
references:
  - >-
    /mnt/data/code/parallix-artice-data/task-2650/research-records/resolution-retrospective.md
  - >-
    /mnt/data/code/parallix-artice-data/task-2650/research-records/mechanical-context-development.md
  - >-
    /mnt/data/code/parallix-artice-data/task-2650/research-records/ornith-context-packaging-development.md
  - >-
    /mnt/data/code/parallix-artice-data/jev-live-audit-2026-10-08/context-packets.json
  - docs/adr/0065-local-review-classification-evidence.md
  - >-
    /mnt/data/code/parallix-artice-data/jev-live-audit-2026-10-08/prior-research-map.json
priority: high
ordinal: 194008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2650 already tested AST/declaration extraction, lexical windows, unique basenames, complete files, one-hop source collection and Ornith file/span packaging. Complete files improved development autonomy from 13/46 to 18/46 and are already implemented; Ornith added no autonomous routes. Do not restart those broad experiments. The controlled retrospective is the stronger unfinished result: on the same 24 cases, curated/original-question packets yielded 10 autonomous routes, curated/preservation packets eight, and controlled windows either question two. It explicitly identified omitted block-selection helpers/contract tests (TASK-2626), weekly snapshots/exporter (TASK-2640), and service tests (TASK-2580), but did not isolate their causal contribution from presentation.

Hypothesis: a small, mechanically discoverable set of exact dependencies recovers correct Jev routes; adding more files indiscriminately does not. Start with hash-verified archived capability packets and current production packets. Add each identified missing item individually while holding question, source comments, claims, field framing and thresholds fixed; separately ablate complete declarations versus windows and relevant versus distractor context. Reproduce the archived 51/90 arm for historical comparability, then run all candidate/baseline comparisons at the current fixed 52/89 policy. Any fresh model-version differences remain explicit. Only after a useful add-back is demonstrated derive a generic deterministic selector using pinned relative imports/references, changed declarations and bounded one-hop dependencies; no curated filenames, repository paths or mission IDs in production rules. A helper being found is evidence coverage, not proof of a useful decision.

Current live diagnostic packets include 12 windowed packets among 20 insufficient-evidence finding rounds, but are reconstructed rather than guaranteed exact original requests. Preserve current successes and known bad-repair/wrong-return controls. Validate a frozen selector on fresh mission families rather than the curated cases used to choose it.

Research first; implement only a packing rule that passes the frozen evaluation. No threshold retuning, local LLM packaging, new review authority, partial-set PR approval, or operational statistics/Forgejo writes during experiments. Preserve the current 52% clear / 89% return policy and complete-finding-set scope. Keep packet preparation, bytes/tokens, API cost, fallback work, selected routes and applied verdicts separate. A missing or larger input stays in the denominator. Development controls are not independent fresh cases; repeated rounds/calls within a mission are clustered. Pre-register sample selection, exclusions, model, byte cap, labels, randomized paired-call order, repeats and the adoption bar before validation. At minimum require a positive paired gain in independently adjudicated correct routes, no new observed false clears/returns or safety-control regressions, and a measured net workflow benefit after preparation/fallback cost; report uncertainty and do not infer a low error bound from zero errors in a small sample. Historical whole-PR verdicts must distinguish original-finding resolution from new findings. Later repairs, later reviewer answers and labels never enter candidate packets. Retain every arm and negative result externally. Changes to ports-and-adapters principles, dependency direction, typed application ports, composition authority or adapter boundaries require the repository-mandated measured proposal and explicit subsequent operator decision before dependent implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An audit maps each proposed mechanism to TASK-2650 and TASK-2658 prior arms, reproduces available archive hashes, and identifies the remaining question without claiming AST, basenames, complete files or one-hop collection are new hypotheses.
- [ ] #2 Controlled one-item add-back and removal/distractor ablations separate missing evidence from source boundaries and framing; exact requests, model responses, labels, costs and route changes remain inspectable, including no-gain cases.
- [ ] #3 A deterministic selector is derived only from demonstrated evidence gains, with exact pinned-source provenance, real encoded byte limits, per-item budget allocation and explicit unresolved/missing dependencies; unsupported languages and dynamic wiring retain conservative fallback.
- [ ] #4 Frozen mission-disjoint validation reports paired correct-route gains, lost routes, false clears/returns, preparation/fallback costs and clustered uncertainty; fresh cases and all failures remain in the denominator and the pre-registered adoption bar is evaluated.
- [ ] #5 Only a selector meeting that bar is implemented through existing boundaries; otherwise record the negative result. If supported and implemented, extend the existing owning suites using ADR 0057 tiers, run focused contracts and static analysis, maintain finite budgets and file caps, and manually exercise the real classifier route in an isolated end-to-end fixture without altering real mission statistics. Update live documentation only for changed behavior and run docs verification when applicable. If unsupported, deliver the retained evidence and negative decision without production code.
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
