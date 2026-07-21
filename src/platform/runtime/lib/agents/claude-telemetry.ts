'use strict';

// Claude telemetry is read from the Claude CLI's `--output-format stream-json`
// stdout stream (see claude.js `buildClaudeInvocation`). Unlike Codex — which
// writes a per-session rollout JSONL to disk — the Claude CLI emits its usage
// signal inline on stdout as SSE-style JSONL events, so we parse the captured
// stdout tail directly (no on-disk transcript to read).
//
// The CLI runs with `--include-partial-messages`, so the Anthropic SSE events
// are forwarded as JSONL. Two envelope shapes are handled:
//
//   1. Wrapped (real CLI form): each partial event is nested under a
//      `stream_event` wrapper:
//        {"type":"stream_event","event":{"type":"message_start","message":{"usage":{...}}}}
//        {"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":N}}}
//        {"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use"}}}
//   2. Raw (bare SSE form): the Anthropic event sits at the top level:
//        {"type":"message_start","message":{"usage":{...}}}
//        {"type":"message_delta","usage":{"output_tokens":N}}
//
// The CLI also emits top-level `system` (init), `assistant`, and `result`
// events; `system`/`result` carry `session_id` and `model`, and `result`
// carries a final aggregate `usage` used as a fallback when partial events were
// truncated out of the captured stdout tail.
//
// Token semantics (Anthropic streaming):
//   - `message_start.usage.input_tokens` is the prompt size for that turn. A
//     multi-turn (tool-use) invocation re-sends the growing context each turn,
//     so summing every turn's input would multi-count the shared prompt. We take
//     the FIRST message_start's input_tokens as the representative prompt size.
//   - `message_delta.usage.output_tokens` is the FINAL cumulative output count
//     for that one message. Across turns these are independent generations, so
//     the stage's total generated output is the SUM of each turn's final value.
//   - `cache_read_input_tokens` / `cache_creation_input_tokens` appear on
//     message_start.usage when prompt caching is active; summed across turns.

const PROVIDER = 'anthropic';

function num(value: any) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Unwrap a parsed JSONL line into its underlying Anthropic SSE event. The CLI's
 * `--include-partial-messages` form nests the real event under `stream_event`;
 * the bare form has it at the top level. Returns the inner event object.
 */
function unwrapEvent(evt: any) {
  if (evt && evt.type === 'stream_event' && evt.event && typeof evt.event === 'object') {
    return evt.event;
  }
  return evt;
}

/**
 * Parse a Claude `stream-json` stdout string into a normalized structure of the
 * usage-bearing events. Returns null when the content yields no usable signal
 * (e.g. empty, garbage, or a stream with no usage events at all).
 *
 * Shape:
 *   {
 *     sessionId, model, provider: 'anthropic',
 *     messageStarts: [{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, model }],
 *     messageDeltas: [{ outputTokens }],
 *     toolCalls,
 *     resultUsage: { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } | null
 *   }
 */
function parseClaudeStreamJson(content: string) {
  if (!content) {return null;}

  let sessionId = null;
  let model = null;
  let toolCalls = 0;
  let resultUsage = null;
  let resultCostUsd = null;
  const messageStarts = [];
  const messageDeltas = [];

  for (const line of String(content).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {continue;}
    let outer;
    try {
      outer = JSON.parse(trimmed);
    } catch (_) {
      continue;
    }
    if (!outer || typeof outer !== 'object') {continue;}

    // Top-level CLI envelope fields (present on system/result and sometimes the
    // wrapper) carry session/model metadata.
    if (outer.session_id) {sessionId = outer.session_id;}
    if (outer.type === 'system' && outer.model) {model = outer.model;}

    // The final `result` event carries `total_cost_usd` (direct from the CLI)
    // and an aggregate usage object (fallback when partial events were evicted).
    if (outer.type === 'result') {
      if (outer.usage && typeof outer.usage === 'object') {
        resultUsage = {
          inputTokens: num(outer.usage.input_tokens),
          outputTokens: num(outer.usage.output_tokens),
          cacheReadTokens: num(outer.usage.cache_read_input_tokens),
          cacheCreationTokens: num(outer.usage.cache_creation_input_tokens),
        };
      }
      if (typeof outer.total_cost_usd === 'number' && Number.isFinite(outer.total_cost_usd)) {
        resultCostUsd = outer.total_cost_usd;
      }
    }

    const evt = unwrapEvent(outer);
    if (!evt || typeof evt !== 'object') {continue;}

    switch (evt.type) {
      case 'message_start': {
        const message = evt.message || {};
        const usage = message.usage || {};
        if (message.model) {model = message.model;}
        messageStarts.push({
          inputTokens: num(usage.input_tokens),
          outputTokens: num(usage.output_tokens),
          cacheReadTokens: num(usage.cache_read_input_tokens),
          cacheCreationTokens: num(usage.cache_creation_input_tokens),
          model: message.model || null,
        });
        break;
      }
      case 'message_delta': {
        const usage = evt.usage || {};
        messageDeltas.push({ outputTokens: num(usage.output_tokens) });
        break;
      }
      case 'content_block_start': {
        const block = evt.content_block || {};
        if (block.type === 'tool_use') {toolCalls += 1;}
        break;
      }
      default:
        break;
    }
  }

  const hasSignal = messageStarts.length > 0 || messageDeltas.length > 0 || resultUsage || model || sessionId;
  if (!hasSignal) {return null;}

  return {
    sessionId,
    model: model || null,
    provider: PROVIDER,
    messageStarts,
    messageDeltas,
    toolCalls,
    resultUsage,
    resultCostUsd,
  };
}

