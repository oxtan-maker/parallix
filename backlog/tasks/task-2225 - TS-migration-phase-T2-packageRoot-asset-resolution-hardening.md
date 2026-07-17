---
id: TASK-2225
title: 'TS migration phase T2: packageRoot() asset-resolution hardening'
status: active
assignee: [codex]
created_date: '2026-07-11 13:46'
labels:
  - typescript
  - migration
  - adr-0044
dependencies: []
references:
  - docs/adr/0044-workflow-distribution-model.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implements phase T2 of the repository-wide TypeScript model accepted in the 2026-07-11 update to ADR 0044 (docs/adr/0044-workflow-distribution-model.md, §6 and §9). Add a single packageRoot() helper in lib/core/ that walks up from the calling module's __dirname to the nearest package.json named @magnusekdahl/parallix, and migrate every depth-coupled asset lookup (e.g. lib/commands/draft.ts:17-18) to it. CWD-dependent asset lookup is prohibited. Behavior-preserving refactor in the current layout; must land before the dist/ flip (T3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 packageRoot() helper exists in lib/core/ and resolves the package root from __dirname without consulting process.cwd()
- [ ] #2 All lookups of prompts/, templates/, config/, data/, docs/, examples/ and executable scripts route through the helper
- [ ] #3 New tests prove asset resolution works from a temporary directory that is not the checkout
- [ ] #4 npm test and node test/e2e-mission-lifecycle.test.js pass
- [ ] #5 Rollback: reverting the phase commit restores the previous lookups
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
