# Mission: Extract stats normalization and windowing to stats-normalization.ts (task-2369.03)

## Goal
Extract 26 pure-function helpers (normalization, date parsing, time-windowing, accumulation) from `stats.ts` and `stats-report-rendering.ts` into a new `src/adapters/cli/commands/stats-normalization.ts`. All callers route through re-exports. No behavior change.

## Why Now
`stats.ts` is 1450 lines after .01 and .02 extractions. Normalization and windowing logic is pure-function, widely imported, and stable — clean extract target. This brings `stats.ts` below 1400 lines and decouples normalization from the stats command adapter.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: line-count reduction, import graph cleanup, pure-function isolation

## Scope
- Create `src/adapters/cli/commands/stats-normalization.ts` with all 26 extracted symbols
- Move from `stats.ts`: `STATS_HEADERS`, `USAGE_NUMBERS`, `normalizeStatsRow`, `normalizeImplementer`, `parseDateOnly`, `parseDateOnlyStrict`, `formatDateOnly`, `parseToday`, `createWindow`, `createRangeWindow`, `buildWeeklyWindows`, `canonicalizeStatsRow`, `sameStatsIdentity`, `accumulateIntegerStrings`, `accumulateDecimalStrings`, `mergeLabel`
- Move from `stats-report-rendering.ts`: `VALID_CLASSIFICATIONS`, `parseBooleanish`, `normalizeRow`, `normalizeRows`, `statsMissionKey`, `modelBelongsToImplFamily`, `isValidClassification`, `normalizeClassification`, `rowInWindow`
- `stats.ts` imports from `stats-normalization.ts` and re-exports all 26 symbols
- `stats-report-rendering.ts` imports from `stats-normalization.ts` (replacing current self-defined or `stats.ts` imports for moved symbols)
- All existing callers (src/ and test/) continue importing from `stats.ts` or `stats-report-rendering.ts` — no caller-side changes
- `./scripts/verify-local.sh static-analysis` passes

## Out of Scope
- Behavior changes to any normalization, windowing, or accumulation logic
- Changes to callers outside `stats.ts` and `stats-report-rendering.ts`
- Renaming or signature changes of extracted functions
- Test file reorganization (tests continue importing from `stats.ts`)
- Documentation updates (internal refactor, no user-visible change)

## Success Criteria
- SC1: `stats.ts` line count is below 1400 after extraction
- SC2: `stats-normalization.ts` exists and exports exactly: `STATS_HEADERS`, `USAGE_NUMBERS`, `VALID_CLASSIFICATIONS`, `normalizeStatsRow`, `normalizeImplementer`, `normalizeRow`, `normalizeRows`, `normalizeClassification`, `isValidClassification`, `parseBooleanish`, `formatDateOnly`, `parseDateOnly`, `parseDateOnlyStrict`, `parseToday`, `formatDateOnly`, `createWindow`, `createRangeWindow`, `buildWeeklyWindows`, `rowInWindow`, `statsMissionKey`, `modelBelongsToImplFamily`, `canonicalizeStatsRow`, `sameStatsIdentity`, `accumulateIntegerStrings`, `accumulateDecimalStrings`, `mergeLabel`
- SC3: `stats.ts` re-exports all 26 symbols (imported from `stats-normalization.ts`)
- SC4: `stats-report-rendering.ts` imports moved symbols from `stats-normalization.ts` instead of defining them locally
- SC5: No test file outside `stats.ts`/`stats-report-rendering.ts` needs import-path changes (verified by static-analysis)
- SC6: `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs + test-hygiene)
- SC7: `test/stats.test.ts` passes without modification
- SC8: `test/stats-report.test.ts` passes without modification

## Risks and Assumptions
- R1: Circular import risk if `stats-normalization.ts` imports from `stats.ts` or vice versa. Mitigation: `stats-normalization.ts` is a leaf module with no internal Parallix imports.
- R2: `stats-report-rendering.ts` currently defines 9 of the 26 functions locally. Moving them requires updating both the definition site and the `stats.ts` import. Mitigation: extract to new file first, then update both consumers.
- A1: All 26 functions are pure (no side effects, no I/O). Verified by code review of function bodies.
- A2: No runtime callers depend on the module boundary (all imports resolved via static analysis).

## Checkpoints
- CP 1: Create `stats-normalization.ts` with all 26 symbols, update `stats.ts` and `stats-report-rendering.ts` to import from it, verify static-analysis and tests pass

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `node --test test/stats.test.ts` ``
  2. **Test names** — e.g., `"normalizeStatsRow handles missing fields"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/stats.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| stats.ts below 1400 lines | `wc -l src/adapters/cli/commands/stats.ts` → 1310 | PASS |
| stats-normalization.ts exports all 26 symbols | `src/adapters/cli/commands/stats-normalization.ts` | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |
| stats.test.ts passes | `node --test test/stats.test.ts` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `src/adapters/cli/commands/stats.ts` — only remove extracted functions and add re-exports; no logic changes
- `src/adapters/cli/commands/stats-report-rendering.ts` — only remove extracted functions and add imports; no logic changes
- All test files — no modifications allowed (refactor must be transparent to tests)
- No new dependencies

## Stop Rules
- Stop if extraction reveals a function with I/O or side effects (not pure) — reassess scope
- Stop if static-analysis fails after extraction and the fix requires changing a caller outside the two source files
- Stop if `stats.ts` line count does not drop below 1400 — reassess which symbols to extract
