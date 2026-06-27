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
 * See task-1285 for the full telemetry credibility design.
 */

const PROVIDER = 'opencode';
const MODEL = 'custom';

/**
 * Safely extract a finite number from a value, defaulting to 0.
 */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Try to find token usage data anywhere in a parsed JSON object.
 * Searches common nesting paths used by opencode export JSON.
 *
 * @param {object} obj - Parsed JSON object
 * @returns {object|null} Normalized token usage object or null
 */
function findTokenUsage(obj) {
  if (!obj || typeof obj !== 'object') {return null;}

  // Direct token usage fields at top level
  if ('input_tokens' in obj || 'output_tokens' in obj) {
    return {
      input_tokens: obj.input_tokens,
      output_tokens: obj.output_tokens,
      cached_input_tokens: obj.cached_input_tokens || obj.cached_tokens || 0,
      total_tokens: obj.total_tokens || 0,
    };
  }

  // Nested under total_token_usage (Codex-compatible shape)
  if (obj.total_token_usage && typeof obj.total_token_usage === 'object') {
    return {
      input_tokens: obj.total_token_usage.input_tokens || 0,
      output_tokens: obj.total_token_usage.output_tokens || 0,
      cached_input_tokens: obj.total_token_usage.cached_input_tokens || obj.total_token_usage.cached_tokens || 0,
      total_tokens: obj.total_token_usage.total_tokens || 0,
    };
  }

  // Nested under token_usage
  if (obj.token_usage && typeof obj.token_usage === 'object') {
    return {
      input_tokens: obj.token_usage.input_tokens || 0,
      output_tokens: obj.token_usage.output_tokens || 0,
      cached_input_tokens: obj.token_usage.cached_input_tokens || obj.token_usage.cached_tokens || 0,
      total_tokens: obj.token_usage.total_tokens || 0,
    };
  }

  // Nested under usage
  if (obj.usage && typeof obj.usage === 'object') {
    return {
      input_tokens: obj.usage.input_tokens || 0,
      output_tokens: obj.usage.output_tokens || 0,
      cached_input_tokens: obj.usage.cached_input_tokens || obj.usage.cached_tokens || 0,
      total_tokens: obj.usage.total_tokens || 0,
    };
  }

  // Nested under meta or metadata
  if ((obj.meta || obj.metadata) && typeof (obj.meta || obj.metadata) === 'object') {
    const meta = obj.meta || obj.metadata;
    if ('input_tokens' in meta || 'output_tokens' in meta) {
      return {
        input_tokens: meta.input_tokens || 0,
        output_tokens: meta.output_tokens || 0,
        cached_input_tokens: meta.cached_input_tokens || meta.cached_tokens || 0,
        total_tokens: meta.total_tokens || 0,
      };
    }
    if (meta.total_token_usage && typeof meta.total_token_usage === 'object') {
      return {
        input_tokens: meta.total_token_usage.input_tokens || 0,
        output_tokens: meta.total_token_usage.output_tokens || 0,
        cached_input_tokens: meta.total_token_usage.cached_input_tokens || meta.total_token_usage.cached_tokens || 0,
        total_tokens: meta.total_token_usage.total_tokens || 0,
      };
    }
  }

  // Nested under info (opencode v2.x export format)
  // Shape: { info: { tokens: { input, output, cache: { read, write }, reasoning } } }
  if (obj.info && typeof obj.info === 'object' && obj.info.tokens && typeof obj.info.tokens === 'object') {
    const t = obj.info.tokens;
    if ('input' in t || 'output' in t) {
      return {
        input_tokens: t.input || 0,
        output_tokens: t.output || 0,
        cached_input_tokens: (t.cache && typeof t.cache === 'object') ? (t.cache.read || 0) : 0,
        total_tokens: t.input + t.output || 0,
      };
    }
  }

  // Search recursively through array elements (e.g., events array)
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object') {
          const found = findTokenUsage(item);
          if (found) {return found;}
        }
      }
    }
  }

  return null;
}

/**
 * Extract a sessionId from parsed opencode export JSON.
 *
 * @param {object} parsed - Parsed JSON object
 * @returns {string|null} Session ID or null
 */
