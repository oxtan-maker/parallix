# CP-4: Remove default CSV paths, prove zero unclassified access, update docs

## Summary

**Removals completed.** Beyond the helpers retired in CP-2, this checkpoint
removed the last two production CSV touchpoints found by the new guard:

- `resolveStatsRelPathFn` in `commitSafeMissionArtifacts`
  (`src/platform/runtime/lib/review/rebase.ts:34`). It let the pre-rebase
  auto-commit stage a repo-root stats CSV. It was already dead in production
  (both callers omit it), and a `stats.csv` inside a checkout is now ordinary
  user content that must *not* be auto-committed.
- The `stats.csv` mention in the top-level CLI help
  (`src/platform/runtime/index.ts:300`) and in `px stats-backfill --help`
  (`src/platform/runtime/lib/commands/stats-backfill.ts:343`), both of which
  now name the measurement database as the authority.

**Zero-unclassified-access proof.** `test/stats-csv-authority-guard.test.ts`
scans every `.ts` file under `src/`, strips comments, and fails if any file
outside the single named boundary (`commands/stats.ts`) mentions `stats.csv` in
executable code, or if any file still calls one of the eight removed helpers. A
third test pins the ADR 0053 inventory: the only stats-CSV entry for
`AgentRunMeasurement`/`MissionOutcome` is
`measurement-legacy-csv-import`, classified `explicit-one-way-legacy-input`,
and the default path for both concepts is
`src/adapters/sqlite/measurement-store.ts`.

**Regression coverage.** Restart, duplicate import, concurrent updates, and
database failure are covered at both the store layer
(`test/measurement-store-cutover.test.ts`) and the command layer
(`test/stats-csv-authority-guard.test.ts`), all on temporary SQLite files with
no Forgejo, agent, or child process.

**Guardrail refinement.** `test/persistence-inventory-guardrail.test.ts:346`
required every non-SQLite compatibility entry to name a cutover task. An
`explicit-one-way-legacy-input` boundary is permanent by ADR 0053's own
classification and has no cutover task to name, so the rule now exempts that
classification alongside the SQLite adapter paths.

**Documentation.** `docs/authority-reference.md:275` now states the database
authority, the no-fallback rule, the `(repo, mission, stage, actor)` identity,
and the import workflow. ADR 0053's `AgentRunMeasurement`/`MissionOutcome` row
(`docs/adr/0053-operational-persistence-and-authority-boundaries.md:96`) records
the completed cut-over. `README.md:42`, `docs/use-cases.md:56`,
`docs/real-agent-smoke.md:182`, and `src/domain/README.md:58` were updated;
historical evidence passages in `docs/use-cases.md` and `docs/adr/0041` that
describe past measurements were deliberately left as written.

**Integration-only tests updated** (they never run in the default suite, so
they were repaired by direct inspection and targeted runs):
`test/e2e-real-agent-smoke.test.ts` now asserts the isolated `parallix.db`
holds the draft measurement and that no `stats.csv` is written;
`test/package-persistent-data.test.ts` proves a reinstall preserves the
database; `test/task-1424-post-integrate-publish-reinstall.test.ts` asserts the
installed CLI creates the database and writes no CSV.

**Out-of-scope repair, flagged.** `./scripts/verify-local.sh static-analysis`
stage 4 was red on `main` with six `TS2339` errors in
`test/unit-test-timeout-guard.test.ts`, a file this mission does not otherwise
touch (verified by typechecking a clean `main` worktree — identical six
errors). Because that gate is mission-declared, the three `childEnv`/`runnerEnv`
declarations were annotated `NodeJS.ProcessEnv` so the gate is genuinely green
rather than "green except inherited red". This is the only change in this
mission unrelated to the statistics cut-over.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4 — default runtime execution neither resolves nor reads `stats.csv` | `"no source file outside the named legacy boundary references stats.csv in executable code"`; `"no stats CSV path resolver survives the measurement cut-over"`; `"recording a measurement with no explicit path writes no CSV under PARALLIX_HOME (task-1246)"` | PASS |
| SC4 — no production path writes CSV | `"no source file resolves a default stats CSV path or writes CSV for statistics"` (scans `src/` for all eight removed helpers); `src/platform/runtime/lib/commands/stats.ts:373` (saveStatsCsv removed) | PASS |
| SC4 — SQLite unavailability produces a database failure, not a CSV fallback | `"px stats fails with the database error instead of reading a CSV when the store is unavailable"` (a valid decoy `stats.csv` beside the unopenable database is neither read nor reported) | PASS |
| SC4 — command help identifies the database as the authority | `src/platform/runtime/lib/commands/stats.ts:2370`; `src/platform/runtime/index.ts:300`; `src/platform/runtime/lib/commands/stats-backfill.ts:343`; `"stats command help documents the pre-integration preview workflow"`, `"statsBackfill supports help, json output, summary output, and apply mode"` | PASS |
| SC5 — save / upsert / stats-path helpers unreachable from production | `"no source file resolves a default stats CSV path or writes CSV for statistics"`; `src/platform/runtime/lib/core/storage.ts:94`; `src/platform/runtime/lib/core/persistent-data-migration.ts:5` | PASS |
| SC5 — the last dead CSV hook in the rebase path is gone | `src/platform/runtime/lib/review/rebase.ts:34`; `"commitSafeMissionArtifacts no longer treats a repo stats CSV as a safe mission artifact"` | PASS |
| SC5 — remaining CSV code is limited to the named import/analysis boundary | `test/stats-csv-authority-guard.test.ts`; `"the only stats CSV boundary in the ADR 0053 inventory is an explicit one-way legacy input"` | PASS |
| SC6 — a measurement remains available after restart | `"a measurement remains available after the store is closed and reopened (restart)"`; `"a recorded measurement survives a full store restart and is still reported by px stats"` | PASS |
| SC6 — repeated application of the same CSV creates no duplicate records | `"import-legacy apply is atomic and idempotent: re-applying the same CSV creates no duplicate records"`; `"measurement store reports changed=false when an identical record is re-applied"` | PASS |
| SC6 — concurrent measurement updates retain the required records | `"concurrent measurement updates from two open connections retain every required record"`; `"concurrent measurement updates through the command layer retain every required record"` | PASS |
| SC6 — database failure does not access CSV | `"database failure raises MeasurementStoreUnavailableError and accesses no CSV"`; `"px stats fails with the database error instead of reading a CSV when the store is unavailable"` | PASS |
| SC7 — documentation matches ADR 0053 and the TASK-2322.02 identity | `docs/adr/0053-operational-persistence-and-authority-boundaries.md:96`; `docs/authority-reference.md:275`; `src/domain/README.md:58`; `test/domain-attempt-guard.test.ts` still passes | PASS |
| SC7 — ADR 0053 consumer citations resolve after the edits | `src/application/consumer-domain-requirements.ts:262`, `:273`; `"SC3: every consumer citation points at a line containing its anchor"` | PASS |

Next action: record the two mission-declared gate results and the final
SC1–SC7 Goal Check (CP-5).
