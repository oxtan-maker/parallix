# CP-2: Telemetry + Limit Detection

## Summary

Delivered qwen telemetry module, limit detection with quota-vs-rate-limit distinction, and `thoughts_tokens` stats field.

### Files delivered
- `src/adapters/agents/qwen-telemetry.ts` — JSONL parsing (`token-usage-YYYY-MM.jsonl` and `usage_record.jsonl`), invocation-window correlation, honest-zeros policy, per-model breakdown
- `src/application/services/agent-limit.ts` — qwen `PATTERN_SETS` with two patterns; rate-limit returns `{ reroute: true }` (no block persist)
- `src/adapters/agents/agents.ts` — `reroute` flag handling in limit-hit retry loop
- `src/adapters/cli/commands/stats.ts` — `thoughts_tokens` column added to `STATS_HEADERS`, `USAGE_NUMBERS`, `telemetryToStatsFields`, and `StatsRow`
- `test/qwen-telemetry.test.ts` — 14 fixture-backed offline tests
- `test/qwen-limit-detection.test.ts` — 10 hermetic tests covering all three paths

### thoughtsTokens implementation

`thoughts_tokens` added as a new stats column. Thinking tokens are a distinct credit-consuming category on the Bailian Token Plan (separate deduction coefficient). Mapped from `telemetry.thoughtsTokens` in `telemetryToStatsFields`. Existing families (codex, claude, vibe) emit `0` for this field — no data loss.

### Rate-limit reroute

Qwen's `429 Requests rate limit exceeded` is transient (~1 minute retry). `detectLimitHit` returns `{ reroute: true, reason: 'rate limit (transient, no block)' }` which the caller in `agents.ts` handles by excluding the agent from the current retry cycle without persisting a block to `agents.local.json`. This prevents the TASK-1412/2267 failure mode where transient errors poison the blocklist.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Telemetry parses token-usage JSONL (input, output, cached, thoughts, total) | `test/qwen-telemetry.test.ts`, `"parseTokenUsageLine extracts all token categories"` | PASS |
| Telemetry parses usage_record.jsonl (tool calls, duration) | `test/qwen-telemetry.test.ts`, `"parseUsageRecordLine extracts session summary"` | PASS |
| Token counts summed across API calls in invocation window | `test/qwen-telemetry.test.ts`, `"extractQwenTelemetry sums tokens across multiple API calls"` | PASS |
| Per-model breakdown preserved | `test/qwen-telemetry.test.ts`, `"extractQwenTelemetry preserves per-model breakdown"` | PASS |
| Honest zeros when endpoint reports no usage | `test/qwen-telemetry.test.ts`, `"extractQwenTelemetry returns honest zeros when endpoint reports no usage"` | PASS |
| thoughtsTokens tracked separately (not folded into output) | `test/qwen-telemetry.test.ts`, `"extractQwenTelemetry: thoughtsTokens separately tracked (not folded into output)"` | PASS |
| thoughts_tokens stats field in telemetryToStatsFields | `src/adapters/cli/commands/stats.ts` | PASS |
| Invocation window guard prevents stale attribution | `test/qwen-telemetry.test.ts`, `"collectTokenUsageRecords respects invocation window"` | PASS |
| Quota exceeded → timed block with reason (parseResetTime first) | `test/qwen-limit-detection.test.ts`, `"qwen quota-exceeded: timed block with reason (parseResetTime tried first)"` | PASS |
| Quota exceeded → fallback hours when no reset text | `test/qwen-limit-detection.test.ts`, `"qwen quota-exceeded: fallback hours when no reset text"` | PASS |
| Rate limit → reroute without long block | `test/qwen-limit-detection.test.ts`, `"qwen rate-limit: reroute without long block"` | PASS |
| Non-quota failure → no block | `test/qwen-limit-detection.test.ts`, `"qwen non-quota failure: no block (no pattern match)"` | PASS |
| Successful run (exit 0) not treated as limit hit | `test/qwen-limit-detection.test.ts`, `"qwen successful run: no limit hit even if transcript mentions quota"` | PASS |
| ESLint clean on changed files | `npx eslint src/adapters/agents/qwen-telemetry.ts src/application/services/agent-limit.ts src/adapters/agents/agents.ts test/qwen-telemetry.test.ts test/qwen-limit-detection.test.ts` | PASS |

Next action: CP-3 — config/agents.json registration, docs/agents.md update, README enumeration, stats verification on temp repo, credit reconciliation spike, and verification gates.