function extractSessionId(parsed) {
  if (!parsed || typeof parsed !== 'object') {return null;}

  // Direct session_id
  if (parsed.session_id) {return String(parsed.session_id);}
  if (parsed.sessionId) {return String(parsed.sessionId);}

  // Nested under info (opencode v2.x export format)
  if (parsed.info && typeof parsed.info === 'object') {
    if (parsed.info.id) {return String(parsed.info.id);}
  }

  // Nested in metadata/meta/session
  if (parsed.metadata && typeof parsed.metadata === 'object') {
    if (parsed.metadata.session_id) {return String(parsed.metadata.session_id);}
    if (parsed.metadata.sessionId) {return String(parsed.metadata.sessionId);}
  }
  if (parsed.meta && typeof parsed.meta === 'object') {
    if (parsed.meta.session_id) {return String(parsed.meta.session_id);}
    if (parsed.meta.sessionId) {return String(parsed.meta.sessionId);}
  }
  if (parsed.session && typeof parsed.session === 'object') {
    if (parsed.session.id) {return String(parsed.session.id);}
    if (parsed.session.session_id) {return String(parsed.session.session_id);}
  }

  return null;
}

/**
 * Extract a model name from parsed opencode export JSON.
 *
 * @param {object} parsed - Parsed JSON object
 * @returns {string|null} Model name or null
 */
function extractModelName(parsed) {
  if (!parsed || typeof parsed !== 'object') {return null;}

  // Direct model fields
  if (parsed.model) {return String(parsed.model);}
  if (parsed.model_name) {return String(parsed.model_name);}

  // Nested under info.model (opencode v2.x format)
  if (parsed.info && typeof parsed.info === 'object' && parsed.info.model && typeof parsed.info.model === 'object') {
    if (parsed.info.model.id) {return String(parsed.info.model.id);}
    if (parsed.info.model.name) {return String(parsed.info.model.name);}
  }

  // Nested in metadata/meta/session
  if (parsed.metadata && typeof parsed.metadata === 'object') {
    if (parsed.metadata.model) {return String(parsed.metadata.model);}
    if (parsed.metadata.model_name) {return String(parsed.metadata.model_name);}
  }
  if (parsed.meta && typeof parsed.meta === 'object') {
    if (parsed.meta.model) {return String(parsed.meta.model);}
  }
  if (parsed.session && typeof parsed.session === 'object') {
    if (parsed.session.model) {return String(parsed.session.model);}
  }

  return null;
}

/**
 * Count tool calls from parsed opencode export JSON.
 *
 * @param {object} parsed - Parsed JSON object
 * @returns {number} Tool call count
 */
function countToolCalls(parsed) {
  if (!parsed || typeof parsed !== 'object') {return 0;}

  let count = 0;

  // Direct tool_calls field
  if (typeof parsed.tool_calls === 'number') {count += parsed.tool_calls;}
  if (typeof parsed.toolCalls === 'number') {count += parsed.toolCalls;}
  if (typeof parsed.usage?.tool_calls === 'number') {count += parsed.usage.tool_calls;}

  // Real opencode v2.x export schema: tool calls live in
  // messages[].parts[] where part.type === 'tool'.
  if (Array.isArray(parsed.messages)) {
    for (const msg of parsed.messages) {
      if (msg && typeof msg === 'object' && Array.isArray(msg.parts)) {
        for (const part of msg.parts) {
          if (part && typeof part === 'object' && part.type === 'tool') {count += 1;}
        }
      }
    }
  }

  // Nested arrays of tool calls
  if (Array.isArray(parsed.events)) {
    for (const evt of parsed.events) {
      if (evt && typeof evt === 'object') {
        if (evt.type === 'tool_use') {count += 1;}
        if (evt.type === 'tool_call') {count += 1;}
        if (evt.type === 'function_call') {count += 1;}
        if (Array.isArray(evt.tool_calls)) {count += evt.tool_calls.length;}
        if (Array.isArray(evt.content_block_start)) {
          for (const cb of evt.content_block_start) {
            if (cb && cb.type === 'tool_use') {count += 1;}
          }
        }
      }
    }
  }

  if (Array.isArray(parsed.tool_use_events)) {
    count += parsed.tool_use_events.length;
  }

  return count;
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
function extractOpencodeTelemetryFromExport(jsonString, fallbackModel) {
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
 * Attempt to extract telemetry from an opencode launcher result.
 * Deprecated — use extractOpencodeTelemetryFromExport directly.
 * Kept for backward compatibility with existing call sites.
 *
 * @param {object} result - The launcher result object
 * @returns {object|null} Telemetry object or null
 */
function extractOpencodeTelemetry(result) {
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
function getOpencodeProviderModel(defaultModel) {
  return { provider: PROVIDER, model: defaultModel || MODEL };
}

module.exports = {
  extractOpencodeTelemetryFromExport,
  extractOpencodeTelemetry,
  getOpencodeProviderModel,
  parseOpencodeExport: extractOpencodeTelemetryFromExport,
};
