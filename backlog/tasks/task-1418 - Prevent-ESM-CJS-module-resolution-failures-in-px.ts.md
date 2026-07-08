---
id: TASK-1418
title: Prevent ESM/CJS module resolution failures in px.ts
status: backlog
assignee: []
created_date: '2026-07-04 08:57'
labels:
  - guardrail
  - esm
  - ci-cd
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add guardrails to prevent module resolution failures.

Review follow-up linkage:
- `task-2207` reduced the weak-agent handoff failure to this separate blocker.
- Current failing proof: `test/px-runtime-smoke.test.js:8` runs `node px.ts --version` and hits `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"` under Node's ESM loader.
- This blocker is outside the Goal Check evidence-contract scope and must be resolved separately before `./scripts/verify-local.sh all` can return green for missions that otherwise satisfy the handoff contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 px.ts imports use .ts extensions for local modules so tsx/esm resolver finds them
- [ ] #2 Running `node px.ts active` succeeds without ERR_MODULE_NOT_FOUND
- [ ] #3 CI/lint step validates that .ts files import with .ts extensions (not .js) for local relative imports
- [ ] #4 package.json has "type": "module" OR all local imports use explicit extensions consistent with runtime
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
