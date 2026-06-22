'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractOpencodeTelemetryFromExport,
  extractOpencodeTelemetry,
  getOpencodeProviderModel,
} = require('../lib/agents/opencode-telemetry');

// --- extractOpencodeTelemetryFromExport tests ---

test('extractOpencodeTelemetryFromExport parses valid export JSON with total_token_usage', () => {
  const json = JSON.stringify({
    session_id: 'ses_test1',
    model: 'qwen-max',
    total_token_usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cached_input_tokens: 200,
      total_tokens: 1500,
    },
    tool_calls: 3,
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result, 'should return non-null telemetry');
  assert.equal(result.sessionId, 'ses_test1');
  assert.equal(result.provider, 'opencode');
  assert.equal(result.model, 'qwen-max');
  assert.equal(result.inputTokens, 1000);
  assert.equal(result.outputTokens, 500);
  assert.equal(result.cachedTokens, 200);
  assert.equal(result.totalTokens, 1500);
  assert.equal(result.toolCalls, 3);
  assert.equal(result.usagePercent, null);
});

test('extractOpencodeTelemetryFromExport parses flat token fields', () => {
  const json = JSON.stringify({
    session_id: 'ses_flat',
    input_tokens: 200,
    output_tokens: 100,
    total_tokens: 300,
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);
  assert.equal(result.sessionId, 'ses_flat');
  assert.equal(result.inputTokens, 200);
  assert.equal(result.outputTokens, 100);
  assert.equal(result.totalTokens, 300);
});

test('extractOpencodeTelemetryFromExport parses nested under token_usage', () => {
  const json = JSON.stringify({
    session: { id: 'ses_nested' },
    token_usage: {
      input_tokens: 500,
      output_tokens: 250,
    },
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);
  assert.equal(result.sessionId, 'ses_nested');
  assert.equal(result.inputTokens, 500);
  assert.equal(result.outputTokens, 250);
});

test('extractOpencodeTelemetryFromExport parses nested under usage', () => {
  const json = JSON.stringify({
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cached_input_tokens: 30,
    },
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);
  assert.equal(result.inputTokens, 100);
  assert.equal(result.outputTokens, 50);
  assert.equal(result.cachedTokens, 30);
});

test('extractOpencodeTelemetryFromExport parses nested under meta', () => {
  const json = JSON.stringify({
    meta: {
      session_id: 'ses_meta',
      input_tokens: 75,
      output_tokens: 25,
    },
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);
  assert.equal(result.sessionId, 'ses_meta');
  assert.equal(result.inputTokens, 75);
  assert.equal(result.outputTokens, 25);
});

test('extractOpencodeTelemetryFromExport parses nested under metadata', () => {
  const json = JSON.stringify({
    metadata: {
      session_id: 'ses_meta',
      total_token_usage: {
        input_tokens: 300,
        output_tokens: 150,
      },
    },
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);
  assert.equal(result.sessionId, 'ses_meta');
  assert.equal(result.inputTokens, 300);
  assert.equal(result.outputTokens, 150);
});

test('extractOpencodeTelemetryFromExport parses real opencode v2.x export format (info.tokens)', () => {
  const json = JSON.stringify({
    info: {
      id: 'ses_real_v2',
      model: { id: 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit', providerID: 'vllm' },
      tokens: {
        input: 1734800,
        output: 18220,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    messages: [],
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);
  assert.equal(result.sessionId, 'ses_real_v2');
  assert.equal(result.provider, 'opencode');
  assert.equal(result.model, 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit');
  assert.equal(result.inputTokens, 1734800);
  assert.equal(result.outputTokens, 18220);
  assert.equal(result.cachedTokens, 0);
  assert.equal(result.totalTokens, 1753020);
  assert.equal(result.toolCalls, 0);
  assert.equal(result.usagePercent, null);
});

test('extractOpencodeTelemetryFromExport extracts session id from info.id (opencode v2.x)', () => {
  const json = JSON.stringify({
    info: {
      id: 'ses_info_id',
      tokens: { input: 100, output: 50 },
    },
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);
  assert.equal(result.sessionId, 'ses_info_id');
});

test('extractOpencodeTelemetryFromExport extracts model from info.model.id (opencode v2.x)', () => {
  const json = JSON.stringify({
    info: {
      id: 'ses_model',
      model: { id: 'custom-model-name' },
      tokens: { input: 100, output: 50 },
    },
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);
  assert.equal(result.model, 'custom-model-name');
});

test('extractOpencodeTelemetryFromExport counts tool calls in messages[].parts[] (real schema)', () => {
  const json = JSON.stringify({
    info: { id: 'ses_tools', tokens: { input: 100, output: 50 } },
    messages: [
      {
        info: { role: 'assistant' },
        parts: [
          { type: 'text', text: 'hi' },
          { type: 'tool', tool: 'read', callID: 'c1' },
          { type: 'tool', tool: 'edit', callID: 'c2' },
        ],
      },
      {
        info: { role: 'assistant' },
        parts: [
          { type: 'tool', tool: 'bash', callID: 'c3' },
          { type: 'step-finish' },
        ],
      },
    ],
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);
  assert.equal(result.toolCalls, 3);
});

test('extractOpencodeTelemetryFromExport parses the real opencode v2 export fixture', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  // Real opencode v2.0.0 export, session ses_132f470d8ffexge85esdX0nzCs,
  // model cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit, reduced to the parser-relevant
  // fields (see opencode-launcher-telemetry.test.js for the fixture origin note).
  const fixture = path.join(__dirname, 'fixtures', 'opencode-export-v2.json');
  const result = extractOpencodeTelemetryFromExport(fs.readFileSync(fixture, 'utf8'));
  assert.ok(result);
  assert.equal(result.sessionId, 'ses_132f470d8ffexge85esdX0nzCs');
  assert.equal(result.provider, 'opencode');
  assert.equal(result.inputTokens, 2802261);
  assert.equal(result.outputTokens, 23469);
  assert.equal(result.totalTokens, 2825730);
  assert.equal(result.toolCalls, 59, 'real export contains 59 tool parts');
});

test('extractOpencodeTelemetryFromExport returns null for empty string', () => {
  assert.equal(extractOpencodeTelemetryFromExport(''), null);
  assert.equal(extractOpencodeTelemetryFromExport('  '), null);
  assert.equal(extractOpencodeTelemetryFromExport(null), null);
  assert.equal(extractOpencodeTelemetryFromExport(undefined), null);
});

test('extractOpencodeTelemetryFromExport rejects malformed JSON', () => {
  assert.equal(extractOpencodeTelemetryFromExport('not json at all'), null);
  assert.equal(extractOpencodeTelemetryFromExport('{invalid}'), null);
  assert.equal(extractOpencodeTelemetryFromExport('{"key": }'), null);
});

test('extractOpencodeTelemetryFromExport returns null for JSON without token fields', () => {
  const json = JSON.stringify({
    session_id: 'ses_no_tokens',
    prompt: 'Hello',
    response: 'Hi there!',
  });
  assert.equal(extractOpencodeTelemetryFromExport(json), null);
});

test('extractOpencodeTelemetryFromExport returns null for JSON array without tokens', () => {
  const json = JSON.stringify([
    { type: 'message', role: 'user', content: 'Hello' },
    { type: 'message', role: 'assistant', content: 'Hi' },
  ]);
  assert.equal(extractOpencodeTelemetryFromExport(json), null);
});

test('extractOpencodeTelemetryFromExport substitutes 0 for missing cached_tokens', () => {
  const json = JSON.stringify({
    session_id: 'ses_partial',
    total_token_usage: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    },
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);
  assert.equal(result.inputTokens, 100);
  assert.equal(result.outputTokens, 50);
  assert.equal(result.cachedTokens, 0);
  assert.equal(result.totalTokens, 150);
});

test('extractOpencodeTelemetryFromExport derives totalTokens from input+output when not provided', () => {
  const json = JSON.stringify({
    session_id: 'ses_derive',
    total_token_usage: {
      input_tokens: 400,
      output_tokens: 200,
    },
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);
  assert.equal(result.totalTokens, 600);
});

test('extractOpencodeTelemetryFromExport defaults model to qwen when not in JSON', () => {
  const json = JSON.stringify({
    session_id: 'ses_default_model',
    total_token_usage: {
      input_tokens: 100,
      output_tokens: 50,
    },
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);
  assert.equal(result.model, 'qwen');
});

test('extractOpencodeTelemetryFromExport verifies telemetry shape matches telemetryToStatsFields expectations', () => {
  const json = JSON.stringify({
    session_id: 'ses_shape',
    model: 'qwen-plus',
    total_token_usage: {
      input_tokens: 500,
      output_tokens: 250,
      cached_input_tokens: 100,
      total_tokens: 750,
    },
    tool_calls: 5,
  });
  const result = extractOpencodeTelemetryFromExport(json);
  assert.ok(result);

  // Verify all fields expected by telemetryToStatsFields are present
  assert.ok(typeof result.sessionId === 'string' || result.sessionId === null);
  assert.equal(result.provider, 'opencode');
  assert.ok(typeof result.model === 'string');
  assert.ok(typeof result.inputTokens === 'number' && result.inputTokens >= 0);
  assert.ok(typeof result.outputTokens === 'number' && result.outputTokens >= 0);
  assert.ok(typeof result.cachedTokens === 'number' && result.cachedTokens >= 0);
  assert.ok(typeof result.totalTokens === 'number' && result.totalTokens >= 0);
  assert.ok(typeof result.toolCalls === 'number' && result.toolCalls >= 0);
  assert.equal(result.usagePercent, null);

  // Verify totalTokens = inputTokens + outputTokens (when total_tokens not in source)
  const jsonNoTotal = JSON.stringify({
    session_id: 'ses_shape2',
    total_token_usage: {
      input_tokens: 300,
      output_tokens: 150,
    },
  });
  const result2 = extractOpencodeTelemetryFromExport(jsonNoTotal);
  assert.equal(result2.totalTokens, result2.inputTokens + result2.outputTokens);
});

test('extractOpencodeTelemetryFromExport handles non-object JSON (string, number, boolean)', () => {
  assert.equal(extractOpencodeTelemetryFromExport('"just a string"'), null);
  assert.equal(extractOpencodeTelemetryFromExport('42'), null);
  assert.equal(extractOpencodeTelemetryFromExport('true'), null);
  assert.equal(extractOpencodeTelemetryFromExport('[]'), null);
});

test('extractOpencodeTelemetryFromExport handles all-zeros token usage', () => {
  const json = JSON.stringify({
    session_id: 'ses_zeros',
    total_token_usage: {
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
      total_tokens: 0,
    },
  });
  assert.equal(extractOpencodeTelemetryFromExport(json), null);
});

// --- Backward compat: extractOpencodeTelemetry ---

test('extractOpencodeTelemetry returns null for undefined/null/empty result', () => {
  assert.equal(extractOpencodeTelemetry(undefined), null);
  assert.equal(extractOpencodeTelemetry(null), null);
  assert.equal(extractOpencodeTelemetry({}), null);
});

test('extractOpencodeTelemetry parses result.exportJson string', () => {
  const json = JSON.stringify({
    session_id: 'ses_compat',
    total_token_usage: {
      input_tokens: 100,
      output_tokens: 50,
    },
  });
  const result = extractOpencodeTelemetry({ exportJson: json });
  assert.ok(result);
  assert.equal(result.inputTokens, 100);
  assert.equal(result.outputTokens, 50);
});

test('extractOpencodeTelemetry passes through result.telemetry', () => {
  const existing = { sessionId: 'ses_existing', inputTokens: 999 };
  const result = extractOpencodeTelemetry({ telemetry: existing });
  assert.equal(result, existing);
});

test('extractOpencodeTelemetry prefers exportJson over telemetry', () => {
  const json = JSON.stringify({
    session_id: 'ses_export',
    total_token_usage: { input_tokens: 111, output_tokens: 222 },
  });
  const result = extractOpencodeTelemetry({
    exportJson: json,
    telemetry: { sessionId: 'other', inputTokens: 999 },
  });
  assert.equal(result.inputTokens, 111);
});

// --- getOpencodeProviderModel ---

test('getOpencodeProviderModel returns correct fallback identity', () => {
  const pm = getOpencodeProviderModel();
  assert.equal(pm.provider, 'opencode');
  assert.equal(pm.model, 'qwen');
});
