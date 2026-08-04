---
id: TASK-2328
title: Remove all CommonJS traces and make the repository ESM-only
status: review
assignee: [custom]
created_date: '2026-07-29 12:43'
labels:
  - ai_sdlc
  - technical_debt
dependencies: []
references:
  - TASK-2279
  - scripts/build-test-runtime.ts
  - test/run-default-tests.ts
  - src/entry/esm-globals.ts
  - scripts/build-canonical-bundle.ts
priority: high
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Complete the ESM cutover begun by TASK-2279. Eliminate the remaining CommonJS compatibility surfaces from production code, build and release tooling, test infrastructure, tests, configuration, comments, and generated artifacts so repository code has one native ESM module model. This includes the test-only `.test-runtime` compatibility tree that currently exists to provide writable CommonJS exports for legacy mocks; replacement tests must remain isolated, deterministic, and incapable of launching real agents or accessing Forgejo.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No project-authored production, test, script, or configuration file uses CommonJS module syntax, CommonJS compiler output, a `type: commonjs` boundary, or synthetic CommonJS globals.
- [ ] #2 The generated `.test-runtime` CommonJS tree and its build step are removed; every test executes against native ESM source or an ESM-native test seam.
- [ ] #3 Tests that currently depend on writable CommonJS exports use explicit dependency injection or another ESM-native isolation mechanism while preserving their behavioral coverage.
- [ ] #4 Transitional CommonJS branches, rollback shims, compatibility exports, globals, comments, and stale task-era assumptions are removed from source, build, release, SEA, verification, and package-audit paths.
- [ ] #5 Canonical bundle, npm package, native executable, default tests, integration tests, static analysis, and mutation defenses pass with no CommonJS compatibility runtime present.
- [ ] #6 A repository guard fails when project code reintroduces CommonJS syntax, configuration, generated output, or references to the retired `.test-runtime` tree.
- [ ] #7 Developer and architecture documentation describes the repository and test strategy as ESM-only and contains no active CommonJS migration guidance.
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