/**
 * Aggregate token counts from a Claude `stream-json` stdout stream into a
 * telemetry object compatible with `stats.telemetryToStatsFields()`.
 *
 * Aggregation rules (see token-semantics note at top of file):
 *   - inputTokens  = first message_start's input_tokens (representative prompt
 *                    size; avoids multi-counting the re-sent context across
 *                    tool-use turns).
 *   - outputTokens = sum of every message_delta's output_tokens (total
 *                    generation across all turns).
 *   - cachedTokens = sum of message_start cache_read_input_tokens across turns.
 *   - totalTokens  = inputTokens + outputTokens.
 *
 * When partial events are absent (e.g. truncated stdout tail) but a `result`
 * event survived, its aggregate usage is used as a fallback.
 *
 * Returns null when the stream yields no usable token signal.
 */
function extractClaudeTelemetryFromStdout(stdout: string) {
  const parsed = parseClaudeStreamJson(stdout);
  if (!parsed) {return null;}

  const { messageStarts, messageDeltas, resultUsage, resultCostUsd } = parsed;

  let inputTokens = messageStarts.length > 0 ? messageStarts[0].inputTokens : 0;
  let outputTokens = messageDeltas.reduce((sum, d) => sum + d.outputTokens, 0);
  let cachedTokens = messageStarts.reduce((sum, s) => sum + s.cacheReadTokens, 0);
  let cacheCreationTokens = messageStarts.reduce((sum, s) => sum + s.cacheCreationTokens, 0);

  // If partial events were truncated out of the captured tail, fall back to the
  // final `result` event's aggregate usage so we still record real numbers.
  if (inputTokens === 0 && outputTokens === 0 && resultUsage) {
    inputTokens = resultUsage.inputTokens;
    outputTokens = resultUsage.outputTokens;
    cachedTokens = resultUsage.cacheReadTokens;
    cacheCreationTokens = resultUsage.cacheCreationTokens;
  }

  // NOTE: a small `inputTokens` (even 1) alongside a large `cachedTokens` is NOT
  // an artifact — it is normal prompt caching. Anthropic streaming reports only
  // the *uncached* prompt delta as `message_start.usage.input_tokens`; the bulk
  // of the re-sent context is billed under `cache_read_input_tokens`. We keep
  // the parsed value truthful and surface caching honestly in the stats render
  // rather than rewriting telemetry here (see lib/commands/stats.js render).

  // No token signal at all (only metadata events): not worth a telemetry row.
  if (inputTokens === 0 && outputTokens === 0 && cachedTokens === 0 && cacheCreationTokens === 0) {
    return null;
  }

  return {
    sessionId: parsed.sessionId,
    provider: parsed.provider,
    model: parsed.model,
    effort: null,
    inputTokens,
    outputTokens,
    cachedTokens,
    cacheCreationTokens,
    reasoningTokens: 0,
    totalTokens: inputTokens + outputTokens,
    contextWindow: 0,
    toolCalls: parsed.toolCalls,
    // Claude's CLI exposes no rate-limit percentage (unlike Codex); leave null
    // so telemetryToStatsFields records openai_usage_after as 0.
    usagePercent: null,
    // total_cost_usd is emitted directly by the Claude CLI in the result event.
    cost_usd: typeof resultCostUsd === 'number' ? resultCostUsd : 0,
  };
}

export {
  parseClaudeStreamJson,
  extractClaudeTelemetryFromStdout,
};
