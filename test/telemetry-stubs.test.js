'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractOpencodeTelemetry, getOpencodeProviderModel } = require('../lib/agents/opencode-telemetry');
const { extractMistralTelemetry, getMistralProviderModel } = require('../lib/agents/mistral-telemetry');

// Opencode telemetry stub tests (task-1285)

test('extractOpencodeTelemetry returns null for undefined result', () => {
  assert.equal(extractOpencodeTelemetry(undefined), null);
  assert.equal(extractOpencodeTelemetry(null), null);
  assert.equal(extractOpencodeTelemetry({}), null);
});

test('extractOpencodeTelemetry passes through result.telemetry when present', () => {
  // Opencode now has a real parser; when result.telemetry already exists
  // (e.g. from launcher integration), we pass it through.
  const existing = { sessionId: 'ses_x', inputTokens: 100 };
  assert.deepEqual(extractOpencodeTelemetry({ telemetry: existing }), existing);
});

test('getOpencodeProviderModel returns correct fallback identity', () => {
  const pm = getOpencodeProviderModel();
  assert.equal(pm.provider, 'opencode');
  assert.equal(pm.model, 'custom');
});

// Mistral telemetry stub tests (task-1285)

test('extractMistralTelemetry returns null for undefined result', () => {
  assert.equal(extractMistralTelemetry(undefined), null);
  assert.equal(extractMistralTelemetry(null), null);
  assert.equal(extractMistralTelemetry({}), null);
});

test('extractMistralTelemetry returns null even with telemetry field present', () => {
  // Mistral/vibe has no parser — honest zeros for tokens.
  assert.equal(extractMistralTelemetry({ telemetry: { inputTokens: 500 } }), null);
});

test('getMistralProviderModel returns correct fallback identity', () => {
  const pm = getMistralProviderModel();
  assert.equal(pm.provider, 'mistral');
  assert.equal(pm.model, 'mistral');
});
