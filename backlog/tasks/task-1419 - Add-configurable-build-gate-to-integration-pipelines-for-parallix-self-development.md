---
id: TASK-1419
title: >-
  Add configurable build gate to integration pipelines for parallix
  self-development
status: backlog
assignee: []
created_date: '2026-07-04 09:02'
labels:
  - guardrail
  - build
  - integration-gate
  - ts-js
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parallix's static-analysis gate runs ESLint + tsc + test hygiene, but never invokes `npm run build:cjs`. This allows .js extensions in .ts imports to pass typecheck and break at runtime (e.g. ERR_MODULE_NOT_FOUND when px.ts runs via Node ESM). Need a build gate that compiles TS→JS and fails the pipeline if compilation is broken, gated behind a config flag so it only runs when parallix develops itself.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add a 'build' gate to config/integration-pipelines.json that runs npm run build:cjs
- [ ] #2 Gate runs in the static-analysis phase (order 2, after static-analysis at order 1)
- [ ] #3 Gate is gated behind a config flag (e.g. build.enabled or a buildArea config) so it only activates for parallix's own development
- [ ] #4 px.ts and all .ts files that run directly via Node (not via tsx) must import with .ts extensions for local modules
- [ ] #5 Running ./scripts/verify-local.sh static-analysis then build:cjs succeeds end-to-end
- [ ] #6 .js imports in .ts files are caught — either by the build gate failing or by an eslint rule
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
