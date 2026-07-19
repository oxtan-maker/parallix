---
id: TASK-2276
title: Convert JavaScript test files to TypeScript with history-preserving renames
status: ready-for-integration
assignee: [codex]
created_date: '2026-07-19 00:00'
labels:
  - typescript
  - migration
  - tests
  - tech-debt
dependencies:
  - TASK-2229
references:
  - docs/adr/0044-workflow-distribution-model.md
  - tsconfig.test.json
  - test/run-default-tests.js
  - scripts/test-hygiene.sh
  - config/integration-pipelines.json
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Convert every repository test matching `**/*.test.js` to `.test.ts`. At task creation there are 158 such files, all under `test/`, plus one existing TypeScript test. This mission completes the optional TypeScript test-authoring direction established by TASK-2229 while preserving the useful file history of each converted suite.

Every conversion must begin with an explicit `git mv <file>.test.js <file>.test.ts`. Keep the rename and TypeScript adjustments at least 50% similar according to Git's rename detection; do not replace a test with a delete/new-file pair or perform a wholesale rewrite during the rename. Verify the staged result with `git diff --cached --summary -M50%` (or an equivalent `git diff -M50%` against the mission base) and require every converted pair to appear as a rename. Git does not store rename metadata, so this similarity verification is the evidence that history remains traceable with `git log --follow`.

Type fixes should be minimal and must not change test intent, coverage, isolation, or runtime boundaries. When a localized TypeScript error would otherwise force a large rewrite or push similarity below 50%, use a documented TypeScript suppression directive as an escape hatch: prefer `@ts-expect-error` with a reason; use `@ts-ignore` only when `@ts-expect-error` cannot express the case; use file-wide `@ts-nocheck` only as a last resort with a reason and follow-up reference.

If a specific file remains too complicated to convert safely even with those escape hatches, leave that file as `.test.js`. Before completing this mission, analyze and record the concrete blocker and create a follow-up backlog mission naming the parked file(s), required remediation, and verification plan. A parked file is an explicit scoped exception, not permission to abandon the remaining conversions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Every baseline `**/*.test.js` file is converted to the corresponding `.test.ts` path, except only files explicitly parked under criterion #8
- [ ] #2 Every converted file was renamed with `git mv`; `git diff --cached --summary -M50%` or equivalent base diff reports each converted pair as a rename with at least 50% similarity, with no delete/add replacement masquerading as a conversion
- [ ] #3 Test changes are limited to the rename, TypeScript compatibility, and required path/config updates; test intent, assertions, isolation, mocks, and unit-versus-integration boundaries remain unchanged
- [ ] #4 TypeScript suppressions are narrowly scoped and include a reason: `@ts-expect-error` is preferred, `@ts-ignore` is justified when used, and any last-resort `@ts-nocheck` names a follow-up task
- [ ] #5 `tsconfig.test.json`, `test/run-default-tests.js`, test-hygiene checks, integration-gate commands, and other test discovery/path allowlists recognize `.test.ts` names without silently dropping suites
- [ ] #6 A deterministic inventory compares the mission-base list of JavaScript tests with the final TypeScript and parked-file lists; every baseline file is accounted for exactly once and no test disappears
- [ ] #7 Representative `git log --follow -- <converted-file>.test.ts` checks reach commits from before the migration, including at least one small, one large, and one integration-only suite
- [ ] #8 Any test that cannot safely retain 50% similarity or pass verification remains `.test.js` and is listed in a newly created follow-up backlog mission with file-specific analysis, blocker, proposed remediation, and verification plan; if no files are parked, record that explicitly
- [ ] #9 `npx tsc --noEmit --project tsconfig.test.json`, `./scripts/verify-local.sh static-analysis`, the fast unit-test verifier, and the integration-only workflow gates pass on the final tree
- [ ] #10 No test executes real Forgejo, expensive agents, or other external dependencies as a side effect of the conversion; unit tests remain fast and fully mocked
- [ ] #11 Rollback: reverting the migration commit restores the JavaScript test paths, discovery configuration, and prior test behavior
<!-- AC:END -->

## Implementation Plan

1. Capture the mission-base inventory of `**/*.test.js` files and all filename-specific references in runners, scripts, gates, allowlists, fixtures, and documentation.
2. Convert tests in reviewable batches. For each file, run `git mv` first, then make the smallest TypeScript compatibility edits needed to typecheck and execute.
3. Use documented suppression directives before considering a large structural rewrite. If safe conversion still is not possible, move the file back to its original `.test.js` path and add it to the parked-file analysis.
4. Update test discovery, hygiene scans, hard-coded integration filenames, and TypeScript configuration so renamed suites retain their existing execution tier.
5. Stage the complete migration and audit every pair with Git's 50% rename threshold. Correct any delete/add pair by reducing rename-time edits or park it for the follow-up mission.
6. Run the typecheck, static-analysis, fast unit, and integration-only verification plans. Compare executed suite/test counts with the pre-migration baseline and investigate unexplained reductions.
7. Create the required file-specific follow-up mission for any parked tests, then capture the final inventory, rename summary, `git log --follow` samples, and gate results in the Goal Check evidence.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
