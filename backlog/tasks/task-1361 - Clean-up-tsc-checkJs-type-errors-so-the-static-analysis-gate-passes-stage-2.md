---
id: TASK-1361
title: Clean up tsc --checkJs type errors so the static-analysis gate passes stage 2
status: backlog
assignee: []
created_date: '2026-06-26 21:43'
labels:
  - tech-debt
  - static-analysis
  - gate
dependencies:
  - TASK-1353
  - TASK-1360
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Task-1353 added an opt-in static-analysis gate (`./scripts/verify-local.sh static-analysis`). Stage 2 runs `tsc --checkJs --noEmit` against the `tsconfig.json` whose `include` is `lib/core/**/*.js` and `lib/commands/**/*.js` with `strict: true`. It currently ships red: ~1175 errors originate directly in `lib/core`+`lib/commands`, and ~2956 errors total are reported because tsc follows imports into other `lib/` files. Stage 2 therefore aborts the gate (after the ESLint stage from TASK-1360 is green).

This is the larger, behavior-risky half of the cleanup. Prefer JSDoc type annotations on the real `lib/core`/`lib/commands` surface over blanket suppression. Do NOT relax `strict`, `checkJs`, or the `include` scope to make errors disappear — this is a code-correctness task, not a config-relaxation task. If specific imported files outside the gate's scope are genuinely out of scope to type, raise that during refinement rather than silently `// @ts-nocheck`-ing core files.

Branch from `main` (task-1353 is merged; the gate config `tsconfig.json` now lives on main). Depends on TASK-1360: ESLint must be clean first so the gate reaches stage 2 cleanly; until this task lands, the full three-stage gate stays red even with ESLint green.

GATE-WIRING CONSTRAINT (applies to both cleanup missions): the static-analysis gate is currently opt-in only — there is no `config/integration-pipelines.json`, so `px integrate` skips integration gates, and handoff/review use `npm test` as the verification command. These missions are NOT blocked by the static-analysis gate at integration time. Do NOT add the `static-analysis` dry-run as a blocking mission Gate (exit-0 required) in MISSION.md until BOTH TASK-1360 and this task are complete — otherwise the partially-green gate would block. Actually wiring static-analysis into the integration pipeline as a required gate is tracked separately in TASK-1362, and must wait until stage 2 is green here.

Scope note: ~2956 reported errors is large; this task may be split into per-subsystem subtasks during refinement.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `./scripts/verify-local.sh static-analysis` reaches and passes the tsc stage (stage 2 prints PASS)
- [ ] #2 `npx tsc --checkJs --noEmit` exits 0 with zero reported errors
- [ ] #3 `strict: true`, `checkJs: true`, `allowJs: true`, `noEmit: true`, and the `include` of `lib/core/**/*.js` + `lib/commands/**/*.js` are all unchanged in tsconfig.json
- [ ] #4 Type issues are fixed via JSDoc annotations / real corrections, not blanket `// @ts-nocheck` or `// @ts-ignore` on `lib/core` or `lib/commands` files
- [ ] #5 The full gate `./scripts/verify-local.sh static-analysis` now exits 0 across all three stages (ESLint + tsc + hygiene), making task-1353 success criterion 4 measurable
- [ ] #6 `npm test` passes after the cleanup
<!-- AC:END -->
