'use strict';

// Codex telemetry is read from the per-session rollout JSONL that the Codex CLI
// always writes under `$CODEX_HOME/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`.
// The launcher isolates `CODEX_HOME` per worktree, so reading the
// rollout — rather than parsing the `--json` stdout stream — keeps the human-readable
// transcript and session-resume behaviour intact while still yielding real usage data.
//
// Relevant rollout events (each line is one JSON object):
//   {"type":"session_meta","payload":{"id","model_provider","model"?,...}}
//   {"type":"turn_context","payload":{"model","effort",...}}
//   {"type":"response_item","payload":{"type":"function_call"|"custom_tool_call",...}}
//   {"type":"event_msg","payload":{"type":"token_count","info":{...},"rate_limits":{...}}}

import fs from 'node:fs';
import path from 'node:path';

function codexSessionsDir(codexHome: string) {
  return path.join(codexHome, '.codex', 'sessions');
}

/**
 * Parse a rollout JSONL string into a telemetry object. Returns null when the
 * content yields no usable signal (e.g. a failed turn with no token_count).
 */
function parseCodexRollout(content: string) {
  if (!content) {return null;}

  const state: any = { sessionId: null, provider: null, model: null, effort: null, toolCalls: 0, lastUsage: null, contextWindow: 0, usagePercent: null };

  for (const line of String(content).split('\n')) {
    applyCodexRolloutEvent(line, state);
  }

  if (!state.lastUsage && !state.model && !state.sessionId) {return null;}

  const usage = state.lastUsage || {};
  return {
    sessionId: state.sessionId,
    provider: state.provider || null,
    model: state.model || null,
    effort: state.effort || null,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cachedTokens: usage.cached_input_tokens || 0,
    reasoningTokens: usage.reasoning_output_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    contextWindow: state.contextWindow || 0,
    toolCalls: state.toolCalls,
    usagePercent: state.usagePercent,
  };
}

function applyCodexRolloutEvent(line: string, state: any): void {
  let event: any;
  try { event = JSON.parse(line.trim()); } catch { return; }
  const payload = event?.payload;
  if (!payload) { return; }
  if (event.type === 'session_meta') {
    state.sessionId = payload.id || state.sessionId;
    state.provider = payload.model_provider || state.provider;
    state.model = payload.model || state.model;
  } else if (event.type === 'turn_context') {
    state.model = payload.model || state.model;
    state.effort = payload.effort || state.effort;
  } else if (event.type === 'response_item') {
    state.toolCalls += Number(payload.type === 'function_call' || payload.type === 'custom_tool_call');
  } else if (event.type === 'event_msg' && payload.type === 'token_count') {
    state.lastUsage = payload.info?.total_token_usage || state.lastUsage;
    state.contextWindow = payload.info?.model_context_window || state.contextWindow;
    state.usagePercent = typeof payload.rate_limits?.primary?.used_percent === 'number' ? payload.rate_limits.primary.used_percent : state.usagePercent;
  }
}

/**
 * Collect rollout files under a Codex sessions tree modified at or after
 * `sinceMs`, sorted oldest-first by mtime. Each `codex exec` invocation —
 * including `exec resume` — writes a NEW rollout file with a fresh
 * `total_token_usage` counter, so a multi-round stage produces several files
 * whose totals must be summed to get the stage's real quota consumption.
 */
function collectRolloutFiles(sessionsDir: string, { sinceMs = 0 }: { sinceMs?: number } = {}) {
  if (!sessionsDir || !fs.existsSync(sessionsDir)) {return [];}

  const found = [];
  const stack = [sessionsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = rolloutEntries(dir || '', sinceMs);
    stack.push(...entries.directories);
    found.push(...entries.files);
  }
  found.sort((a, b) => a.mtime - b.mtime);
  return found.map(f => f.full);
}

function rolloutEntries(dir: string, sinceMs: number) {
  let entries: Array<{name: string, isDirectory: () => boolean, isFile: () => boolean}>;
  try { entries = (fs as any).readdirSync(dir, { withFileTypes: true }); } catch { return { directories: [], files: [] as Array<{ full: string; mtime: number }> }; }
  const directories: string[] = [];
  const files: Array<{ full: string; mtime: number }> = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name || '');
    if (entry.isDirectory()) { directories.push(full); }
    else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      try {
        const mtime = fs.statSync(full).mtimeMs;
        if (mtime + 1000 >= sinceMs) { files.push({ full, mtime }); }
      } catch { /* concurrent cleanup removed the file */ }
    }
  }
  return { directories, files };
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
function extractCodexTelemetry(codexHome: string, { sinceMs = 0 }: { sinceMs?: number } = {}) {
  const files = collectRolloutFiles(codexSessionsDir(codexHome), { sinceMs });
  if (files.length === 0) {return null;}

  const aggregate = codexTelemetryAggregate();
  for (const file of files) {
    const t = readCodexRollout(file);
    if (!t) {continue;}
    aggregate.add(t, file);
  }
  if (!aggregate.newest) {return null;}

  return {
    sessionId: aggregate.newest.sessionId,
    provider: aggregate.newest.provider,
    model: aggregate.newest.model,
    effort: aggregate.newest.effort,
    contextWindow: aggregate.newest.contextWindow,
    usagePercent: aggregate.newest.usagePercent,
    rolloutPath: aggregate.newestPath,
    rolloutCount: files.length,
    ...aggregate.totals,
  };
}

function readCodexRollout(file: string) {
  try { return parseCodexRollout(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function codexTelemetryAggregate() {
  const totals = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, totalTokens: 0, toolCalls: 0 };
  return {
    totals, newest: null as any, newestPath: null as string | null,
    add(telemetry: any, path: string) {
      for (const field of Object.keys(totals) as Array<keyof typeof totals>) { totals[field] += telemetry[field]; }
      this.newest = telemetry;
      this.newestPath = path;
    },
  };
}

export {
  codexSessionsDir,
  parseCodexRollout,
  collectRolloutFiles,
  extractCodexTelemetry,
};
