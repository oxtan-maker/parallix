# CP-8 — Bounded board refresh work (SC28–SC35)

## Summary of work done

The board no longer parses the complete audit history for current work. The
operational-history repository now exposes an indexed query for the latest two
`mission.current-work` facts per mission. Two facts preserve the standing work
and a late terminal fact needed by operation-aware reconciliation; historical
rows remain in `operational_history` for audit through `findByType`.

Slow historical metrics are memoized by the mission-status and agent-availability
authority inputs. The subscription keeps its existing recursive timeout shape:
the next rebuild is scheduled only after the prior one settles, so builds do not
overlap, while every tick still rebuilds current-work and expiry-sensitive facts.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC28 — parsed current-work rows scale with missions, not history | `test/task-2373-repro.test.ts`, `"TASK-2373 defect 5: board current-work reads do not grow with historical current-work rows"` | PASS |
| SC29 — audit history stays queryable | `src/application/ports/operation-history.ts` — `findByType`; `src/adapters/backlog/concrete-current-work-read-adapter.ts` uses only the bounded read for board work | PASS |
| SC30 — SQLite index names its production query | `src/adapters/sqlite/migrations/0015-current-work-latest-per-mission.sql`; `SqliteOperationalHistoryRepository.findLatestByTypePerMission()` | PASS |
| SC31 — unchanged slow historical metrics are not recomputed | `src/application/projections/board-readers.ts` — `BoardProjectionBuilder.metricsCache` | PASS |
| SC32 — unchanged metric authority is skipped by a cheap key | `src/application/projections/board-readers.ts` — mission-status and agent-availability cache key | PASS |
| SC33/SC34 — timer ticks continue rebuilding expiry/current-work authority | `test/task-2373-refresh-performance.test.ts`, `"SC33 and SC34: each completed timer tick rebuilds the authority projection"` | PASS |
| SC35 — slow refreshes do not overlap | `test/task-2373-refresh-performance.test.ts`, `"SC35: a slow board refresh never overlaps or accumulates a timer backlog"` | PASS |
| CP8 focused suite | `npx tsx --test test/task-2373-refresh-performance.test.ts test/task-2373-repro.test.ts` | PASS |

Next action: CP-9 — run the composed workflow and UI regressions, audit every changed file,
then run the required static-analysis and full verifier gates.
