---
id: TASK-1360
title: Clean up ESLint violations so the static-analysis gate passes stage 1
status: done
assignee: [custom]
created_date: '2026-06-26 21:42'
updated_date: '2026-06-26 21:44'
labels:
  - user_value
dependencies:
  - TASK-1353
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Task-1353 added an opt-in static-analysis gate (`./scripts/verify-local.sh static-analysis`) whose first stage runs `eslint --ext .js --max-warnings 0 lib/`. The gate currently ships red: ESLint reports 603 errors across `lib/`, so the gate aborts at stage 1 before tsc and test-hygiene even run. Until `lib/` lints clean, any mission that opts into the static-analysis area is blocked, and success criterion 4 of task-1353 (combined three-stage runtime) cannot be measured.

This task drains the ESLint backlog so stage 1 exits 0. Branch from `main` (task-1353 is merged; the gate config `.eslintrc.cjs` now lives on main).

Current breakdown (run `npx eslint --ext .js lib/` to refresh):
- 490 `curly` — auto-fixable via `eslint --fix`
- 95 `no-unused-vars` — manual; remove dead bindings, do not silence with disable comments
- 16 `eqeqeq` — manual and BEHAVIOR-SENSITIVE: `== null` / `!= null` are intentional null-or-undefined idioms; convert deliberately, do not blindly rewrite to `===`
- 2 `no-undef` — likely real bugs; investigate each rather than mechanically patching

Do not change the 8 configured rules or `.eslintrc.cjs`; this is a code-cleanup task, not a config-relaxation task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `./scripts/verify-local.sh static-analysis` passes the ESLint stage (stage 1 prints PASS and proceeds past ESLint)
- [x] #2 `npx eslint --ext .js --max-warnings 0 lib/` exits 0 with zero errors and zero warnings
- [x] #3 No `eslint-disable` comments are added to suppress violations; each error is fixed at the source
- [x] #4 The 2 `no-undef` findings are root-caused (real bug fixed, or shown to be a genuine global) rather than silenced
- [x] #5 `== null` / `!= null` null-ish idioms are preserved or converted deliberately; the `eqeqeq` fixes do not change runtime null/undefined semantics
- [x] #6 `.eslintrc.cjs` rule set is unchanged (still the 8 rules at error)
- [x] #7 `npm test` passes after the cleanup
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GATE-WIRING CONSTRAINT (applies to both cleanup missions, TASK-1360 + TASK-1361): the static-analysis gate is opt-in only. There is no `config/integration-pipelines.json`, so `px integrate` skips integration gates, and handoff/review use `npm test` as the verification command — these missions are NOT blocked by the static-analysis gate at integration time. Do NOT add the `static-analysis` dry-run as a blocking mission Gate (exit-0 required) in MISSION.md until BOTH cleanup tasks land. Note the partial-green ordering: fixing ESLint here makes only stage 1 green; the full three-stage gate stays red until TASK-1361 clears the tsc stage. Actually wiring static-analysis into the integration pipeline as a required gate is tracked separately in TASK-1362, after TASK-1361.
<!-- SECTION:NOTES:END -->
