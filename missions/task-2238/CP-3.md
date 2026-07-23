# CP-3: Output Selection and Event Chatter Suppression

## Summary

Implemented and verified output selection so only the final Pi assistant response is presented to the user. The SDK event subscription in `lib/agents/pi.ts` collects only `text_delta` events from `message_update` as user-facing stdout. All other SDK events (session headers, `agent_start/end`, `tool_execution_start/end`, `thinking_delta`, `compaction_*`, `turn_start/end`, etc.) are excluded from the result.

### Output Filtering Implementation

- **File:** `lib/agents/pi.ts:426-441` — Event subscription in `startPiAgent()`
- Only `message_update` events with `assistantMessageEvent.type === 'text_delta'` are collected into `assistantText`
- `tool_execution_end` events increment `toolCalls` for telemetry (not shown to user)
- `agent_end` signals completion (not shown to user)
- All other event types (`agent_start`, `turn_start`, `thinking_delta`, `compaction_start/end`, etc.) are ignored
- Final stdout uses `session.getLastAssistantText()` (preferred) or the collected `assistantText` (fallback)

### Focused Coverage

Added 3 new tests to `test/pi-runner.test.js`:

1. **`startPiAgent SDK output contains only assistant text, not SDK event chatter`** — Verifies that the result stdout contains only the assistant response text and excludes all SDK event types (agent_start, tool_execution, thinking_delta, turn_start, message_update type names)
2. **`startPiAgent SDK execution returns session ID and telemetry from session state`** — Verifies sessionId and telemetry are correctly extracted from SDK session state
3. **`startPiAgent SDK handles errors and maps them to result shape`** — Verifies SDK errors map to the same `{ status, stderr, error, provider }` shape expected by callers

### Evidence

| Test | What It Verifies |
|------|-----------------|
| `startPiAgent SDK output contains only assistant text, not SDK event chatter` | stdout excludes `agent_start`, `tool_execution`, `thinking_delta`, `turn_start`, `message_update` type names; contains assistant text |
| `startPiAgent SDK execution returns session ID and telemetry from session state` | sessionId, inputTokens, outputTokens, cachedTokens, totalTokens, toolCalls from `getSessionStats()` |
| `startPiAgent SDK handles errors and maps them to result shape` | Error status, stderr content, provider identity on failure |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| User-facing output contains final assistant response and excludes SDK chatter | `lib/agents/pi.ts:426-441` (event subscription filters to text_delta only), `lib/agents/pi.ts:452` (`stdout: lastText` from `getLastAssistantText` or collected text) | PASS |
| Focused test covers successful SDK-backed Pi execution | `test/pi-runner.test.js`, `"startPiAgent SDK execution returns session ID and telemetry from session state"` | PASS |
| Focused test covers event chatter suppression | `test/pi-runner.test.js`, `"startPiAgent SDK output contains only assistant text, not SDK event chatter"` | PASS |
| Focused test covers error handling | `test/pi-runner.test.js`, `"startPiAgent SDK handles errors and maps them to result shape"` | PASS |
| All Pi runner tests pass | `test/pi-runner.test.js` — 24/24 pass | PASS |

**Next action:** Update Pi integration documentation, run final verification gate, and complete the final goal check with evidence for every success criterion (CP-4).
