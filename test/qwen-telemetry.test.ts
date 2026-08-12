import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
'use strict';

import {
  parseTokenUsageLine,
  parseUsageRecordLine,
  collectTokenUsageRecords,
  collectUsageRecord,
  extractQwenTelemetry,
  MAX_SESSION_AGE_MINUTES,
  TELEMETRY_WINDOW_SECONDS
} from '../src/adapters/agents/qwen-telemetry.js';

// --- Token usage line parsing ---

test('parseTokenUsageLine extracts all token categories', () => {
  const line = JSON.stringify({
    schemaVersion: 1,
    id: 'test-1',
    timestamp: '2026-08-11T14:30:00.000Z',
    sessionId: 'sess-1',
    model: 'qwen3.8-max',
    authType: 'openai',
    source: 'main',
    inputTokens: 1000,
    outputTokens: 200,
    cachedTokens: 900,
    thoughtsTokens: 150,
    totalTokens: 1200,
    apiDurationMs: 5000,
  });

  const result = parseTokenUsageLine(line);
  assert.equal(result.sessionId, 'sess-1');
  assert.equal(result.model, 'qwen3.8-max');
  assert.equal(result.authType, 'openai');
  assert.equal(result.inputTokens, 1000);
  assert.equal(result.outputTokens, 200);
  assert.equal(result.cachedTokens, 900);
  assert.equal(result.thoughtsTokens, 150);
  assert.equal(result.totalTokens, 1200);
  assert.equal(result.apiDurationMs, 5000);
});

test('parseTokenUsageLine returns null for empty/garbage', () => {
  assert.equal(parseTokenUsageLine(''), null);
  assert.equal(parseTokenUsageLine('not json'), null);
  assert.equal(parseTokenUsageLine('{}'), null);
});

test('parseTokenUsageLine handles zero token counts', () => {
  const line = JSON.stringify({
    schemaVersion: 1,
    sessionId: 'sess-zero',
    model: 'qwen3.8-max',
    authType: 'openai',
    timestamp: '2026-08-11T14:30:00.000Z',
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    thoughtsTokens: 0,
    totalTokens: 0,
    apiDurationMs: 3000,
  });

  const result = parseTokenUsageLine(line);
  assert.equal(result.inputTokens, 0);
  assert.equal(result.outputTokens, 0);
  assert.equal(result.totalTokens, 0);
  assert.equal(result.thoughtsTokens, 0);
});

// --- Usage record parsing ---

test('parseUsageRecordLine extracts session summary', () => {
  const line = JSON.stringify({
    version: 1,
    sessionId: 'sess-1',
    project: '/home/user/project',
    startTime: Date.now() - 60000,
    endTime: Date.now(),
    durationMs: 55000,
    models: {
      'qwen3.8-max': {
        requests: 5,
        inputTokens: 5000,
        outputTokens: 1000,
        cachedTokens: 4000,
        thoughtsTokens: 500,
        totalTokens: 6000,
      },
    },
    tools: {
      totalCalls: 10,
      totalSuccess: 9,
      totalFail: 1,
      byName: { read_file: { count: 5, success: 5, fail: 0 } },
    },
    files: { linesAdded: 50, linesRemoved: 10 },
  });

  const result = parseUsageRecordLine(line);
  assert.equal(result.sessionId, 'sess-1');
  assert.equal(result.toolCalls, 10);
  assert.equal(result.toolSuccess, 9);
  assert.equal(result.toolFail, 1);
  assert.equal(result.linesAdded, 50);
  assert.equal(result.durationMs, 55000);
  assert.ok(result.models['qwen3.8-max']);
});

test('parseUsageRecordLine returns null for empty/garbage', () => {
  assert.equal(parseUsageRecordLine(''), null);
  assert.equal(parseUsageRecordLine('not json'), null);
});

// --- Collection from disk ---

