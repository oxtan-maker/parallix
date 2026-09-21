'use strict';

/**
 * Opencode Telemetry Parser
 *
 * Parses `opencode export` JSON output to extract real token-usage data for
 * custom/opencode sessions. The exported JSON may contain token usage in various shapes
 * depending on the opencode version, so this parser is resilient to:
 *   - Missing token fields (substitutes 0)
 *   - Nested vs flat structures
 *   - Different field name conventions
 *
 * Provider and model fields are set to "opencode" and "custom" respectively,
 * matching the convention used by other telemetry modules.
 *
 * See architecture migration for the full telemetry credibility design.
 */

const PROVIDER = 'opencode';
const MODEL = 'custom';

function num(value: any) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * @param {{[key: string]: any}} obj
 * @returns {{input_tokens?: number, output_tokens?: number, cached_input_tokens?: number, total_tokens?: number}|null}
 */
function findTokenUsage(obj: {[key: string]: any}): {input_tokens?: number, output_tokens?: number, cached_input_tokens?: number, total_tokens?: number} | null {
  if (!obj || typeof obj !== 'object') {return null;}
  return directTokenUsage(obj) || directTokenUsage(obj.total_token_usage) || directTokenUsage(obj.token_usage)
    || directTokenUsage(obj.usage) || metadataTokenUsage(obj) || infoTokenUsage(obj) || arrayTokenUsage(obj);
}

function directTokenUsage(value: any) {
  if (!value || typeof value !== 'object' || (!('input_tokens' in value) && !('output_tokens' in value))) { return null; }
  return { input_tokens: value.input_tokens || 0, output_tokens: value.output_tokens || 0, cached_input_tokens: value.cached_input_tokens || value.cached_tokens || 0, total_tokens: value.total_tokens || 0 };
}

function metadataTokenUsage(obj: {[key: string]: any}) {
  const metadata = obj.meta || obj.metadata;
  return directTokenUsage(metadata) || directTokenUsage(metadata?.total_token_usage);
}

function infoTokenUsage(obj: {[key: string]: any}) {
  const tokens = obj.info?.tokens;
  if (!tokens || typeof tokens !== 'object' || (!('input' in tokens) && !('output' in tokens))) { return null; }
  return { input_tokens: tokens.input || 0, output_tokens: tokens.output || 0, cached_input_tokens: tokens.cache?.read || 0, total_tokens: tokens.input + tokens.output || 0 };
}

function arrayTokenUsage(obj: {[key: string]: any}) {
  for (const value of Object.values(obj)) {
    if (!Array.isArray(value)) { continue; }
    for (const item of value) {
      if (item && typeof item === 'object') {
        const found = findTokenUsage(item);
        if (found) { return found; }
      }
    }
  }
  return null;
}

/**
 * @param {{[key: string]: any}} parsed
 * @returns {string|null}
 */
function extractSessionId(parsed: {[key: string]: any}) {
  if (!parsed || typeof parsed !== 'object') {return null;}
  return firstString(parsed.session_id, parsed.sessionId, parsed.info?.id, parsed.metadata?.session_id, parsed.metadata?.sessionId, parsed.meta?.session_id, parsed.meta?.sessionId, parsed.session?.id, parsed.session?.session_id);
}

/**
 * @param {{[key: string]: any}} parsed
 * @returns {string|null}
 */
function extractModelName(parsed: {[key: string]: any}) {
  if (!parsed || typeof parsed !== 'object') {return null;}
  return firstString(parsed.model, parsed.model_name, parsed.info?.model?.id, parsed.info?.model?.name, parsed.metadata?.model, parsed.metadata?.model_name, parsed.meta?.model, parsed.session?.model);
}

function firstString(...values: any[]): string | null {
  const value = values.find(Boolean);
  return value ? String(value) : null;
}

/**
 * @param {{[key: string]: any}} parsed
 * @returns {number}
 */
function countToolCalls(parsed: {[key: string]: any}) {
  if (!parsed || typeof parsed !== 'object') {return 0;}
  return numeric(parsed.tool_calls) + numeric(parsed.toolCalls) + numeric(parsed.usage?.tool_calls)
    + messageToolCalls(parsed.messages) + eventToolCalls(parsed.events) + (Array.isArray(parsed.tool_use_events) ? parsed.tool_use_events.length : 0);
}

