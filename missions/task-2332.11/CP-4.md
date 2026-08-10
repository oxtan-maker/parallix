# CP-4: Mocked stats workflow coverage

Added isolated, mocked-port coverage for weekly, range, backfill, empty-store,
and Forgejo-unavailable outcomes. The application workflow retains only port
calls and `StatisticsService` semantics; no test accesses Forgejo, agents, or
SQLite. The full declared verifier passes. The separate static-analysis command
remains blocked by an existing ESLint error in an untouched file.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: report paths delegate through the stats use case | `src/adapters/cli/commands/stats.ts:2286`; `src/adapters/cli/commands/stats.ts:2311` | PASS |
| SC2: canonical identity, completion, and windowing use StatisticsService | `src/application/stats-command-use-case.ts:2`; `src/application/services/statistics-service.ts:26` | PASS |
| SC3: CLI parsing, formatting, and exit mapping remain in adapter | `src/adapters/cli/commands/stats.ts:2177` | PASS |
| SC4: mocked weekly, range, backfill, empty-store, and Forgejo-unavailable scenarios pass | `test/stats-command-use-case.test.ts`; `"StatsCommandUseCase Forgejo-unavailable lookup returns a graceful warning"` | PASS |
| SC5: existing weekly/range command output remains characterized | `"stats command prints workflow weekly tables from the integration stats schema"` in `test/stats.test.ts`; `"stats command writes arbitrary range report to --output without printing report body"` in `test/stats.test.ts` | PASS |
| SC6: static analysis is clean | `./scripts/verify-local.sh static-analysis` reports existing `src/application/services/agent-selection-telemetry.ts:6` unused `message` | BLOCKED — untouched-file stop rule |
| SC7: no focused or bare skipped stats use-case tests | `test/stats-command-use-case.test.ts` | PASS |
| Declared mission gate passes on final code | `./scripts/verify-local.sh all` | PASS |

Next action: resolve the pre-existing ESLint error in `src/application/services/agent-selection-telemetry.ts:6` in its owning mission, then rerun `./scripts/verify-local.sh static-analysis` before lifecycle handoff.
