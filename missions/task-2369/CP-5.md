# CP-5 — Parts F + G + H, contradiction sweep, and final gates

## Summary

Parts F (contemporary telemetry has no completion authority) and G (canonical
repository identity) required **no code change** — both were already correct at
baseline, so per the mission stop rule they are recorded with proof rather than
churned. Part H (stats-surface agreement) required no production change either;
it gained a regression proving the three surfaces still agree after the
premature completion path was removed.

The one test-side fix in this checkpoint: the R2 fixture used
`source: 'integration-gates'` for its verification fact, which is not a member of
the declared `SourceFact` source union. Changed to `'git'`; the file is now
clean under `npx tsc --noEmit --project tsconfig.test.json`.

Review round 2 removed the accidentally tracked, author-specific `node_modules`
symlink and restored the ignore rule. The local dependency link remains ignored;
no production behavior changed.

### Contradiction sweep (final tree, every relevant match classified)

| Pattern | Matches in `src/` | Classification |
|---|---|---|
| `command: { type: 'integrate' }` | none | Removed. The only producer of the `integrate` command is `MissionIntegrationService.decideIntegration()`, which constructs it inline as `decideMission(loaded.mission, { type: 'integrate' })`. |
| `promoteTaskForIntegrationIfNeeded` | 5 (definition, dry-run call, Step-4 call, test-seam attachment, export list) | All Backlog-representation only; no lifecycle side effect remains in the body. |
| `decideIntegration` | 2 (`integrate.ts` call site, service definition) | Exactly one production call path, from `persistLandedIntegrationOrAbort()`. |
| `new Date().toISOString()` in `integrate.ts` | 1 (`closedAt`) | Administrative closure time by design; commented at the call site. Delivery completion uses the landed commit time. |
| `pr_fix_rounds ?? 0`, `reviewFixRounds ?? 0` | none | Removed. |
| `defaultPrFixRounds` | 3 (definition, two live writer call sites) | Returns `undefined` for unknown; both call sites forward the caller's store. |
| `measurementToStatsRow` | 5 (definition, two read paths, export list, test seam) | NULL `pr_fix_rounds` maps to `undefined`; other columns keep the historical `'0'`. |
| `closed` in live stats/telemetry paths | 1 (`parseBooleanish` accepts the literal `'closed'`) | Not a completion authority: it parses a **PR merge-state** token and is reached only from `normalizeRow` → `generateMarkdownReport`, which has no caller and is not exported. Left untouched (correctness-only scope). |
| `isCompletedStatisticsRow` | none in `src/` or `test/` | Absent; no renamed equivalent introduced. |
| `product.name` | `stats.ts` read-side alias only (`legacyStatsRepoAliases`), plus unrelated CLI version banner and `setup-review` prompt | Never used for new-write identity. |
| `resolveStatsRepoName` | 10 | Delegates to `resolveCanonicalRepositoryId()`; every new write uses it. |

No search result was bulk-replaced; each was read and classified.

### Docs (DoD #5)

No documentation change is required. `docs/metric-contract.md` already states
the contract this mission enforces — "`completedAt` is the first
`integration → done` event. A later `done → done` `close` event is `closedAt`
administration: it may bound final-state dwell but cannot alter delivery
completion, its week, or lifecycle cycle time" and "`null` means unavailable; a
numeric `0` means an observed zero". The code now matches the documented
contract; no user-facing behavior claim in `docs/` described the removed
promotion-side completion.

### Known baseline noise (not introduced here)

