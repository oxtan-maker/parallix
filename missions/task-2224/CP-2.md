# CP-2 — Stop-rule reassessment of the test typecheck boundary

## Summary

CP-1 collected a 5,331-diagnostic inventory, tripping the mission stop rule at
line 93 ("Stop and reassess if the initial typecheck error count exceeds 300").
CP-2 performs the required reassessment. It runs an empirical compiler-option
matrix, cross-checks the config against the governing ADR, and reaches a
blocking conclusion: **no `tsconfig.test.json` configuration reachable within
this mission's Restricted Areas produces a Stage 4 that exits 0**, so SC2/SC3/
SC4 cannot be satisfied without a mission-scope decision by the owner.

### Empirical config matrix (measured on the current tree)

| Config | Command | test/ errors | lib/index/px errors |
|---|---|---|---|
| `strict: true` (as committed, Scope line 19) | `tsc --noEmit --project tsconfig.test.json` | 5,331 | 0 |
| ADR §4-aligned (`noEmit`+`allowJs`+`checkJs`, no `strict`) | same, `strict` removed | 1,394 | 6 (all TS2578) |

Dominant `strict` codes: TS7006/TS7005/TS7034/TS7031 implicit-any (~3,550 of
5,331) — inherent untyped-CommonJS noise, not defects. Removing `strict`
clears that noise but (a) still leaves 1,394 test errors across 106 of 159
test files, and (b) surfaces 6 `TS2578` "Unused '@ts-expect-error' directive"
errors **inside `lib/`** (`lib/commands/integrate.ts`, `lib/tools/setup-review.ts`),
because those directives were authored for the strict emit project and become
unused once the shared program is non-strict.

### Why the constraints are mutually unsatisfiable

- The **only** config with 0 `lib/` errors is full `strict` — but that path
  requires clearing 5,331 test errors. Fixing them by hand exceeds one review
  mission; blanket `@ts-expect-error` would suppress ~100% of errors, directly
  violating stop rule line 95 (">50% without documented reason … revisit
  whether `strict` or `checkJs` … are appropriate").
- Relaxing `strict` to match **ADR 0044 §4** (which defines `tsconfig.test.json`
  as `noEmit`+`allowJs`+`checkJs` only — `strict` is listed for the *emit*
  project `tsconfig.json`, not the test project) drops the count but introduces
  6 errors in `lib/` — a **Restricted Area** (MISSION.md line 83) I may not edit
  or annotate — so Stage 4 still cannot exit 0.
- Converting any test file to `.ts` is forbidden by stop rule (deferred to
  ADR 0044 §9 phase T6). Editing `tsconfig.json` and `lib/` is forbidden.

### Notable scope discrepancy

Mission Scope line 19 specifies `strict: true` for `tsconfig.test.json`. This
**contradicts ADR 0044 §4** (`docs/adr/0044-workflow-distribution-model.md:157`),
which the mission's own "Why Now" cites as the governing decision and which
defines the test project without `strict`. SC1 (line 36) — the binding success
criterion — also omits `strict`. Recommended rescope: adopt the ADR §4 config
(no `strict`) and split the residual defect burn-down (1,394 checkJs errors +
the 6 lib directive collisions) into follow-on tasks, since it cannot land in a
single revert-sized mission.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Stop rule at 300 diagnostics was reassessed, not ignored | `missions/task-2224/MISSION.md:93`; matrix above (`tsc --noEmit --project tsconfig.test.json` → 5,331) | PASS |
| Config strictness evaluated against the governing ADR | `docs/adr/0044-workflow-distribution-model.md:157` (test project = `noEmit`+`allowJs`+`checkJs`, no `strict`) vs `missions/task-2224/MISSION.md:19` | PASS |
| No green Stage 4 config exists within Restricted Areas | `missions/task-2224/MISSION.md:83`; ADR-aligned run leaves 6 `TS2578` in `lib/commands/integrate.ts`, `lib/tools/setup-review.ts` | PASS (blocking) |
| SC2 (Stage 4 exits 0) achievable this mission | `missions/task-2224/MISSION.md:37`; both configs exit nonzero | FAIL (blocked) |
| SC4 (all errors fixed/annotated) achievable this mission | `missions/task-2224/MISSION.md:39`; would force ~100% `@ts-expect-error`, violating stop rule line 95 | FAIL (blocked) |

Next action: Escalate to the mission owner to rescope T1 — adopt the ADR 0044 §4 config (drop `strict`) and split the residual 1,394 `checkJs` defect burn-down plus the 6 `lib/` directive collisions into follow-on tasks; do NOT wire Stage 4 or mass-annotate until that decision lands, because every in-scope config leaves the gate red.
