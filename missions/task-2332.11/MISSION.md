# Mission: Re-home stats workflow behind an application use case (task-2332.11)

## Goal
Move the stats command's orchestration from the 2400-line adapter (`src/adapters/cli/commands/stats.ts`) into a single application use case (`src/application/stats-command-use-case.ts`). The use case sequences all workflow steps through ports. CLI adapter retains only arg parsing, output formatting, and exit-code mapping. `StatisticsService` remains the canonical authority for identity, completion, and windowing semantics.

## Why Now
`stats.ts` sequences multiple adapters (measurement store, git, forgejo, backlog, config) directly — violating ADR 0051 application-boundary rule. This blocks other tasks from reusing stats orchestration (e.g. TUI stats, board stats) without duplicating the adapter chain. TASK-2332.07 (handoff) is the only hard dependency and can develop in parallel.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: new use case file + port interface + adapter thin-out + composition wiring + 4 test scenarios

## Scope
- Create `src/application/stats-command-use-case.ts` — application entry point following `DraftCommandUseCase` pattern
- Define `StatsWorkflowPort` interface in `src/application/ports/cli-workflows.ts` (or new `ports/stats-workflow.ts`)
- Refactor `src/adapters/cli/commands/stats.ts` so the default export delegates to the use case; parsing, rendering, and exit mapping stay in adapter
- Wire use case through composition root (`src/composition/create-cli.ts`)
- Fast mocked-port tests covering: report (weekly/range), backfill path, absent data (empty store), and Forgejo-unavailable paths
- All tests mock ports — no real network, no agent execution, no real SQLite

## Out of Scope
- Cohort comparison (`statsCohorts`) — separate module, untouched
- Legacy CSV import/analysis (`import-legacy`, `readLegacyStatsCsv`) — explicit boundary, unchanged
- `stats-report.ts` rendering functions — already extracted, untouched
- StatisticsService semantics (identity, completion, windowing) — unchanged
- Measurement store schema or ADR 0053 rules — unchanged
- TUI stats or board stats consumers — future tasks

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `src/adapters/cli/commands/stats.ts` default export calls exactly one `StatsCommandUseCase.execute()` and does not sequence `git()`, `forgejo.*`, `loadEffectiveConfig()`, or `resolveTaskFile()` directly in the main report path
- SC2: `StatsCommandUseCase` delegates canonical identity (`statisticsMissionKey`), completion (`isCompletedStatisticsRow`), and windowing (`statisticsRowInWindow`, `summarizeCompletedMissionWindow`) to `StatisticsService` — verified by import presence in use case or its port
- SC3: Arg parsing (`--mission`, `--from`, `--to`, `--csv-file`, `--group-by`, `--output`, `--today`), output formatting (`log()`, `error()`, `fmt.*`), and exit-code mapping (`exit(0/1)`) all live under `src/adapters/cli/commands/stats.ts` or `src/interfaces/cli/`
- SC4: Four mocked-port test scenarios exist and pass: (a) weekly report renders with data, (b) range report renders with data, (c) empty store returns "No data" output, (d) Forgejo-unavailable path returns graceful error — all in `test/` with mocked ports, no real network or agent
- SC5: `px stats` text output (weekly and range modes) and `px stats --output file.txt` produce identical content to pre-mission output for same input data — verified by diff or snapshot test
- SC6: `./scripts/verify-local.sh static-analysis` passes on all changed files (ESLint + tsc --checkJs + test-hygiene)
- SC7: No `.only` or bare `.skip` introduced in any test file

## Risks and Assumptions
- 2400-line `stats.ts` has 60+ functions and `@ts-nocheck`; use case extraction must not break the 180+ implicit-any callback chain. Mitigation: adapter keeps all internal functions, only the entry point changes
- `stats.ts` imports from 8+ adapters (git, forgejo, backlog, config, sqlite, stats-report, stats-cohorts, cli-format). Port interface must cover all without leaking adapter types
- Existing callers (composition root, other commands) import named exports from `stats.ts` — all named exports must remain available
- TASK-2332.07 (handoff) may modify composition wiring; integration tested independently
- `deriveImplementerAndFixRounds` and `resolveMissionClassification` read git/forgejo/backlog — these become port methods, not direct adapter calls in use case

## Checkpoints
- CP 1: Define `StatsWorkflowPort` interface and `StatsCommandUseCase` class with execute() method. Port covers: load measurements, resolve classification, derive implementer/fix-rounds, resolve repo name, optional forgejo lookup. Use case sequences: resolve mode (weekly/range/mission) → load rows → apply window → compute summaries → return result object.
- CP 2: Refactor `src/adapters/cli/commands/stats.ts` entry point to delegate to use case. Adapter parses args, constructs port implementation, calls use case, formats result, maps exit code. All internal helper functions remain in adapter.
- CP 3: Wire through composition root (`create-cli.ts`). Verify existing named exports from `stats.ts` still resolve. Run `./scripts/verify-local.sh all`.
- CP 4: Author mocked-port tests (report, range, absent data, forgejo-unavailable). Verify SC4-SC7. Final Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Use case delegates to StatisticsService | `src/application/stats-command-use-case.ts:12` imports `statisticsMissionKey` from `statistics-service.js` | PASS |
| Adapter entry calls use case | `src/adapters/cli/commands/stats.ts:2170` calls `useCase.execute()` | PASS |
| Mocked test for empty store passes | `test/stats-use-case.test.ts`, `"weekly report with empty store returns no data message"` | PASS |
| Static analysis clean | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/application/services/statistics-service.ts` — semantics unchanged, no edits
- `src/adapters/cli/commands/stats-cohorts.ts` — cohort comparison untouched
- `src/adapters/cli/commands/stats-report.ts` — rendering functions untouched
- `src/application/stats-backfill-service.ts` — backfill service untouched (separate workflow)
- `src/domain/` — no domain changes
- `src/application/domain-ports.ts` — no port changes to existing domain ports
- `docs/adr/` — no new ADR required (architecture migration, not a decision)

## Stop Rules
- Stop if `statistics-service.ts` semantics (identity, completion, windowing) require modification — that is a separate mission
- Stop if cohort comparison (`statsCohorts`) needs use case treatment — out of scope, file future task
- Stop if legacy CSV import path needs restructuring — explicit boundary, unchanged
- Stop if more than 3 named exports from `stats.ts` break for downstream consumers — reassess port surface
- Stop if static-analysis gate fails on files not touched by this mission — investigate pre-existing failure, do not fix inline
