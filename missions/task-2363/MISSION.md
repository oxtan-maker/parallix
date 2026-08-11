# Mission: FLOW weekly decision window + statistics integrity (task-2363)

## Goal
Make the Parallix operator board (FLOW in `px ui` / `npm run dev`) a weekly experiment-decision surface by restricting completed-mission statistics to a rolling 7-day decision window, and close the remaining statistics-integrity gaps: unknown `reviewFixRounds` collapsing to zero, repository identity split for new measurements, and missing production-path certification.

## Why Now
TASK-2357 established the statistics architecture (lane events, usage records, `ConcreteMetricsReadAdapter`, `BoardMetrics`, cohort comparison). FLOW now displays lifecycle statistics over all historical completed missions (n=200+), which is not useful for weekly product decisions and is unsafe while the database contains historical measurements produced during periods when statistics bugs existed. Parallix completes enough missions per week for a rolling weekly population to be actionable. The CLI `px stats` already uses this cadence — the board must match.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: shared window extraction, window filtering across metrics/cohorts/adapter, FLOW presentation redesign, reviewFixRounds null-preservation audit, repository identity fix, and full production certification test

## Scope
- Extract shared decision-window semantics (current 7-day + previous 7-day) from `px stats` into application layer, reused by CLI and board
- Window all completed-mission decision metrics in `metrics.ts`: `medianStateTimes`, `medianAgentRuntime`, `medianCycleTimeByState`, `reviewBounceRate` — cohort selected by `closedAt` inside window, full lifecycle used once selected
- Window cohort comparison in `cohorts.ts`: default FLOW cohort restricted to current 7-day window
- Window `ConcreteMetricsReadAdapter.buildMetrics()` so `BoardMetrics` reflects windowed population
- FLOW (`flow-panel.tsx`) renders current/previous window dates, windowed metrics with observation counts, and visually distinguishes current-state operational metrics (WIP, lane age, bottleneck, agent availability) from completed-mission decision metrics
- Audit `reviewFixRounds` end-to-end: producer → SQLite → read → `MissionOutcome` → cohort → `BoardMetrics` → FLOW. Unknown stays SQL NULL / semantic unavailable. Known zero stays zero.
- Fix repository identity for new measurement data: canonical `repositoryId` used consistently, not `product.name` display alias
- Production-composition certification test: deterministic seeded facts through real Git repo + worktree + migrated SQLite → `ConcreteMetricsReadAdapter` → `BoardProjectionBuilder` → `BoardMetrics` → FLOW. No agent, no LLM, no network.
- Contaminated-history regression fixture: 240+ old completed missions with extreme cycle times that must not affect current-window metrics
- Hand-computed oracle: expected values specified independently of production statistics helpers

## Out of Scope
- Statistics architecture redesign (TASK-2357 architecture stands)
- Statistical significance: no p-values, confidence intervals, Bayesian ranking, or minimum detectable effect
- `px stats` default weekly behavior change (CLI output must remain identical)
- Cleaning or migrating historical database rows
- Moving statistics calculations into React/Ink (FLOW renders only)
- New parallel statistics/cohort/outcome architecture
- Adding dependencies

## Success Criteria
- SC01: `weeklyWindow()` current-window logic (today-6 to today inclusive) extracted to application layer as a reusable primitive, imported by both `stats-command-use-case.ts` and board metrics path
- SC02: Previous non-overlapping 7-day window (today-13 to today-7 inclusive) defined alongside current window in same application-level primitive
- SC03: `medianStateTimes` series uses only outcomes whose `closedAt` falls inside the relevant decision window; `observationCount` reflects windowed population
- SC04: `medianAgentRuntime` series uses measured runtime from outcomes in the selected window; agent runs not filtered individually by run timestamp
- SC05: `medianCycleTimeByState` (lane dwell) uses full lifecycle intervals of missions completed in the selected window; intervals not truncated at window boundary
- SC06: `reviewBounceRate` computed from lifecycle transitions of missions completed in the selected window
- SC07: Default FLOW cohort comparison contains only missions completed in current 7-day window; six-month-old missions excluded
- SC08: Current-state operational metrics (WIP, lane age, bottleneck, agent availability) remain unwindowed and visually distinguishable from completed-mission decision metrics in FLOW
- SC09: FLOW displays current rolling-7-day date range (e.g. "2026-08-05 → 2026-08-11")
- SC10: FLOW displays actual observation count `n` for each main decision metric
- SC11: Fixture with 240+ old completed missions (>30 days ago, cycle times 800-1200 min) leaves current-window cycle-time `n` and median unchanged
- SC12: Same contaminated-history fixture proves old missions cannot affect current agent-runtime, dwell, bounce, or cohort metrics
- SC13: Current-window fixture has ~30 completed missions with exact hand-computed expected values asserted in tests
- SC14: Mission starting before window but completing inside contributes full lifecycle statistics
- SC15: Mission starting inside window but not completing does not enter completed-mission decision statistics
- SC16: Default `px stats` weekly output is behavior-preserving after shared-window extraction (existing tests pass)
- SC17: `reviewFixRounds` unknown (`null` in `MissionOutcome`) remains `null` through SQLite storage, read, cohort aggregation, and FLOW display; observation count excludes unknown values
- SC18: `reviewFixRounds` known zero (0) remains distinguishable from unknown; contributes to observation count
- SC19: Newly written measurement records use canonical `repositoryId`; deliberately different `product.name` does not create split identity
- SC20: Repository B with overlapping mission ID cannot contaminate repository A's statistics
- SC21: Production certification test uses real temporary Git primary repo + real Git worktree + migrated SQLite DB + production persistence adapters
- SC22: Production certification reaches `ConcreteMetricsReadAdapter` → `BoardProjectionBuilder` → `BoardMetrics` → FLOW rendering
- SC23: Production certification starts no agent, invokes no LLM, executes no mission runner, makes no network call
- SC24: Certification expected values hand-computed independently of production statistics helpers (no production median/cohort/window functions used to derive expected values)
- SC25: Critical assertions use exact values/populations, not only non-null/type/existence checks
- SC26: Regressions are sensitive to reintroducing all-history aggregation (old behavior would fail targeted regression tests)
- SC27: Regressions are sensitive to unknown-reviewFixRounds→zero collapse
- SC28: Regressions are sensitive to split repository identity
- SC29: No statistics calculations moved into `flow-panel.tsx` / React; FLOW formats only
- SC30: `./scripts/verify-local.sh all` passes; no focused or unannotated skipped tests introduced

