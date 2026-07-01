---
id: TASK-1394
title: remove build cjs as a prerequisite for core runtime validation
status: backlog
assignee: []
created_date: '2026-07-01 07:15'
labels: [tech_debt, ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The current test/runtime pipeline still assumes a generated CommonJS build before authoritative validation:

- `npm test` runs `pretest`, which runs `npm run build:cjs`
- several runtime checks rely on generated `.js` siblings existing before the workflow is exercised

After the JS->TS conversion wave, this is a migration gap. It hides whether the source tree itself is directly runnable and keeps the validation loop coupled to generated artifacts.

Expected outcome:

- core runtime validation can run against the TypeScript source tree without requiring a `build:cjs` pre-step
- where a generated JS artifact is still required (for packaging or compatibility), that requirement is isolated and explicitly named
- tests distinguish "source-runtime proof" from "packaged-compatibility proof" instead of conflating them
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 The final design cleanly separates source-runtime validation from packaged-artifact validation
<!-- DOD:END -->