test('collectTokenUsageRecords returns empty array when no usage dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tel-test-'));
  const records = collectTokenUsageRecords(tmp);
  assert.deepEqual(records, []);
});

test('collectTokenUsageRecords reads and parses token usage files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tel-test-'));
  const usageDir = path.join(tmp, 'usage');
  fs.mkdirSync(usageDir, { recursive: true });

  const lines = [
    JSON.stringify({
      schemaVersion: 1, sessionId: 's1', model: 'qwen3.8-max',
      authType: 'openai', timestamp: '2026-08-11T14:30:00.000Z',
      inputTokens: 1000, outputTokens: 200, cachedTokens: 900,
      thoughtsTokens: 150, totalTokens: 1200, apiDurationMs: 5000,
    }),
    JSON.stringify({
      schemaVersion: 1, sessionId: 's1', model: 'qwen3.8-max',
      authType: 'openai', timestamp: '2026-08-11T14:31:00.000Z',
      inputTokens: 2000, outputTokens: 300, cachedTokens: 1900,
      thoughtsTokens: 200, totalTokens: 2300, apiDurationMs: 7000,
    }),
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(usageDir, 'token-usage-2026-08.jsonl'), lines);

  const records = collectTokenUsageRecords(tmp);
  assert.equal(records.length, 2);
  assert.equal(records[0].inputTokens, 1000);
  assert.equal(records[1].inputTokens, 2000);
});

test('collectTokenUsageRecords respects invocation window', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tel-test-'));
  const usageDir = path.join(tmp, 'usage');
  fs.mkdirSync(usageDir, { recursive: true });

  const now = Date.now();
  const oldTimestamp = new Date(now - (MAX_SESSION_AGE_MINUTES + 10) * 60000).toISOString();
  const newTimestamp = new Date(now).toISOString();

  const lines = [
    JSON.stringify({
      schemaVersion: 1, sessionId: 'old', model: 'qwen3.8-max',
      authType: 'openai', timestamp: oldTimestamp,
      inputTokens: 9999, outputTokens: 0, cachedTokens: 0,
      thoughtsTokens: 0, totalTokens: 9999, apiDurationMs: 0,
    }),
    JSON.stringify({
      schemaVersion: 1, sessionId: 'new', model: 'qwen3.8-max',
      authType: 'openai', timestamp: newTimestamp,
      inputTokens: 100, outputTokens: 50, cachedTokens: 0,
      thoughtsTokens: 20, totalTokens: 150, apiDurationMs: 3000,
    }),
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(usageDir, 'token-usage-2026-08.jsonl'), lines);

  const records = collectTokenUsageRecords(tmp, { sinceMs: now });
  assert.equal(records.length, 1, 'only recent record within window');
  assert.equal(records[0].sessionId, 'new');
});

test('collectTokenUsageRecords: sequential launches do not aggregate across invocations', () => {
  // Regression: draft invocation writes token records, then review invocation
  // in same QWEN_HOME picks up draft's records as its own stats.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tel-seq-'));
  const usageDir = path.join(tmp, 'usage');
  fs.mkdirSync(usageDir, { recursive: true });

  // Simulate two invocations in the same worktree, 5 minutes apart.
  // Draft ran at T=0, review runs at T=5min.
  const draftStart = Date.now() - 5 * 60 * 1000;
  const reviewStart = Date.now();

  const lines = [
    // Draft invocation's records (5 min ago)
    JSON.stringify({
      schemaVersion: 1, sessionId: 'draft-sess', model: 'qwen3.8-max',
      authType: 'openai', timestamp: new Date(draftStart + 1000).toISOString(),
      inputTokens: 5000, outputTokens: 500, cachedTokens: 0,
      thoughtsTokens: 200, totalTokens: 5500, apiDurationMs: 8000,
    }),
    // Review invocation's records (just now)
    JSON.stringify({
      schemaVersion: 1, sessionId: 'review-sess', model: 'qwen3.8-max',
      authType: 'openai', timestamp: new Date(reviewStart + 2000).toISOString(),
      inputTokens: 300, outputTokens: 100, cachedTokens: 0,
      thoughtsTokens: 50, totalTokens: 350, apiDurationMs: 3000,
    }),
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(usageDir, 'token-usage-2026-08.jsonl'), lines);

  // Review invocation should NOT see draft's records
  const reviewRecords = collectTokenUsageRecords(tmp, { sinceMs: reviewStart });
  assert.equal(reviewRecords.length, 1, 'review sees only its own record');
  assert.equal(reviewRecords[0].sessionId, 'review-sess');
  assert.equal(reviewRecords[0].inputTokens, 300, 'no draft tokens in review stats');

  // Draft invocation (when it ran) saw its own record
  const draftRecords = collectTokenUsageRecords(tmp, { sinceMs: draftStart });
  assert.ok(draftRecords.length >= 1, 'draft sees at least its own record');
});

