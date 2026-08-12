'use strict';

// Qwen telemetry is read from disk artifacts written by the qwen CLI
// independent of --output-format. With QWEN_HOME isolated per worktree,
// cross-mission misattribution is structurally prevented.
//
// Artifacts:
//   <QWEN_HOME>/usage/token-usage-YYYY-MM.jsonl — one JSONL record per API call:
//     { schemaVersion, id, timestamp, sessionId, model, authType, source,
//       inputTokens, outputTokens, cachedTokens, thoughtsTokens, totalTokens, apiDurationMs }
//   <QWEN_HOME>/usage_record.jsonl — one record per session:
//     { version, sessionId, project, startTime, endTime, durationMs,
//       models: { <model>: { requests, inputTokens, outputTokens, ... } },
//       tools: { totalCalls, totalSuccess, totalFail, byName: {...} },
//       files: { linesAdded, linesRemoved } }

import fs from 'node:fs';
import path from 'node:path';

/**
 * Maximum acceptable age (in minutes) for a qwen session's start time
 * relative to the invocation start. Sessions older than this window are
 * rejected as potentially misattributed across concurrent missions.
 * Matches the value in qwen.ts for session-id extraction.
 */
const MAX_SESSION_AGE_MINUTES = 120;

/**
 * Maximum lookback (in seconds) for token-usage records relative to
 * invocation start. Token records timestamped before the invocation are
 * from a previous run in the same QWEN_HOME and must not be aggregated
 * into this invocation's statistics. A 60-second buffer covers clock drift
 * and async write timing.
 */
const TELEMETRY_WINDOW_SECONDS = 60;

/**
 * Parse a single line from token-usage-YYYY-MM.jsonl.
 * Returns null for malformed lines.
 */
function parseTokenUsageLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {return null;}
  let record;
  try { record = JSON.parse(trimmed); } catch { return null; }
  if (!record || typeof record !== 'object' || Object.keys(record).length === 0) {return null;}

  return {
    sessionId: record.sessionId || null,
    model: record.model || null,
    authType: record.authType || null,
    inputTokens: Number(record.inputTokens) || 0,
    outputTokens: Number(record.outputTokens) || 0,
    cachedTokens: Number(record.cachedTokens) || 0,
    thoughtsTokens: Number(record.thoughtsTokens) || 0,
    totalTokens: Number(record.totalTokens) || 0,
    apiDurationMs: Number(record.apiDurationMs) || 0,
    timestamp: record.timestamp || null,
  };
}

/**
 * Parse a single line from usage_record.jsonl.
 * Returns null for malformed lines.
 */
function parseUsageRecordLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {return null;}
  let record;
  try { record = JSON.parse(trimmed); } catch { return null; }
  if (!record || typeof record !== 'object' || Object.keys(record).length === 0) {return null;}

  const models = record.models || {};
  const tools = record.tools || {};
  const files = record.files || {};

  return {
    sessionId: record.sessionId || null,
    project: record.project || null,
    startTime: record.startTime || null,
    endTime: record.endTime || null,
    durationMs: Number(record.durationMs) || 0,
    models,
    toolCalls: Number(tools.totalCalls) || 0,
    toolSuccess: Number(tools.totalSuccess) || 0,
    toolFail: Number(tools.totalFail) || 0,
    linesAdded: Number(files.linesAdded) || 0,
    linesRemoved: Number(files.linesRemoved) || 0,
  };
}

/**
 * Collect token usage records from <QWEN_HOME>/usage/token-usage-*.jsonl
 * within the invocation window. Returns array of parsed records sorted by
 * timestamp.
 */
function collectTokenUsageRecords(
  qwenHome: string,
  { sinceMs = 0, sessionId = null }: { sinceMs?: number; sessionId?: string | null } = {}
) {
  const usageDir = path.join(qwenHome, 'usage');
  if (!fs.existsSync(usageDir)) {return [];}

  const records: Array<{ record: ReturnType<typeof parseTokenUsageLine>; timestamp: string }> = [];

  try {
    const files = fs.readdirSync(usageDir)
      .filter((f: string) => f.startsWith('token-usage-') && f.endsWith('.jsonl'))
      .sort();

    for (const file of files) {
      const content = fs.readFileSync(path.join(usageDir, file), 'utf8');
      for (const line of content.split('\n')) {
        const parsed = parseTokenUsageLine(line);
        if (!parsed || !parsed.timestamp) {continue;}

        // Session ID guard — when the invocation's session is known, only
        // accept records from that session. This prevents a preceding stage
        // in the same worktree from leaking its artifacts into the next stage.
        if (sessionId && parsed.sessionId !== sessionId) {continue;}

        // Telemetry window guard — reject records from a previous invocation
        // in the same QWEN_HOME. Records predating this invocation belong to
        // an earlier run. The buffer covers only post-start async writes.
        const recordTime = Date.parse(parsed.timestamp);
        if (!Number.isNaN(sinceMs) && !Number.isNaN(recordTime)) {
          const cutoff = sinceMs - (TELEMETRY_WINDOW_SECONDS * 1000);
          if (recordTime < cutoff) {continue;}
        }

        records.push({ record: parsed, timestamp: parsed.timestamp });
      }
    }
  } catch {
    // Usage dir unreadable — return empty
  }

  records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return records.map(r => r.record).filter((r): r is NonNullable<typeof r> => r !== null);
}

