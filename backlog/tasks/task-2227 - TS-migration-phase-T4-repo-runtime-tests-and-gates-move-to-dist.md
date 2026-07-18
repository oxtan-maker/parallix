---
id: TASK-2227
title: 'TS migration phase T4: repo runtime, tests, and gates move to dist/'
status: refined
assignee: [codex]
created_date: '2026-07-11 13:46'
labels:
  - typescript
  - migration
  - adr-0044
dependencies:
  - TASK-2226
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implements phase T4 of the repository-wide TypeScript model accepted in the 2026-07-11 update to ADR 0044 (docs/adr/0044-workflow-distribution-model.md, §5, §9). Depends on T3 (task-2226). Move the source-checkout runtime to dist/: pretest becomes npm run build; test require paths, scripts/verify-local.sh gate_integrate, publish:guard, and the coverage gate load dist/; the mutation scoper (lib/commands/mutation-gate.ts) maps diff .ts to dist/lib/**; delete the one tracked compiled sibling lib/commands/repair-handoff.js; trim sibling compiled-output globs from .gitignore and eslint.config.mjs (keep dist/). Compatibility shim: build:cjs and the mtime guard remain available this phase so a revert restores a working sibling flow. Update ADR 0049's layout description via a dated note.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pretest runs npm run build and all tests execute against dist/ output
- [ ] #2 scripts/verify-local.sh and npm run test:coverage load dist/ modules; mutation-gate mutates dist/lib/** targets
- [ ] #3 lib/commands/repair-handoff.js is deleted; git ls-files shows zero tracked compiled runtime .js
- [ ] #4 Sibling compiled-output globs are removed from .gitignore and eslint.config.mjs while dist/ stays ignored
- [ ] #5 npm test, ./scripts/verify-local.sh static-analysis, ./scripts/verify-local.sh mutation-gate --dry-run, and node test/e2e-mission-lifecycle.test.js pass on the dist layout
- [ ] #6 ADR 0049 carries a dated note pointing its sibling-layout description at the dist layout
- [ ] #7 Rollback: reverting the phase commit restores the sibling flow (build:cjs still present)
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