test('collectTokenUsageRecords: prior record inside 60s buffer excluded by sessionId', () => {
  // Regression: draft writes artifact 30s before review starts — falls inside
  // the 60s buffer and would be charged to review without session-id filter.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tel-buffer-'));
  const usageDir = path.join(tmp, 'usage');
  fs.mkdirSync(usageDir, { recursive: true });

  const reviewStart = Date.now();
  const draftTimestamp = reviewStart - 30 * 1000; // 30s before review start

  const lines = [
    // Draft's record — 30s before review (inside 60s buffer)
    JSON.stringify({
      schemaVersion: 1, sessionId: 'draft-sess', model: 'qwen3.8-max',
      authType: 'openai', timestamp: new Date(draftTimestamp).toISOString(),
      inputTokens: 5000, outputTokens: 500, cachedTokens: 0,
      thoughtsTokens: 200, totalTokens: 5500, apiDurationMs: 8000,
    }),
    // Review's record
    JSON.stringify({
      schemaVersion: 1, sessionId: 'review-sess', model: 'qwen3.8-max',
      authType: 'openai', timestamp: new Date(reviewStart + 1000).toISOString(),
      inputTokens: 300, outputTokens: 100, cachedTokens: 0,
      thoughtsTokens: 50, totalTokens: 350, apiDurationMs: 3000,
    }),
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(usageDir, 'token-usage-2026-08.jsonl'), lines);

  // Without sessionId: draft record passes 60s buffer check, leaks into review
  const withoutSession = collectTokenUsageRecords(tmp, { sinceMs: reviewStart });
  assert.equal(withoutSession.length, 2, 'without sessionId filter, draft leaks in');

  // With sessionId: only review's record accepted
  const withSession = collectTokenUsageRecords(tmp, { sinceMs: reviewStart, sessionId: 'review-sess' });
  assert.equal(withSession.length, 1, 'with sessionId filter, only review record');
  assert.equal(withSession[0].sessionId, 'review-sess');
  assert.equal(withSession[0].inputTokens, 300, 'no draft tokens');
});

test('collectUsageRecord returns most recent session in window', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tel-test-'));
  const now = Date.now();

  const lines = [
    JSON.stringify({
      version: 1, sessionId: 'old-sess', project: '/tmp',
      startTime: now - 3600000, endTime: now - 3500000,
      durationMs: 100000, models: {}, tools: { totalCalls: 0 },
      files: { linesAdded: 0, linesRemoved: 0 },
    }),
    JSON.stringify({
      version: 1, sessionId: 'new-sess', project: '/tmp',
      startTime: now - 60000, endTime: now,
      durationMs: 55000, models: {}, tools: { totalCalls: 10 },
      files: { linesAdded: 50, linesRemoved: 10 },
    }),
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(tmp, 'usage_record.jsonl'), lines);

  const record = collectUsageRecord(tmp, { sinceMs: now });
  assert.equal(record.sessionId, 'new-sess');
  assert.equal(record.toolCalls, 10);
});

