'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Mistral (Vibe) Telemetry Parser
 *
 * Mistral Vibe writes structured token-usage data to per-session meta files:
 *   ~/.vibe/logs/session/<session_id>/meta.json
 *
 * Each meta.json contains a `stats` object with token counts:
 *   - session_prompt_tokens  → inputTokens
 *   - session_completion_tokens → outputTokens
 *   - session_total_llm_tokens → totalTokens
 *
 * This module scans that directory for the most recent meta.json, parses the
 * stats block, and returns a telemetry object mirroring the shape used by
 * codex-telemetry.ts.
 *
 * See task-1288 for the discovery that confirmed the structured source.
 */

/**
 * The default directory where Vibe writes its session meta files.
 * Overridden by tests via extractMistralTelemetry(basePath).
 */
const DEFAULT_MISTRAL_LOG_DIR = path.join(os.homedir(), '.vibe', 'logs', 'session');

interface TelemetryResult {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  toolCallsAgreed: number;
  toolCallsRejected: number;
  toolCallsFailed: number;
  toolCallsSucceeded: number;
  sessionCost: number;
  path?: string;
}

interface ParseableMeta {
  stats?: Record<string, unknown>;
  [key: string]: unknown;
}

interface StatsBlock {
  session_prompt_tokens?: unknown;
  session_completion_tokens?: unknown;
  session_total_llm_tokens?: unknown;
  context_tokens?: unknown;
  tool_calls_agreed?: unknown;
  tool_calls_rejected?: unknown;
  tool_calls_failed?: unknown;
  tool_calls_succeeded?: unknown;
  session_cost?: unknown;
  [key: string]: unknown;
}

/**
 * Parse the `stats` block from a meta.json file into a telemetry object.
 * Returns null when the content yields no usable signal (missing stats,
 * empty object, or non-object stats).
 */
function parseMistralMeta(meta: ParseableMeta | null | undefined): TelemetryResult | null {
  if (!meta || typeof meta !== 'object') {return null;}

  const stats = meta.stats;
  if (!stats || typeof stats !== 'object') {return null;}

  const s = stats as StatsBlock;
  const inputTokens = Number(s.session_prompt_tokens) || 0;
  const outputTokens = Number(s.session_completion_tokens) || 0;
  const totalTokens = Number(s.session_total_llm_tokens) || 0;

  // Return null when there is no usable signal (all zeros).
  // Mirrors the codex-telemetry pattern where honest zeros still indicate
  // a parseable source was found but contained no actual usage.
  if (!inputTokens && !outputTokens && !totalTokens) {return null;}

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    contextTokens: Number(s.context_tokens) || 0,
    toolCallsAgreed: Number(s.tool_calls_agreed) || 0,
    toolCallsRejected: Number(s.tool_calls_rejected) || 0,
    toolCallsFailed: Number(s.tool_calls_failed) || 0,
    toolCallsSucceeded: Number(s.tool_calls_succeeded) || 0,
    sessionCost: Number(s.session_cost) || 0,
  };
}

/**
 * Scan ~/.vibe/logs/session/ for the most recent session meta.json, parse its
 * stats block, and return a telemetry object.
 *
 * @param result - Legacy launcher result object (ignored; kept for API compat)
 * @param basePath - Override the default session log directory. Used by tests.
 */
function extractMistralTelemetry(result: unknown, basePath?: string): TelemetryResult | null {
  void result; // legacy param, ignored — telemetry comes from on-disk meta.json

  const scanDir = basePath || DEFAULT_MISTRAL_LOG_DIR;

  // Scan session subdirectories for the newest meta.json.
  // Basenames are session_<YYYYMMDD>_<HHMMSS>_<id>, so alphabetical sort = chronological.
  let sessionDirs: string[];
  try {
    sessionDirs = fs.readdirSync(scanDir);
  } catch (_) {
    return null;
  }

  const dirs = sessionDirs
    .filter((d: string) => {
      if (!d.startsWith('session_')) {return false;}
      const full = path.join(scanDir, d);
      try { return fs.statSync(full).isDirectory(); } catch (_) { return false; }
    })
    .sort();

  if (dirs.length === 0) {return null;}

  // Walk newest-first; return the first session that has a parseable meta.json.
  for (let i = dirs.length - 1; i >= 0; i--) {
    const metaPath = path.join(scanDir, dirs[i], 'meta.json');
    if (!fs.existsSync(metaPath)) {continue;}

    let content: string;
    try {
      content = fs.readFileSync(metaPath, 'utf8');
    } catch (_) {
      continue;
    }

    let meta: ParseableMeta;
    try {
      meta = JSON.parse(content);
    } catch (_) {
      continue;
    }

    const telemetry = parseMistralMeta(meta);
    if (!telemetry) {continue;}

    return { ...telemetry, path: metaPath };
  }

  return null;
}

/**
 * Return the provider/model pair for mistral tasks.
 * Used as fallback when telemetry is null.
 */
function getMistralProviderModel(): { provider: string; model: string } {
  return { provider: 'mistral', model: 'mistral' };
}

module.exports = {
  parseMistralMeta,
  extractMistralTelemetry,
  getMistralProviderModel,
  DEFAULT_MISTRAL_LOG_DIR,
};
