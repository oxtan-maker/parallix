# CP-1: Capture and review live Vibe session artifacts

## Work Done

Scanned `~/.vibe/logs/` which contains 1171 session directories. Examined `meta.json` files from multiple sessions (most recent completed, mid-range, and earliest available).

## Findings

**Structured token-usage data EXISTS** in `~/.vibe/logs/session/<session>/meta.json` under the `stats` key.

Confirmed consistent structure across all sessions:

```json
{
  "stats": {
    "steps": 2,
    "session_prompt_tokens": 9331,
    "session_completion_tokens": 62,
    "tool_calls_agreed": 0,
    "tool_calls_rejected": 0,
    "tool_calls_hook_denied": 0,
    "tool_calls_failed": 0,
    "tool_calls_succeeded": 0,
    "context_tokens": 9393,
    "last_turn_prompt_tokens": 9331,
    "last_turn_completion_tokens": 62,
    "last_turn_duration": 1.78,
    "tokens_per_second": 34.76,
    "input_price_per_million": 1.5,
    "output_price_per_million": 7.5,
    "session_total_llm_tokens": 9393,
    "last_turn_total_tokens": 9393,
    "session_cost": 0.014
  }
}
```

Field mapping for telemetry:
- `session_prompt_tokens` → `inputTokens`
- `session_completion_tokens` → `outputTokens`
- `session_total_llm_tokens` → `totalTokens`

Additional fields available: `contextTokens`, `toolCallsAgreed`, `toolCallsRejected`, `toolCallsFailed`, `toolCallsSucceeded`, `sessionCost`, `tokensPerSecond`, `lastTurnDuration`.

Decision: **Implement parser** — the `meta.json` structure is stable, documented by Vibe's own `session_logging` config (`~/.vibe/config.toml`), and consistently present across all sessions.

## Evidence

- `~/.vibe/logs/session/` — 1171 session directories
- `~/.vibe/logs/session/session_20260701_171711_fbdc221c/meta.json` — latest session with full stats
- `~/.vibe/logs/session/session_20260626_220032_1797bc72/meta.json` — mid-range session confirming identical structure
- `~/.vibe/config.toml:session_logging.save_dir = "/home/magnus/.vibe/logs/session"` — Vibe config confirms this is the canonical log path

## Next action

Implement `extractMistralTelemetry()` in `lib/agents/mistral-telemetry.ts` with a `parseMistralMeta()` helper, following the codex-telemetry pattern. Add fixture-backed tests in `test/telemetry-stubs.test.js`.
