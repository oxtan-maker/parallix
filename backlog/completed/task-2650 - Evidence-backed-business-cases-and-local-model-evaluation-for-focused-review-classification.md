---
id: TASK-2650
title: >-
  Evidence-backed business cases and local-model evaluation for focused review
  classification
status: done
assignee:
  - codex
created_date: '2026-10-05 08:41'
updated_date: '2026-10-06 10:05'
labels: []
dependencies: []
ordinal: 163008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Determine which bounded review decisions can benefit from classifiers, using actual historical agent behavior and executed local/hosted evaluations. Deliver Proposed ADR 0065, reproducible evidence and an operator decision summary; production implementation belongs to separate follow-up tasks.

Operator-approved final scope extends the original local Kev study to hosted Jev, mission labels/NEL, historical finding-resolution routing, repo-specific reviewer guidance, evidence-packet methodology, mechanical context builders and local Ornith packaging. Historical agent decisions remain the main agreement baseline; current broad-review replays are diagnostic and possible prior model exposure is disclosed.

Delivered evidence:
- Read-only census of 595 local Forgejo PRs and documented historical bug leads, including deleted/moved records. Raw collection and reconstructed causal chains distinguish record/alias counts, deeply investigated families and unknown causality.
- Real Kev pointer-head classification on the RTX 5060 Ti, matched reporting baselines, Jev reporting/mission/NEL tests, local Ornith/Qwen general-review diagnostics and unfavorable results.
- Finding-resolution experiments separating manually curated capability results from automatically prepared workflow results. Mechanical development yields 18/46 autonomous routes; both known TASK-2599 routing failures escalate.
- Final frozen validation on 20 new source-retrievable mission families: three clears, no implementer returns, 17 escalations, including six context fallbacks. All three clears match actual historical approvals; all six historical rejections escalate. Packet/API work totals 7.81 seconds; 14.7% net saving is estimated using the operator's two-minute median review baseline.
- External host-local article archive at /mnt/data/code/parallix-artice-data/task-2650 with exact inputs, scripts, outputs, earlier ADR narrative, hashes and source limitations. Only compact summaries and an archive index remain in the repo.

Follow-ups were explicitly requested by the operator: TASK-2658 implements an opt-in Jev re-review pilot with Parallix-compliant decision telemetry, shadow comparisons and weekly agent-family projections; TASK-2659 compares and implements cheaper deterministic report rules for earlier feedback. Creating these task records does not implement either feature or accept the ADR.

Limits for independent review:
- Historical agreement is not independent bug truth; three fresh clears do not establish a false-pass rate below 5%.
- No actual end-to-end live saving, local operating cost or general safety improvement is established. Most fresh cases still need general review.
- Local-model packaging adds no autonomous routes in its four development probes. Initial collector, output allowance, invalid-path and byte-budget failures remain recorded, not filtered away.
- A prior large search found one genuinely bad repair clear, one correct old-finding clear followed by a new finding, and one historical reviewer false alarm. Keep raw disagreements visible.
- TASK-2498 approval metadata identifies the tested fix commit; the body mentions another HEAD that could not be retrieved. The provenance limitation is retained.

Boundaries: historical collection/experiments are read-only; do not run historical code against live operational state. Production source, architecture, verification gates and review authority remain unchanged. Authorized administrative work is limited to this mission's brief/checkpoint evidence and the operator-requested follow-up task records. No handoff, review or integration is launched by this preparation.

Review entry points: docs/adr/0065-local-review-classification-evidence.md and backlog/docs/task-2650-evidence/{summary,final-validation,review-readiness}.md. Checkpoint evidence is authoritative in px status task-2650. Retain the declared ./scripts/verify-local.sh all gate; this documentation/evidence-only preparation uses focused docs/static-analysis checks, and does not reuse the earlier full-gate run as current proof.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
