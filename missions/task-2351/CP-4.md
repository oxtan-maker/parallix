# CP-4 — Selection outcome telemetry and verification

Added structured selection-outcome records with the fixed labels `nominated`, `skipped-blocked`, `launch-failed`, and `fallback`. Review-loop nominations, blocked-reviewer exclusion, launch failures, and fallback paths emit structured records. A focused prepared-reviewer test proves a SQLite-blocked candidate receives zero launch calls.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: SQLite-blocked stale-JSON candidate is not selected | `test/task-2351-agent-selection-snapshot-repro.test.ts:8`; "SQLite-blocked reviewer is not nominated when JSON blocklist is stale (TASK-2351 repro)" | Passed |
| SC2: SQLite runtime blocks create the selection snapshot | `src/adapters/agents/agent-selection-snapshot.ts:49`; `test/task-2351-agent-selection-snapshot-adapter.test.ts:9` | Passed |
| SC3: review-loop uses a prepared snapshot and excludes before launch | `src/adapters/review/review-loop.ts:227`; "review-loop prepared selection skips SQLite-blocked reviewer before any launch (TASK-2351)" | Passed |
| SC4: migrated handoff CLI selection accepts the same prepared snapshot | `src/adapters/cli/commands/handoff.ts:48`; `test/task-2351-agent-selection-snapshot-repro.test.ts:25` | Passed |
| SC5: all four structured outcome labels are recorded | `src/application/services/agent-selection-telemetry.ts:1`; `src/adapters/review/review-loop.ts:1021`; "review-loop emits skipped-blocked and launch-failed outcomes from production branches" | Passed |
| SC6: unblocked and no-selectable policy behavior survives | `test/domain-agent-selection.test.ts:25`; `src/domain/agents.ts:91` | Passed |
| SC7: full repository verification passes | `./scripts/verify-local.sh all` | Passed |

Next action: Run the complete verifier on the amended committed tree and return the recorded resolution artifacts to the review loop.
