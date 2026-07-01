'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseMistralMeta,
  extractMistralTelemetry,
  getMistralProviderModel,
} = require('../lib/agents/mistral-telemetry');

// ---------- parseMistralMeta ----------

// Sample meta.json content for fixture-backed tests.
// Based on real session data from ~/.vibe/logs/session/session_20260701_171711_fbdc221c/meta.json (task-1288).
const SAMPLE_META = {
  session_id: 'fbdc221c-cd03-tm2_-x',
  start_time: '2026-07-01T17:17:11.000Z',
  end_time: '2026-07-01T17:17:13.000Z',
  stats: {
    steps: 2,
    session_prompt_tokens: 9331,
    session_completion_tokens: 62,
    tool_calls_agreed: 0,
    tool_calls_rejected: 0,
    tool_calls_hook_denied: 0,
    tool_calls_failed: 0,
    tool_calls_succeeded: 0,
    context_tokens: 9393,
    last_turn_prompt_tokens: 9331,
    last_turn_completion_tokens: 62,
    last_turn_duration: 1.7835875800810754,
    tokens_per_second: 34.76139926763882,
    input_price_per_million: 1.5,
    output_price_per_million: 7.5,
    session_total_llm_tokens: 9393,
    last_turn_total_tokens: 9393,
    session_cost: 0.014461500000000002,
  },
};

// Empty stats (no usage) — mirrors a failed or zero-cost session.
const EMPTY_STATS_META = {
  session_id: 'empty-session',
  stats: {
    steps: 0,
    session_prompt_tokens: 0,
    session_completion_tokens: 0,
    tool_calls_agreed: 0,
    tool_calls_rejected: 0,
    tool_calls_failed: 0,
    tool_calls_succeeded: 0,
    context_tokens: 0,
    last_turn_prompt_tokens: 0,
    last_turn_completion_tokens: 0,
    last_turn_duration: 0.0,
    tokens_per_second: 0.0,
    session_total_llm_tokens: 0,
    last_turn_total_tokens: 0,
    session_cost: 0.0,
  },
};

test('parseMistralMeta extracts telemetry from meta.json stats', () => {
  const t = parseMistralMeta(SAMPLE_META);
  assert.ok(t);
  assert.equal(t.inputTokens, 9331);
  assert.equal(t.outputTokens, 62);
  assert.equal(t.totalTokens, 9393);
  assert.equal(t.contextTokens, 9393);
  assert.equal(t.toolCallsAgreed, 0);
  assert.equal(t.toolCallsRejected, 0);
  assert.equal(t.toolCallsFailed, 0);
  assert.equal(t.toolCallsSucceeded, 0);
  assert.equal(t.sessionCost, 0.014461500000000002);
});

test('parseMistralMeta returns null for missing stats block', () => {
  assert.equal(parseMistralMeta({}), null);
  assert.equal(parseMistralMeta({ session_id: 'x' }), null);
});

test('parseMistralMeta returns null for empty/garbage input', () => {
  assert.equal(parseMistralMeta(null), null);
  assert.equal(parseMistralMeta(undefined), null);
  assert.equal(parseMistralMeta('not json'), null);
});

test('parseMistralMeta returns null for all-zero stats (no usable signal)', () => {
  assert.equal(parseMistralMeta(EMPTY_STATS_META), null);
});

test('parseMistralMeta coerces string-like numbers gracefully', () => {
  const meta = {
    stats: {
      session_prompt_tokens: '1000',
      session_completion_tokens: '200',
      session_total_llm_tokens: '1200',
    },
  };
  const t = parseMistralMeta(meta);
  assert.ok(t);
  assert.equal(t.inputTokens, 1000);
  assert.equal(t.outputTokens, 200);
  assert.equal(t.totalTokens, 1200);
});

// ---------- extractMistralTelemetry ----------

test('extractMistralTelemetry returns null for empty session directory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-empty-'));
  try {
    assert.equal(extractMistralTelemetry(null, tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractMistralTelemetry returns null when no sessions exist', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-nosess-'));
  try {
    assert.equal(extractMistralTelemetry(null, tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractMistralTelemetry parses the most recent session meta.json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-fix-'));
  try {
    // Create two sessions; older one first.
    const oldDir = path.join(tmp, 'session_20260601_100000_aaaaaaaa');
    const newDir = path.join(tmp, 'session_20260701_171711_bbcccccc');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });

    // Old session meta (different token counts).
    const oldMeta = Object.assign({}, SAMPLE_META, {
      session_id: 'old-session',
      stats: Object.assign({}, SAMPLE_META.stats, {
        session_prompt_tokens: 500,
        session_completion_tokens: 10,
        session_total_llm_tokens: 510,
      }),
    });
    fs.writeFileSync(path.join(oldDir, 'meta.json'), JSON.stringify(oldMeta));

    // New session meta.
    fs.writeFileSync(path.join(newDir, 'meta.json'), JSON.stringify(SAMPLE_META));

    const result = extractMistralTelemetry(null, tmp);
    assert.ok(result);
    assert.equal(result.inputTokens, 9331);
    assert.equal(result.outputTokens, 62);
    assert.equal(result.totalTokens, 9393);
    assert.equal(result.path, path.join(newDir, 'meta.json'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractMistralTelemetry skips sessions without meta.json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-nometa-'));
  try {
    const dir = path.join(tmp, 'session_20260701_171711_ccdddddd');
    fs.mkdirSync(dir, { recursive: true });
    // Only write messages.jsonl, no meta.json.
    fs.writeFileSync(path.join(dir, 'messages.jsonl'), '');

    assert.equal(extractMistralTelemetry(null, tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractMistralTelemetry skips corrupt meta.json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-corrupt-'));
  try {
    const dir = path.join(tmp, 'session_20260701_171711_eefffff');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.json'), 'not valid json{{{');

    assert.equal(extractMistralTelemetry(null, tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractMistralTelemetry skips session with all-zero stats', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-zero-'));
  try {
    const dir = path.join(tmp, 'session_20260701_171711_gggggggg');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(EMPTY_STATS_META));

    // All-zero stats should be skipped (no usable signal).
    assert.equal(extractMistralTelemetry(null, tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractMistralTelemetry picks valid session when newer one has zero stats', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-zeronew-'));
  try {
    const oldDir = path.join(tmp, 'session_20260601_100000_hhhhhhhh');
    const newDir = path.join(tmp, 'session_20260701_171711_iiiiiiii');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });

    fs.writeFileSync(path.join(oldDir, 'meta.json'), JSON.stringify(SAMPLE_META));
    fs.writeFileSync(path.join(newDir, 'meta.json'), JSON.stringify(EMPTY_STATS_META));

    const result = extractMistralTelemetry(null, tmp);
    // Should fall back to the older session which has real stats.
    assert.ok(result);
    assert.equal(result.inputTokens, 9331);
    assert.equal(result.path, path.join(oldDir, 'meta.json'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- getMistralProviderModel ----------

test('getMistralProviderModel returns correct fallback identity', () => {
  const pm = getMistralProviderModel();
  assert.equal(pm.provider, 'mistral');
  assert.equal(pm.model, 'mistral');
});