/**
 * Collect usage record (session summary) from <QWEN_HOME>/usage_record.jsonl
 * within the invocation window. Returns the most recent matching record.
 */
function collectUsageRecord(
  qwenHome: string,
  { sinceMs = 0, sessionId = null }: { sinceMs?: number; sessionId?: string | null } = {}
) {
  const recordPath = path.join(qwenHome, 'usage_record.jsonl');
  if (!fs.existsSync(recordPath)) {return null;}

  let bestRecord: ReturnType<typeof parseUsageRecordLine> | null = null;
  let bestTime = 0;

  try {
    const content = fs.readFileSync(recordPath, 'utf8');
    for (const line of content.split('\n')) {
      const parsed = parseUsageRecordLine(line);
      if (!parsed || !parsed.startTime) {continue;}

      // Session ID guard — match only the invocation's session
      if (sessionId && parsed.sessionId !== sessionId) {continue;}

      const recordTime = parsed.startTime;
      if (!Number.isNaN(sinceMs)) {
        const cutoff = sinceMs - (TELEMETRY_WINDOW_SECONDS * 1000);
        if (recordTime < cutoff) {continue;}
      }

      if (recordTime > bestTime) {
        bestTime = recordTime;
        bestRecord = parsed;
      }
    }
  } catch {
    // File unreadable
  }

  return bestRecord;
}

/**
 * Extract qwen telemetry from disk artifacts. Sums token usage across all
 * API calls in the invocation window, takes tool calls from the session
 * summary, and preserves per-model attribution.
 *
 * Honest-zeros policy: when the endpoint reports all-zero token counts
 * (observed failure mode), returns telemetry with zero tokens and
 * honestZeros=true so the caller can distinguish "no usage" from
 * "no data available".
 *
 * Returns null when no artifacts exist in the window.
 */
function extractQwenTelemetry(
  qwenHome: string,
  { sinceMs = 0, sessionId = null }: { sinceMs?: number; sessionId?: string | null } = {}
) {
  const tokenRecords = collectTokenUsageRecords(qwenHome, { sinceMs, sessionId });
  const sessionRecord = collectUsageRecord(qwenHome, { sinceMs, sessionId });

  if (tokenRecords.length === 0 && !sessionRecord) {
    return null;
  }

  // Sum token counts across all API calls in window
  const agg = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    thoughtsTokens: 0,
    totalTokens: 0,
    apiDurationMs: 0,
  };

  // Per-model breakdown
  const modelMap: Record<string, typeof agg> = {};

  for (const rec of tokenRecords) {
    agg.inputTokens += rec.inputTokens;
    agg.outputTokens += rec.outputTokens;
    agg.cachedTokens += rec.cachedTokens;
    agg.thoughtsTokens += rec.thoughtsTokens;
    agg.totalTokens += rec.totalTokens;
    agg.apiDurationMs += rec.apiDurationMs;

    const model = rec.model || 'unknown';
    if (!modelMap[model]) {
      modelMap[model] = {
        inputTokens: 0, outputTokens: 0, cachedTokens: 0,
        thoughtsTokens: 0, totalTokens: 0, apiDurationMs: 0,
      };
    }
    modelMap[model].inputTokens += rec.inputTokens;
    modelMap[model].outputTokens += rec.outputTokens;
    modelMap[model].cachedTokens += rec.cachedTokens;
    modelMap[model].thoughtsTokens += rec.thoughtsTokens;
    modelMap[model].totalTokens += rec.totalTokens;
    modelMap[model].apiDurationMs += rec.apiDurationMs;
  }

  // Detect honest-zeros: records exist but all token counts are zero.
  // This happens when the endpoint does not report usage for a session.
  const hasRecords = tokenRecords.length > 0;
  const allZeros = hasRecords && agg.inputTokens === 0 && agg.outputTokens === 0 &&
    agg.cachedTokens === 0 && agg.thoughtsTokens === 0 && agg.totalTokens === 0;

  // Use the most recent model as the primary attribution
  const primaryModel = tokenRecords.length > 0
    ? tokenRecords[tokenRecords.length - 1].model
    : (sessionRecord && Object.keys(sessionRecord.models)[0]) || null;

  // Use authType from first record as provider
  const provider = tokenRecords.length > 0
    ? (tokenRecords[0].authType || 'openai')
    : 'openai';

  // Tool calls from session summary (more reliable than per-call count)
  const toolCalls = sessionRecord ? sessionRecord.toolCalls : 0;
  const durationMs = sessionRecord ? sessionRecord.durationMs : agg.apiDurationMs;

  return {
    sessionId: sessionRecord?.sessionId || (tokenRecords.length > 0 ? tokenRecords[0].sessionId : null),
    provider,
    model: primaryModel,
    modelBreakdown: modelMap,
    ...agg,
    toolCalls,
    durationMs,
    honestZeros: allZeros,
    recordCount: tokenRecords.length,
  };
}

export {
  parseTokenUsageLine,
  parseUsageRecordLine,
  collectTokenUsageRecords,
  collectUsageRecord,
  extractQwenTelemetry,
  MAX_SESSION_AGE_MINUTES,
  TELEMETRY_WINDOW_SECONDS
};
