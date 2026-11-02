---
id: TASK-2829
title: Preserve structured failure identity through recovery
status: backlog
assignee: []
created_date: '2026-11-02 12:30'
labels:
  - bug
dependencies: []
references:
  - TASK-2814
priority: high
ordinal: 300016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Close the systematic gap where expected failures lose their identity across Parallix boundaries and recovery reconstructs their meaning from English diagnostics.

Operator requirement: No failure that Parallix produces, or can reasonably expect to catch otherwise, may be caught, identified, classified, or routed by string matching. This includes foreseeable failures from dependencies, subprocesses, providers, Git, Forgejo, filesystem, verification, and lifecycle operations. Human-readable message text is diagnostic evidence and presentation, never the control contract for those failures. Do not narrow this requirement to internally thrown errors or satisfy it by adding regexes, substring rules, or alternate wording.

Preserve conservative fail-closed behavior for genuinely unexpected or unsupported failures. The defect is that normal, foreseeable conditions reach the unknown fallback because structured identity is absent, discarded, or ignored; merely renaming the fallback or changing the infrastructure message does not close the gap.

Observed on TASK-2814, 2026-11-02: an integration repair retained an effective independent approval while repair certification/approval-retention assessment remained outstanding. The execute path attempted review preparation. The domain rejected submission with "Integration repair must prove approval retention before lifecycle recovery". Review submission returned only ok:false plus an English error string; execute recovery classified that sentence by regex/substrings, missed the known lifecycle condition, fell back to InfraBlocker/HumanOnly, then replaced the actual diagnostic with an unsupported claim about Forgejo credentials/connectivity. Retained workflow evidence: run:workflow-f8c0e625-2152-43bc-a0c3-85efa2f1f804:stdout@265000+2780. Manual recovery subsequently certified CP-6/CP-7 using their actual exact checks, reran all 54 browser cases, and used existing approval-retention authority to return the mission to integration without manufacturing a reviewer decision. That recovery did not fix the shared failure propagation or sequencing.

Inspect existing failure reason, lifecycle result, recovery, and adapter ownership before designing the change. Existing versioned reason codes and discriminated recovery events cover some paths, but review preparation still exposes string-only classification methods. Trace producers through adapters/application ports, persistence and reload, classification, recovery admission, board/lead actions, and operator diagnostics. Reuse and complete the existing structured contracts; normalize foreseeable external failures at the owning adapter using machine-readable results, status/code fields or explicit operation outcomes. Do not quietly exempt predictable external failures or move the same prose matching behind a new helper.

Correct the actual pending-integration-repair continuation as well as failure propagation: settle authorized verification and approval retention through the existing owners before attempting a lifecycle action that their guards reject. Preserve reviewer independence, immutable failure evidence, current revision/authority checks, operator-owned gates, and human-owned landing. No forced lane changes, fabricated gate receipts, or approval revocation merely to escape a routing deadlock.

This mission requests implementation within existing ports-and-adapters principles. Any proposed architectural-principle change still requires the repository's separate explicit operator decision before dependent implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No Parallix-produced failure or failure it can reasonably expect to catch is caught, identified, classified, or routed using human-readable string matching (regex, substring, prefix/suffix, exact-message matching, or equivalent). This covers foreseeable external failures as well as internal ones; changing patterns or wording is insufficient.
- [ ] #2 Expected failure identity, source and structured context survive producer-to-consumer boundaries, wrapping, persistence/reload and recovery. Runtime handling uses typed codes/discriminated outcomes; diagnostics retain the original cause and never invent infrastructure attribution.
- [ ] #3 Audit and migrate production failure-handling callers, including legacy string-only interfaces and secondary repair/reclassification paths. Remove superseded prose classifiers for covered failures; no matching-based parallel implementation remains reachable for those cases. Document any genuinely unexpected/unsupported boundary without claiming it satisfies an expected-failure contract.
- [ ] #4 Retain focused parent-red/fix-green regressions in the existing owning suites for the TASK-2814 pending-approval-retention failure and other affected contracts. Changing human-readable wording without changing structured facts cannot change classification, next action, or recovery admission; conflicting message keywords cannot override structured facts.
- [ ] #5 Pending integration repairs with effective approval resume the existing authorized certification/retention path before review submission. Board, lead and public commands agree on the admitted next action; no unnecessary reviewer launch, approval revocation, implementer relaunch or operator infrastructure escalation is used to bypass the known condition.
- [ ] #6 Genuinely unexpected or unsupported failures still fail closed with their evidence intact; confirmed infrastructure, state-machine, gate, resource and provider failures retain distinct handling. Preserve reviewer authority, human-owned merges and operator-owned gates/budgets.
- [ ] #7 Manually demonstrate the public recovery workflow against disposable isolated state and capture truthful evidence that a foreseeable failure reaches its owned recovery or accurate explicit stop. Extend existing suites using the narrowest appropriate verification tier; do not mutate live Mission/statistics state or change gates to make delivery pass.
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
