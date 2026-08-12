# CP-4: Review round 1 corrections — telemetry integration

## Summary

Round 1 (reviewer `qwen`) returned REQUEST_CHANGES on two blocking breaks and two
minor items. This checkpoint records the corrections and supersedes the
`thoughts_tokens` rows in CP-2 and CP-3, which were materially false against the
committed tree: the stats schema change from commit `40069ee52` was lost in a
rebase and never reapplied, and `extractQwenTelemetry` had no production caller.

### Finding 1a — telemetry never reached the stage record (fixed)

`startQwenAgent` set only `result.sessionId`, so `resolveStageTelemetry` returned
`null` for every qwen run and `extractQwenTelemetry` was dead code. Added the
`processResult` function named in the mission scope, mirroring `codex.ts`: it
attaches `result.telemetry` from `extractQwenTelemetry(qwenHomeRoot(rootDir),
{ sinceMs: Date.parse(invocationStart) })` and passes `model`/`provider` through
for stats attribution, best-effort inside try/catch.

### Finding 1b — `thoughts_tokens` column reapplied and plumbed end to end (fixed)

Reapplying only the four `stats.ts` hunks from `40069ee52` would not have made
thinking tokens visible: stage stats are written through the sqlite measurement
store, whose column list and DDL are the authority, and the column would have
been dropped at `statsRowToMeasurement`. The column is therefore carried the
whole way: migration `0013-usage-statistics-thoughts-tokens.sql`, the
measurement store column list / upsert / compared fields / row mapping, the
`MeasurementRecord` and `UsageRecord` ports, the authority map, the CSV importer,
and the six `stats.ts` sites (`StatsRow`, `STATS_HEADERS`, `USAGE_NUMBERS`,
`measurementToStatsRow`, `statsRowToMeasurement`, `normalizeStatsRow`,
`telemetryToStatsFields`, and the `accumulateStageStats` merge).

The rendered phase/agent report tables are unchanged — they show a fixed subset
of the token columns and the mission does not ask for a display change. The
column is persisted, exported and queryable.

### Finding 2 — stale `-r <session-id>` fallback (fixed)

Added `isStaleQwenSessionResult` plus a relaunch in `startQwenAgent`: when a
resume launch with a stored session id fails with session-not-found phrasing,
the launcher respawns without `-r` instead of losing the run. Mirrors
`isStaleSessionResult`/`staleSessionHandler` in `codex.ts`.

### Finding 3 — captured real artifacts committed as fixtures (fixed)

`test/fixtures/qwen/token-usage-2026-08.sample.jsonl` and
`test/fixtures/qwen/usage_record.sample.jsonl` are real qwen CLI v0.21.9 output
captured from this worktree, exercised by a new telemetry test so a future CLI
schema change (R1) fails loudly instead of yielding silent zeros.

### Finding 4 — settings copy (acknowledged, no change)

Reviewer confirmed the SC2 security constraint holds: `.workflow/` is git-ignored
so no secrets reach tracked paths, and a symlink cannot carry the forced
`approvalMode: yolo` merge. Deviation stays documented in `ensureQwenHome`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3: qwen telemetry reaches the stage record via the launcher | `test/qwen-launcher.test.ts`, `"qwen telemetry: processResult attaches result.telemetry from QWEN_HOME artifacts"` | PASS |
| SC3: no telemetry attached when no artifacts exist (honest absence) | `test/qwen-launcher.test.ts`, `"qwen telemetry: processResult leaves telemetry unset when no artifacts exist"` | PASS |
| SC3: thinking tokens map to their own column and survive persistence | `test/stats.test.ts`, `"task-2362: thoughts_tokens survives telemetryToStatsFields and the measurement store round-trip"` | PASS |
| SC3: thoughts tokens parsed separately from output tokens | `test/qwen-telemetry.test.ts`, `"extractQwenTelemetry: thoughtsTokens separately tracked (not folded into output)"` | PASS |
| SC4: captured real CLI artifacts pin the format | `test/qwen-telemetry.test.ts`, `"extractQwenTelemetry: parses captured real CLI artifacts (format pin, R1)"` | PASS |
| SC7: stale resume id falls back to a fresh session | `test/qwen-launcher.test.ts`, `"qwen resume: stale session id is detected so the launch falls back to a fresh session"` | PASS |
| SC9: provider/model attributed from usage artifacts on the launch result | `test/qwen-launcher.test.ts`, `"qwen telemetry: processResult attaches result.telemetry from QWEN_HOME artifacts"` | PASS |
| Consumer citations still anchor after the stats.ts edits | `test/domain-consumer-requirements.test.ts`, `"SC3: every consumer citation points at a line containing its anchor"` | PASS |
| SC11: static analysis gate | `./scripts/verify-local.sh static-analysis` | PASS |
| SC11: full verification gate | `./scripts/verify-local.sh all` | PASS |

## Gates

| Gate | Command | Status |
|---|---|---|
| Static analysis | `./scripts/verify-local.sh static-analysis` | PASS (4/4 stages) |
| All verification | `./scripts/verify-local.sh all` | PASS (2138 tests, 2137 pass, 0 fail, 1 skipped, exit 0) |

## Correction to earlier checkpoints

CP-2's "thoughts_tokens stats field in telemetryToStatsFields" row and CP-3's
"thoughtsTokens stats field implemented" row cited `src/adapters/cli/commands/stats.ts`
at a revision where the change was absent. Both are now true at HEAD, and the
CP-3 gate notes about "pre-existing failures" are stale — both gates are clean.

Next action: reviewer to re-verify telemetry attachment and the `thoughts_tokens`
persistence path in round 2.