// --- Full extraction ---

test('extractQwenTelemetry sums tokens across multiple API calls', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tel-test-'));
  const usageDir = path.join(tmp, 'usage');
  fs.mkdirSync(usageDir, { recursive: true });

  const now = Date.now();
  const lines = [
    JSON.stringify({
      schemaVersion: 1, sessionId: 's1', model: 'qwen3.8-max',
      authType: 'openai', timestamp: new Date(now).toISOString(),
      inputTokens: 1000, outputTokens: 200, cachedTokens: 900,
      thoughtsTokens: 150, totalTokens: 1200, apiDurationMs: 5000,
    }),
    JSON.stringify({
      schemaVersion: 1, sessionId: 's1', model: 'qwen3.8-max',
      authType: 'openai', timestamp: new Date(now + 1000).toISOString(),
      inputTokens: 2000, outputTokens: 300, cachedTokens: 1800,
      thoughtsTokens: 250, totalTokens: 2300, apiDurationMs: 7000,
    }),
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(usageDir, 'token-usage-2026-08.jsonl'), lines);

  // Session summary with tool calls
  fs.writeFileSync(path.join(tmp, 'usage_record.jsonl'),
    JSON.stringify({
      version: 1, sessionId: 's1', project: '/tmp',
      startTime: now, endTime: now + 12000,
      durationMs: 12000,
      models: { 'qwen3.8-max': { requests: 2 } },
      tools: { totalCalls: 5, totalSuccess: 5, totalFail: 0 },
      files: { linesAdded: 10, linesRemoved: 2 },
    }) + '\n'
  );

  const t = extractQwenTelemetry(tmp, { sinceMs: now });
  assert.ok(t, 'telemetry extracted');
  assert.equal(t.inputTokens, 3000, 'input tokens summed');
  assert.equal(t.outputTokens, 500, 'output tokens summed');
  assert.equal(t.cachedTokens, 2700, 'cached tokens summed');
  assert.equal(t.thoughtsTokens, 400, 'thoughts tokens summed');
  assert.equal(t.totalTokens, 3500, 'total tokens summed');
  assert.equal(t.toolCalls, 5, 'tool calls from session summary');
  assert.equal(t.model, 'qwen3.8-max', 'primary model from last record');
  assert.equal(t.provider, 'openai', 'provider from authType');
  assert.equal(t.honestZeros, false, 'not honest zeros');
  assert.equal(t.recordCount, 2, 'two records processed');
});

test('extractQwenTelemetry preserves per-model breakdown', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tel-test-'));
  const usageDir = path.join(tmp, 'usage');
  fs.mkdirSync(usageDir, { recursive: true });

  const now = Date.now();
  const lines = [
    JSON.stringify({
      schemaVersion: 1, sessionId: 's1', model: 'qwen3.8-max',
      authType: 'openai', timestamp: new Date(now).toISOString(),
      inputTokens: 1000, outputTokens: 100, cachedTokens: 0,
      thoughtsTokens: 50, totalTokens: 1100, apiDurationMs: 5000,
    }),
    JSON.stringify({
      schemaVersion: 1, sessionId: 's1', model: 'qwen3.7-plus',
      authType: 'openai', timestamp: new Date(now + 1000).toISOString(),
      inputTokens: 500, outputTokens: 50, cachedTokens: 400,
      thoughtsTokens: 30, totalTokens: 550, apiDurationMs: 3000,
    }),
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(usageDir, 'token-usage-2026-08.jsonl'), lines);

  const t = extractQwenTelemetry(tmp, { sinceMs: now });
  assert.ok(t.modelBreakdown['qwen3.8-max'], 'qwen3.8-max in breakdown');
  assert.ok(t.modelBreakdown['qwen3.7-plus'], 'qwen3.7-plus in breakdown');
  assert.equal(t.modelBreakdown['qwen3.8-max'].inputTokens, 1000);
  assert.equal(t.modelBreakdown['qwen3.7-plus'].inputTokens, 500);
});