function numeric(value: any): number { return typeof value === 'number' ? value : 0; }

function messageToolCalls(messages: any): number {
  if (!Array.isArray(messages)) { return 0; }
  return messages.reduce((count, message) => count + (Array.isArray(message?.parts) ? message.parts.filter((part: any) => part?.type === 'tool').length : 0), 0);
}

function eventToolCalls(events: any): number {
  if (!Array.isArray(events)) { return 0; }
  return events.reduce((count, event) => count + Number(['tool_use', 'tool_call', 'function_call'].includes(event?.type)) + (Array.isArray(event?.tool_calls) ? event.tool_calls.length : 0) + (Array.isArray(event?.content_block_start) ? event.content_block_start.filter((block: any) => block?.type === 'tool_use').length : 0), 0);
}

/**
 * Parse an `opencode export` JSON string and return a normalized telemetry
 * object compatible with `stats.telemetryToStatsFields()`.
 *
 * Returns null when the content yields no usable token signal (empty string,
 * non-JSON, or JSON without any token-usage fields).
 *
 * When the JSON contains token data but no model field, falls back to
 * `fallbackModel` — the model the launcher was configured with for this run
 * (from workflow.config.json) — so telemetry records the actual model id
 * instead of the generic family label.  When no model is configured, falls
 * back to the generic family label `MODEL`.
 *
 * @param {string} jsonString - Raw JSON string from `opencode export`
 * @param {string=} [fallbackModel] - Configured model id for this run, used
 *   when the export JSON omits the model field
 * @returns {object|null} Normalized telemetry object or null
 */
function extractOpencodeTelemetryFromExport(jsonString: string, fallbackModel?: string) {
  if (!jsonString || typeof jsonString !== 'string' || !jsonString.trim()) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (_) {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const tokenUsage = findTokenUsage(parsed);
  if (!tokenUsage) {
    return null;
  }

  // Verify there is at least some non-zero token data
  const inputTokens = num(tokenUsage.input_tokens);
  const outputTokens = num(tokenUsage.output_tokens);
  const cachedTokens = num(tokenUsage.cached_input_tokens);

  // If all tokens are zero, treat as no signal (unless total_tokens explicitly exists and is non-zero)
  if (inputTokens === 0 && outputTokens === 0 && cachedTokens === 0) {
    if (num(tokenUsage.total_tokens) === 0) {
      return null;
    }
    // total_tokens is set but individual fields are zero — treat total_tokens as the real signal
    // and derive input/output from it conservatively
    const totalTokens = num(tokenUsage.total_tokens);
      return {
        sessionId: extractSessionId(parsed),
        provider: PROVIDER,
        model: extractModelName(parsed) || fallbackModel || MODEL,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        totalTokens,
        toolCalls: countToolCalls(parsed),
        usagePercent: null,
      };
  }

  const totalTokens = num(tokenUsage.total_tokens) || (inputTokens + outputTokens);

  return {
    sessionId: extractSessionId(parsed),
    provider: PROVIDER,
    model: extractModelName(parsed) || fallbackModel || MODEL,
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens,
    toolCalls: countToolCalls(parsed),
    usagePercent: null,
  };
}

/**
 * @param {{exportJson?: string, telemetry?: object}} result
 * @returns {object|null}
 */
function extractOpencodeTelemetry(result: {exportJson?: string, telemetry?: any}) {
  if (result && result.exportJson && typeof result.exportJson === 'string') {
    return extractOpencodeTelemetryFromExport(result.exportJson);
  }
  if (result && result.telemetry) {
    return result.telemetry;
  }
  return null;
}

/**
 * Return the provider/model pair for opencode tasks.
 * Used as fallback when telemetry is null.
 *
 * @param {string=} [defaultModel] - Optional configured model id; falls back
 *   to the generic family label when absent.
 * @returns {{provider: string, model: string}}
 */
function getOpencodeProviderModel(defaultModel?: string) {
  return { provider: PROVIDER, model: defaultModel || MODEL };
}

export {
  extractOpencodeTelemetryFromExport,
  extractOpencodeTelemetry,
  getOpencodeProviderModel,
  extractOpencodeTelemetryFromExport as parseOpencodeExport,
};
