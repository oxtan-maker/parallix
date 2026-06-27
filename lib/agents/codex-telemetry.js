'use strict';

// Codex telemetry is read from the per-session rollout JSONL that the Codex CLI
// always writes under `$CODEX_HOME/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`.
// The headless launcher (codex.js) points `HOME` at `<worktree>/.workflow/codex-home`,
// so each mission worktree owns an isolated `…/.codex/sessions` tree. Reading the
// rollout — rather than parsing the `--json` stdout stream — keeps the human-readable
// transcript and session-resume behaviour intact while still yielding real usage data.
//
// Relevant rollout events (each line is one JSON object):
//   {"type":"session_meta","payload":{"id","model_provider","model"?,...}}
//   {"type":"turn_context","payload":{"model","effort",...}}
//   {"type":"response_item","payload":{"type":"function_call",...}}
//   {"type":"event_msg","payload":{"type":"token_count","info":{...},"rate_limits":{...}}}

const fs = require('fs');
const path = require('path');

function codexSessionsDir(codexHome) {
  return path.join(codexHome, '.codex', 'sessions');
}

/**
 * Parse a rollout JSONL string into a telemetry object. Returns null when the
 * content yields no usable signal (e.g. a failed turn with no token_count).
 */
function parseCodexRollout(content) {
  if (!content) {return null;}

  let sessionId = null;
  let provider = null;
  let model = null;
  let effort = null;
  let toolCalls = 0;
  let lastUsage = null;
  let contextWindow = 0;
  let usagePercent = null;

  for (const line of String(content).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {continue;}
    let evt;
    try {
      evt = JSON.parse(trimmed);
    } catch (_) {
      continue;
    }
    const payload = evt && evt.payload;
    if (!payload) {continue;}

    switch (evt.type) {
      case 'session_meta':
        sessionId = payload.id || sessionId;
        provider = payload.model_provider || provider;
        if (payload.model) {model = payload.model;}
        break;
      case 'turn_context':
        // The latest turn_context reflects the model/effort actually used.
        if (payload.model) {model = payload.model;}
        if (payload.effort) {effort = payload.effort;}
        break;
      case 'response_item':
        if (payload.type === 'function_call') {toolCalls += 1;}
        break;
      case 'event_msg':
        if (payload.type === 'token_count') {
          if (payload.info && payload.info.total_token_usage) {
            lastUsage = payload.info.total_token_usage;
            if (payload.info.model_context_window) {
              contextWindow = payload.info.model_context_window;
            }
          }
          const pct = payload.rate_limits
            && payload.rate_limits.primary
            && payload.rate_limits.primary.used_percent;
          if (typeof pct === 'number') {usagePercent = pct;}
        }
        break;
      default:
        break;
    }
  }

  if (!lastUsage && !model && !sessionId) {return null;}

  const usage = lastUsage || {};
  return {
    sessionId,
    provider: provider || null,
    model: model || null,
    effort: effort || null,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cachedTokens: usage.cached_input_tokens || 0,
    reasoningTokens: usage.reasoning_output_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    contextWindow: contextWindow || 0,
    toolCalls,
    usagePercent,
  };
}

/**
 * Collect rollout files under a Codex sessions tree modified at or after
 * `sinceMs`, sorted oldest-first by mtime. Each `codex exec` invocation —
 * including `exec resume` — writes a NEW rollout file with a fresh
 * `total_token_usage` counter, so a multi-round stage produces several files
 * whose totals must be summed to get the stage's real quota consumption.
 */
function collectRolloutFiles(sessionsDir, { sinceMs = 0 } = {}) {
  if (!sessionsDir || !fs.existsSync(sessionsDir)) {return [];}

  const found = [];
  const stack = [sessionsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
        let stat;
        try {
          stat = fs.statSync(full);
        } catch (_) {
          continue;
        }
        const mtime = stat.mtimeMs;
        if (mtime + 1000 < sinceMs) {continue;} // 1s grace for clock skew
        found.push({ full, mtime });
      }
    }
  }
  found.sort((a, b) => a.mtime - b.mtime);
  return found.map(f => f.full);
}

/**
 * Sum codex telemetry across every rollout written at or after `sinceMs` in
 * `codexHome`. Token counts and tool calls are summed across all rollouts in the
 * window (so all rounds of a resumed session are counted); model/effort/provider
 * and the rate-limit usage snapshot are taken from the newest rollout. Returns
 * null when no rollout/usable data is found.
 *
 * Idempotent by construction: it recomputes from the rollout files each call, so
 * re-running a stage (e.g. after the workflow process is resumed mid-mission)
 * yields the same total rather than double-counting.
 */
function extractCodexTelemetry(codexHome, { sinceMs = 0 } = {}) {
  const files = collectRolloutFiles(codexSessionsDir(codexHome), { sinceMs });
  if (files.length === 0) {return null;}

  const agg = {
    inputTokens: 0, outputTokens: 0, cachedTokens: 0,
    reasoningTokens: 0, totalTokens: 0, toolCalls: 0,
  };
  let newest = null;
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (_) {
      continue;
    }
    const t = parseCodexRollout(content);
    if (!t) {continue;}
    agg.inputTokens += t.inputTokens;
    agg.outputTokens += t.outputTokens;
    agg.cachedTokens += t.cachedTokens;
    agg.reasoningTokens += t.reasoningTokens;
    agg.totalTokens += t.totalTokens;
    agg.toolCalls += t.toolCalls;
    newest = t; // files are oldest-first, so the last assignment is the newest
    newest.rolloutPath = file;
  }
  if (!newest) {return null;}

  return {
    sessionId: newest.sessionId,
    provider: newest.provider,
    model: newest.model,
    effort: newest.effort,
    contextWindow: newest.contextWindow,
    usagePercent: newest.usagePercent,
    rolloutPath: newest.rolloutPath,
    rolloutCount: files.length,
    ...agg,
  };
}

module.exports = {
  codexSessionsDir,
  parseCodexRollout,
  collectRolloutFiles,
  extractCodexTelemetry,
};