`./scripts/verify-local.sh static-analysis` stage 4 (test typecheck) reports two
errors — `src/application/projections/board-readers.ts(132,9)` and
`test/task-2368-agent-running-review-detection.test.ts(45,10)`. Both are present
at `fb40bd716b2a0f6a761a2fbc500533b68857b8d8` (verified by checking that tree
out and rerunning the same command); neither is in a file this mission touched.
`./scripts/verify-local.sh all` exits 0.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC09/AC26/AC27/AC28 no contemporary telemetry field decides completion, no renamed flag | `test/task-2369-regressions.test.ts`, `"R7: telemetry cannot decide Mission completion"` — asserts no `closed`/`completed`/`is_final`/`is_closed` column in `STATS_HEADERS` and that only the lifecycle key admits a mission to the completed population | PASS |
| SC10/SC19/AC29/AC30 new telemetry writes use the canonical repository id | `test/task-2369-regressions.test.ts`, `"R8: new telemetry writes use the canonical repository id, not product.name"`; broader coverage in `test/task-2363-repository-identity.test.ts` | PASS |
| SC11/AC31/AC32 integration-time report, `px stats`, and BoardMetrics agree | `test/task-2369-regressions.test.ts`, `"the integration-time report, px stats, and BoardMetrics agree on the completed population"` | PASS |
| SC26/AC33/AC34 rolling window semantics unchanged; no historical population re-enters current metrics | `test/task-2369-regressions.test.ts`, `"R4: decision-window membership follows the landed timestamp"`; window definition untouched — `buildWeeklyWindows` still delegates to `weeklyDecisionWindows`; `docs/metric-contract.md` weekly-decision-window row | PASS |
| SC12/SC15/SC16 R1, R4, R5 red at baseline and green now | `missions/task-2369/CP-1.md` baseline table; `npm test -- test/task-2369-regressions.test.ts` — 11 pass, 0 fail | PASS |
| SC13/SC14/SC17/SC18/SC21 R2, R3, R6, R7 pass; resume reconciles exactly once | `test/task-2369-regressions.test.ts`, `"R2: an approved normal integration completes exactly once and a retry stays at one"`, `"R3: a review-origin integration completes only after the commit has landed"`, `"R6: [0, 2, unknown, unknown] reports exactly two review-fix observations"` | PASS |
| SC20/AC41 verification gate passes on the final tree | `./scripts/verify-local.sh all` — exit 0, 2219 tests, 0 fail | PASS |
| SC27/AC40 `git diff --check` passes | `git diff --check` — clean, no output | PASS |
| AC42/SC27 no focused or unannotated skipped tests introduced | `grep -rn "\.only(\|\.skip(" test/task-2369-regressions.test.ts` — no matches; `./scripts/verify-local.sh static-analysis` stage 3 reports `PASS: no test-hygiene violations` | PASS |
| DoD #2 lint and static analysis clean on changed files | `./scripts/verify-local.sh static-analysis` — `PASS: ESLint clean`, `PASS: tsc typecheck clean`; `npx tsc --noEmit --project tsconfig.test.json` reports nothing for `test/task-2369-regressions.test.ts` | PASS |
| AC39 no agent, LLM, mission runner, or network in certification tests | `test/task-2369-regressions.test.ts` — Git/Forgejo/process seams injected via `test/lib/module-mock.ts`, real temporary SQLite via `test/fixtures/task-2357-statistics-fixture.ts`; no agent module imported | PASS |
| AC35/AC36 no parallel architecture; no TASK-2369.x structural cleanup pulled in | `git diff --name-only main...HEAD -- src/` lists four source files — `src/adapters/cli/commands/integrate.ts`, `src/adapters/cli/commands/stats.ts`, `src/application/projections/metrics-read-adapter.ts` (plus one line-number citation in `src/application/consumer-domain-requirements.ts`); no module split, no new service | PASS |
| DoD #5 docs reflect behavior | `docs/metric-contract.md:11` (Completion) and `docs/metric-contract.md:14` (Missing data) already state the enforced contract; no doc edit required | PASS |
| DoD #6 red-to-green reproduction exists | `missions/task-2369/CP-1.md` (6 of 9 red at baseline) → `npm test -- test/task-2369-regressions.test.ts` (11 pass) | PASS |
| Round-2 P2 contains no machine-specific tracked dependency path | `git ls-files node_modules` returns no entry; `./scripts/verify-local.sh all` passes with the local dependency path ignored | PASS |

Next action: hand off to review — every declared checkpoint (CP-1 … CP-5) is committed, the round-2 portability finding is resolved, and `./scripts/verify-local.sh all` plus `git diff --check` pass on the final tree.
