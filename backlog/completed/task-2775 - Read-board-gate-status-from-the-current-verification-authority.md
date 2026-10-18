---
id: TASK-2775
title: Read board gate status from the current verification authority
status: done
assignee: [codex]
created_date: '2026-10-18 06:02'
labels:
  - bug
  - web
dependencies: []
priority: high
ordinal: 257008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The web board still obtains gate status through ConcreteGateReadAdapter, which searches legacy gate-result files. The operator confirms file-based gate status is obsolete in the current architecture. The current source has no production callers of recordGateResult; wiring that recorder back in would restore the obsolete design rather than fix the projection. Trace the current gate executor, configured phase plan, workflow operation and durable verification evidence to identify the authoritative facts. Project those through the existing application read boundary for web and other consumers. Determine what current architecture already supplies before adding any missing observation. No architectural exception is granted.

The happy path must explain a mission just started, before gates run, while a gate runs, and after its result. Distinguish known absence/not-yet-run, disabled or unconfigured gates, current execution/results and actual unavailable observation. Review stale results, revision/attempt identity, retries, repair, cancellation and read failures. Do not infer success from lifecycle or text; do not restore file status writes or a legacy parallel authority. TASK-2773.08 only changes presentation density and does not repair this source mismatch.

Revalidate against the active tree before implementation. Preserve ports/adapters, typed application ports and composition authority; do not introduce a second status authority or change operator-owned verification gates. Read ADR 0057, extend the owning suite, retain a focused parent-red/fix-green reproduction, and run focused checks. Manually exercise the affected web flow with isolated fixtures without mutating operator missions or statistics. New or changed integration tests must finish within 3.5 seconds; unit cases must satisfy the 500 ms headroom requirement. Respect source-size caps.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The board uses the current authoritative gate/verification model through a typed application read port; the obsolete file reader is removed from the production board path without restoring file-based status publication.
- [ ] #2 A normal mission start and gate execution show the applicable observed states, with explicit actual uncertainty; no fabricated success, running state or gate plan is inferred.
- [ ] #3 Results are scoped to the applicable mission, operation/attempt and revision or input identity where required; previous success cannot masquerade as a current result during changes, retries or repair.
- [ ] #4 Focused regression and isolated manual web cases cover happy-path transitions plus missing evidence, stale results, unconfigured/skipped gates, failure and cancellation.
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
