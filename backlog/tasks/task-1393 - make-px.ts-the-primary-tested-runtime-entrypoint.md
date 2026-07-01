---
id: TASK-1393
title: make px.ts the primary tested runtime entrypoint
status: backlog
assignee: []
created_date: '2026-07-01 07:15'
updated_date: '2026-07-01 06:01'
labels:
  - tech_debt
  - ai_sdlc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`task-1391` restored native Node.js v24 strip-only compatibility, but the surrounding infrastructure still treats the built CommonJS artifact `px.js` as the primary executable in several places:

- `test/px-runner.test.js` invokes `px.js`
- `test/px-shell-init.test.js` shells out through `node px.js shell-init ...`
- the package `bin` still points to `px.js`

This means the TypeScript source entrypoint works, but the authoritative runtime/test path still depends on the generated JS wrapper rather than exercising `px.ts` directly.

Expected outcome:

- tests that validate workflow runtime behavior should exercise `px.ts` by default when the environment supports native TypeScript
- `px.js` should remain only as an explicit compatibility/package artifact where still needed
- the chosen boundary between source runtime (`px.ts`) and packaged compatibility runtime (`px.js`) should be documented and tested
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Mission explicitly states which scenarios still require `px.js` and why
<!-- DOD:END -->