test('extractQwenTelemetry returns honest zeros when endpoint reports no usage', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tel-test-'));
  const usageDir = path.join(tmp, 'usage');
  fs.mkdirSync(usageDir, { recursive: true });

  const now = Date.now();
  // All-zero token counts (observed failure mode: endpoint did not report usage)
  const lines = [
    JSON.stringify({
      schemaVersion: 1, sessionId: 's-zero', model: 'qwen3.8-max',
      authType: 'openai', timestamp: new Date(now).toISOString(),
      inputTokens: 0, outputTokens: 0, cachedTokens: 0,
      thoughtsTokens: 0, totalTokens: 0, apiDurationMs: 3000,
    }),
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(usageDir, 'token-usage-2026-08.jsonl'), lines);

  const t = extractQwenTelemetry(tmp, { sinceMs: now });
  assert.ok(t, 'telemetry returned even with zero counts');
  assert.equal(t.honestZeros, true, 'honestZeros flag set');
  assert.equal(t.inputTokens, 0);
  assert.equal(t.totalTokens, 0);
  assert.equal(t.recordCount, 1, 'records exist (zeros are real, not missing)');
});

test('extractQwenTelemetry returns null when no artifacts exist', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tel-empty-'));
  const t = extractQwenTelemetry(tmp, { sinceMs: 0 });
  assert.equal(t, null);
});

test('extractQwenTelemetry: thoughtsTokens separately tracked (not folded into output)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tel-thoughts-'));
  const usageDir = path.join(tmp, 'usage');
  fs.mkdirSync(usageDir, { recursive: true });

  const now = Date.now();
  const lines = [
    JSON.stringify({
      schemaVersion: 1, sessionId: 's1', model: 'qwen3.8-max',
      authType: 'openai', timestamp: new Date(now).toISOString(),
      inputTokens: 1000, outputTokens: 200, cachedTokens: 900,
      thoughtsTokens: 150, totalTokens: 1200, apiDurationMs: 5000,
    }),
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(usageDir, 'token-usage-2026-08.jsonl'), lines);

  const t = extractQwenTelemetry(tmp, { sinceMs: now });
  assert.equal(t.thoughtsTokens, 150, 'thoughtsTokens preserved separately');
  assert.equal(t.outputTokens, 200, 'outputTokens not inflated by thoughts');
  assert.notEqual(t.thoughtsTokens, t.outputTokens, 'thoughts and output are distinct');
});

test('extractQwenTelemetry: parses captured real CLI artifacts (format pin, R1)', () => {
  // Real samples captured from qwen CLI v0.21.9 rather than synthesized, so a
  // schema change in a future CLI version fails here instead of silently
  // producing zeros.
  const fixtures = path.join(import.meta.dirname, 'fixtures', 'qwen');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tel-real-'));
  fs.mkdirSync(path.join(tmp, 'usage'), { recursive: true });
  fs.copyFileSync(
    path.join(fixtures, 'token-usage-2026-08.sample.jsonl'),
    path.join(tmp, 'usage', 'token-usage-2026-08.jsonl'),
  );
  fs.copyFileSync(
    path.join(fixtures, 'usage_record.sample.jsonl'),
    path.join(tmp, 'usage_record.jsonl'),
  );

  const t = extractQwenTelemetry(tmp, { sinceMs: 0 });
  assert.ok(t, 'telemetry extracted from real artifacts');
  assert.ok(t.inputTokens > 0, 'input tokens parsed');
  assert.ok(t.thoughtsTokens > 0, 'thoughts tokens parsed');
  assert.equal(t.provider, 'openai');
  assert.equal(t.model, 'qwen3.8-max');
  assert.equal(t.honestZeros, false);
});
