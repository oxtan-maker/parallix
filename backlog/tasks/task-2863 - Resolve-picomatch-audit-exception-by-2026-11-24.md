---
id: TASK-2863
title: Resolve picomatch audit exception by 2026-11-24
status: backlog
assignee: []
created_date: '2026-11-17 18:33'
labels:
  - security
  - dependencies
dependencies: []
references:
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf'
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review by 2026-11-24: remove the temporary exception for GHSA-fc5q-39xc-vjpf in pnpm-workspace.yaml. On 2026-11-17 picomatch 4.0.7 was the latest published version and the advisory had no published fix. Its high-severity repeated-extglob ReDoS finding blocked every mission at the pre-integration pnpm audit gate. The operator authorized a one-week exception while an upstream fix is awaited. pnpm does not automatically expire this exception; this mission owns its removal. Check upstream for a patched release, update the affected development dependency graph and lockfile, and remove the exception. If no fix is available by the review date, bring the remaining options to the operator for a new decision rather than silently extending the exception.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Remove GHSA-fc5q-39xc-vjpf from the audit ignore list after resolving the vulnerable dependency paths.
- [ ] #2 pnpm install --frozen-lockfile --prefer-offline and pnpm audit --audit-level=high pass without suppressing this advisory; run focused checks for any affected tooling.
- [ ] #3 Review the exception by 2026-11-24; if still unfixable, present evidence and alternatives to the operator for an explicit decision.
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
