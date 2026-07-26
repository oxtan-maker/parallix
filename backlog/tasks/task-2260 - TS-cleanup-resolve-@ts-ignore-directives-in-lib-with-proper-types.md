---
id: TASK-2260
title: >-
  TS cleanup: resolve 6 @ts-ignore directives in lib/ with proper TypeScript types
status: ready-for-integration
assignee: [claude]
created_date: '2026-07-13 18:00'
labels:
  - typescript
  - migration
  - adr-0044
  - tech-debt
dependencies:
  - TASK-2224
references:
  - docs/adr/0044-workflow-distribution-model.md
  - lib/commands/integrate.ts
  - lib/tools/setup-review.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Task-2224 (T1: test typecheck project) converted 6 `@ts-expect-error` directives in to `@ts-ignore` as a scoped tradeoff — without `strict` on the test project, those directives became unused (TS2578). This task resolves them properly using TypeScript-compatible type narrowing rather than suppression comments. The directives cover two patterns: `context.task.matches` possibly undefined (integrate.ts:1179) and `setup.repo` possibly undefined at runtime (setup-review.ts:932,936,1011,1015,1022,1028). Fix by adding optional types to the affected interfaces and using type guards or null checks at call sites. Small scope (< 500 lines), no behavioral change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `@ts-ignore` directives removed from `lib/commands/integrate.ts:1179` and `lib/tools/setup-review.ts:932,936,1011,1015,1022,1028`
- [ ] #2 `context.task.matches` typed properly (optional or guarded) in the Task resolution interface
- [ ] #3 `setup.repo` typed properly (optional or guarded) in the SetupConfig interface
- [ ] #4 `npm run typecheck` (emit project) passes with no new errors
- [ ] #5 `./scripts/verify-local.sh static-analysis` passes (all 4 stages)
- [ ] #6 `npm test` passes unchanged (2,156+ pass, 0 fail)
- [ ] #7 Rollback: reverting the commit restores the `@ts-ignore` directives with no behavioral impact
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