## Risks and Assumptions
- **Risk**: Extracting `weeklyWindow` from CLI adapter into application layer may require small interface changes in `stats-command-use-case.ts`. Assumption: the CLI adapter imports the application layer, not the reverse.
- **Risk**: Windowing `medianCycleTimeByState` requires access to `closedAt` per mission to filter lane intervals. Current `metrics.ts` computes dwell from all transitions. Assumption: `MissionOutcome` provides `closedAt` for the join.
- **Risk**: 240 old missions + 30 current + 28 previous = 298 total fixture missions; certification test setup may be verbose. Assumption: programmatic generation of old missions is acceptable; hand-computed expectations apply to decision windows only.
- **Assumption**: `reviewFixRounds` null-preservation issue is in the read path (`ConcreteMetricsReadAdapter`) and/or cohort aggregation, not in the domain type (which already uses `number | null`).
- **Assumption**: Repository identity split is caused by measurement writes using `product.name` while lifecycle uses canonical git-derived `repositoryId`.

## Checkpoints
- CP 1: Baseline regressions — record `git rev-parse HEAD` and `git status --short`, then author failing regression tests proving: (a) FLOW cycle-time `n` includes historical missions, (b) historical extreme cycle times change displayed current median, (c) current/previous decision windows not available in FLOW, (d) unknown `reviewFixRounds` collapses to zero, (e) product/repository identity divergence exists. If any item already fixed on baseline, record evidence and skip.
- CP 2: Shared window primitive — extract `weeklyWindow` (current: today-6→today, previous: today-13→today-7) into application layer. Define `DecisionWindow` type with `current`, `previous`, `contains(closedAt)`, and window label helpers. Verify `px stats` default behavior unchanged.
- CP 3: Windowed metrics — add window parameter to `medianStateTimes`, `medianAgentRuntime`, `medianCycleTimeByState`, `reviewBounceRate` in `metrics.ts`. Filter outcomes by `closedAt` inside window before computing. Lane intervals use full lifecycle of selected missions.
- CP 4: Windowed cohorts and adapter — restrict `compareCohorts` default FLOW cohort to current window. Wire `ConcreteMetricsReadAdapter.buildMetrics()` to pass windowed outcomes. `BoardMetrics` reflects windowed population.
- CP 5: FLOW presentation — update `flow-panel.tsx` to render current/previous window dates, windowed decision metrics with `n`, and visually separate current-state operational metrics. No calculation in React.
- CP 6: Integrity fixes — audit `reviewFixRounds` null preservation end-to-end. Fix any `?? 0` / `|| 0` / `parseInt(undefined)` constructs. Fix repository identity for new measurement writes to use canonical `repositoryId`.
- CP 7: Production certification — author full certification test: real Git repo + worktree + migrated SQLite → production adapters → `BoardMetrics` → FLOW. Contaminated-history fixture (240 old + 30 current + 28 previous). Hand-computed oracle. No-agent guard.
- CP 8: Regression sensitivity — prove each critical regression test turns red under the old behavior (temporarily reintroduce old logic, verify red, restore). Clean up.
- CP 9: Final verification — `./scripts/verify-local.sh all`, `git diff --check`, doc update for rolling-window semantics.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2363-windowed-metrics.test.ts` ``, `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"contaminated history does not affect current-window cycle time"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2363-certification.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Raw shell output alone is insufficient evidence.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Shared window primitive extracted | `src/application/services/decision-window.ts`, test `"weeklyWindow returns current and previous 7-day ranges"` | PASS |
| px stats default unchanged | `npm test -- test/stats.test.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `flow-panel.tsx` — no statistics calculations; renders only
- `px stats` CLI default output — behavior-preserving refactoring only
- Historical database rows — not cleaned or migrated
- Agent launch path — not touched in certification test
- Statistics architecture (TASK-2357 types and adapters) — extended, not replaced

## Stop Rules
- Stop if windowing requires a new Outcome/Cohort representation (extend existing functions instead)
- Stop if `px stats` default weekly output changes (behavior must be preserved)
- Stop if FLOW starts computing statistics (presentation renders only)
- Stop if certification test invokes an agent, LLM, or network call
- Stop if historical rows are cleaned/migrated to fix metrics (semantics must filter, not delete)
- Stop if unknown `reviewFixRounds` becomes zero anywhere in the path
- Stop if a new dependency is needed for windowing or statistics
