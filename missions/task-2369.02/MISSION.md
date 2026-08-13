# Mission: Extract stats report rendering to stats-report-rendering.ts (task-2369.02)

## Goal
Extract 14 rendering functions and 2 constants from `src/adapters/cli/commands/stats.ts` into a new `src/adapters/cli/commands/stats-report-rendering.ts`, reducing stats.ts from ~2209 to ~1600 lines, with zero behavior change for all callers.

## Why Now
task-2369.01 (Remove CSV import) already trimmed stats.ts. This extraction continues the same thinning pass — isolates report-rendering logic so stats.ts owns data loading + command wiring, and rendering lives in its own module. Unblocks further stats.ts simplification.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: mechanical extract + re-export. No new logic, no API change. 15 symbols move between two files in same directory. Existing test suite covers all extracted functions.

## Scope
- Create `src/adapters/cli/commands/stats-report-rendering.ts` with these 16 symbols:
  - `groupBy`, `computeImplStats`, `computePeriodStats`
  - `generateMarkdownReport`
  - `summarizeMissionWindow`, `computeAgentMissionGroups`, `summarizeAgentWindow`, `summarizeAgentStageSpend`
  - `formatAgentSpendCell`, `colorAverageFixRounds`, `colorMissionCounts`
  - `AGENT_SPEND_STAGE_COLUMNS`, `MISSION_PHASE_ORDER`
  - `classifyAgentSpendFamily`
  - `renderMissionPhaseReport`
- Remove those symbols from `stats.ts` body; add `import ... from './stats-report-rendering.js'` and re-export in `stats.ts`
- Verify `stats-report.ts` (task-2217 extract) still resolves its imports via `stats.ts` re-exports
- Verify all test files continue to pass: `test/stats-report.test.ts`, `test/mission-phase-stats.test.ts`, `test/task-2369-regressions.test.ts`, `test/stats-active-breakdown.test.ts`, `test/task-2348-implementer-attribution.test.ts`, `test/task-2347.08-own-statistics-semantics-repro.test.ts`

## Out of Scope
- Behavior changes to any rendering function
- Extracting data-loading functions (`loadMeasurementRows`, `upsertMeasurementRow`, etc.)
- Extracting command-wiring (`createStatsCommand`, `createStatsWorkflowAdapter`)
- Test file re-organization (test files may keep importing from `stats.ts` via re-exports)
- Documentation updates (no user-facing change)

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `src/adapters/cli/commands/stats-report-rendering.ts` exists and exports all 16 listed symbols
- SC2: `stats.ts` line count <= 1650 (measured via `wc -l`)
- SC3: `stats.ts` imports each extracted symbol from `./stats-report-rendering.js` and re-exports it in the named export block (line 2149)
- SC4: `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs + test-hygiene)
- SC5: `test/stats-report.test.ts` passes (renderMissionPhaseReport, summarizeMissionWindow, formatAgentSpendCell)
- SC6: `test/mission-phase-stats.test.ts` passes (renderMissionPhaseReport with cost, review, exec stages)
- SC7: `test/task-2369-regressions.test.ts` passes (summarizeMissionWindow regression assertions)
- SC8: `test/stats-active-breakdown.test.ts` passes (renderMissionPhaseReport active stats)
- SC9: `test/task-2348-implementer-attribution.test.ts` passes (summarizeAgentWindow implementer logic)
- SC10: `test/task-2347.08-own-statistics-semantics-repro.test.ts` passes (summarizeMissionWindow semantics)
- SC11: `src/adapters/cli/commands/stats-report.ts` compiles without error — its imports from `./stats.js` still resolve via re-exports
- SC12: `src/adapters/cli/commands/integrate.ts` compiles — its `(stats as any).renderMissionPhaseReport(...)` call still resolves

## Risks and Assumptions
- Circular dependency risk: `stats-report.ts` imports from `stats.ts`; `stats.ts` will import from `stats-report-rendering.ts`. No cycle introduced because `stats-report-rendering.ts` does not import `stats.ts` (it is a leaf module).
- `renderMissionPhaseReport` in `stats.ts` currently wraps `_renderMissionPhaseReport` from `stats-report.ts`. Moving it to `stats-report-rendering.ts` means that wrapper moves too — verify the import chain holds.
- `groupBy`, `computeImplStats`, `computePeriodStats` are internal helpers (no external import). They move with `generateMarkdownReport` which uses them.
- `MISSION_PHASE_ORDER` in `stats.ts` is defined after the `statsReport` import. It moves to `stats-report-rendering.ts` alongside `renderMissionPhaseReport` which references it.
- Assumption: no runtime path imports extracted symbols directly from `stats-report-rendering.ts` before this mission (file does not exist yet).

## Checkpoints
- CP 1: Create `stats-report-rendering.ts` with all 16 symbols. Verify it compiles standalone (`tsc --noEmit` on the file). Confirm no missing imports.
- CP 2: Update `stats.ts` — remove extracted symbols, add import + re-export. Verify line count <= 1650. Run `./scripts/verify-local.sh static-analysis`.
- CP 3: Run full test suite for affected tests. Confirm SC5–SC10 all pass. Verify `stats-report.ts` and `integrate.ts` compile.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `wc -l src/adapters/cli/commands/stats.ts` ``
  2. **Test names** — e.g., `"renderMissionPhaseReport renders phase table"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/stats-report.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| stats-report-rendering.ts exports 16 symbols | `src/adapters/cli/commands/stats-report-rendering.ts` — grep for `export` | PASS |
| stats.ts line count <= 1650 | `wc -l src/adapters/cli/commands/stats.ts` → 1587 | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |
| stats-report.test.ts passes | `test/stats-report.test.ts` — all 4 tests green | PASS |
| mission-phase-stats.test.ts passes | `test/mission-phase-stats.test.ts` — all 11 tests green | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `src/adapters/cli/commands/stats-report.ts` — do not modify (task-2217 extract, imports via re-export only)
- `src/adapters/cli/commands/integrate.ts` — do not modify (caller, verify it compiles)
- All test files — do not modify (verify they pass; re-importing from new file is out of scope)
- `src/adapters/cli/commands/draft-prompts.ts` — do not modify (imports `stats`, verify it compiles)
- `src/adapters/review/review-agent-fallback.ts` — do not modify (imports `statsModule`, verify it compiles)

## Stop Rules
- Stop if extracted symbols have cross-dependencies on data-loading functions still in `stats.ts` that create a circular import — re-evaluate which functions belong in which file
- Stop if `stats.ts` line count after extraction > 1700 — some symbols may not be rendering functions; re-check backlog task list
- Stop if static-analysis reports type errors in `stats-report-rendering.ts` that require adding JSDoc types — add minimal types, do not expand scope to full type-annotation pass
