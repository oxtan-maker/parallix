---
id: TASK-1399
title: we have a lot of typescript errors left
status: done
assignee: []
created_date: '2026-07-01 21:43'
labels:
  - user_value
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The title is stale relative to the current tree and needs a reality-check mission, not a blind cleanup pass.

Current observable state before implementation:
- `index.ts` and `px.ts` already exist at the repo root.
- `tsconfig.json` already includes `index.ts`, `px.ts`, and `lib/**/*.ts`.
- `lib/` contains TypeScript sources throughout; the only `lib/*.js` file still present on disk is `lib/commands/repair-handoff.js`, which already has a paired `lib/commands/repair-handoff.ts`.

Mission intent:
- Baseline the current repo with `npm run typecheck` and `./scripts/verify-local.sh static-analysis`.
- If reproducible TypeScript diagnostics still exist, fix them in the actual source-of-truth files and keep runtime interop intact.
- If the baseline is already clean, treat this backlog item as stale and close it with proof instead of inventing speculative code changes.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
