'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseCodexRollout,
  collectRolloutFiles,
  extractCodexTelemetry,
  codexSessionsDir,
} = require('../lib/agents/codex-telemetry');

// Minimal but schema-faithful rollout JSONL, modelled on the real Codex
// `~/.codex/sessions/.../rollout-*.jsonl` format (task-1251). Tests are fully
// offline — no agent is launched, so no tokens are consumed.
function rolloutLines({ sessionId, model = 'gpt-5.4-mini', effort = 'medium', toolCalls = 0, usagePercent = 12, tokenCounts = [] }) {
  const lines = [];
  lines.push(JSON.stringify({ type: 'session_meta', payload: { id: sessionId, model_provider: 'openai' } }));
  lines.push(JSON.stringify({ type: 'turn_context', payload: { model, effort } }));
  for (let i = 0; i < toolCalls; i += 1) {
    lines.push(JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell' } }));
  }
  lines.push(JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant' } }));
  // token_count events: total_token_usage is cumulative; the last one wins.
  for (const tc of tokenCounts) {
    lines.push(JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: tc.input, cached_input_tokens: tc.cached || 0,
            output_tokens: tc.output, reasoning_output_tokens: tc.reasoning || 0,
            total_tokens: tc.total,
          },
          model_context_window: 258400,
        },
        rate_limits: { primary: { used_percent: usagePercent } },
      },
    }));
  }
  return lines.join('\n') + '\n';
}

test('parseCodexRollout extracts model, effort, summed-at-last tokens, tool calls, usage%', () => {
  const content = rolloutLines({
    sessionId: 'aaaa', toolCalls: 3, usagePercent: 42,
    tokenCounts: [
      { input: 1000, output: 50, cached: 900, total: 1050 },
      { input: 2000, output: 120, cached: 1800, reasoning: 30, total: 2120 },
    ],
  });
  const t = parseCodexRollout(content);
  assert.equal(t.sessionId, 'aaaa');
  assert.equal(t.provider, 'openai');
  assert.equal(t.model, 'gpt-5.4-mini');
  assert.equal(t.effort, 'medium');
  // last token_count wins (cumulative total within a session)
  assert.equal(t.inputTokens, 2000);
  assert.equal(t.outputTokens, 120);
  assert.equal(t.cachedTokens, 1800);
  assert.equal(t.totalTokens, 2120);
  assert.equal(t.toolCalls, 3);
  assert.equal(t.usagePercent, 42);
});

test('parseCodexRollout returns honest nulls/zeros for a failed turn (info null)', () => {
  const content = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'bbbb', model_provider: 'openai' } }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4-mini' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { primary: null } } }),
  ].join('\n');
  const t = parseCodexRollout(content);
  assert.equal(t.inputTokens, 0);
  assert.equal(t.totalTokens, 0);
  assert.equal(t.toolCalls, 0);
  assert.equal(t.usagePercent, null);
});

test('parseCodexRollout returns null for empty/garbage content', () => {
  assert.equal(parseCodexRollout(''), null);
  assert.equal(parseCodexRollout('not json\nstill not json'), null);
});

test('extractCodexTelemetry SUMS total_token_usage across multiple rollouts (resumed rounds)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
  const sdir = path.join(codexSessionsDir(home), '2026', '06', '07');
  fs.mkdirSync(sdir, { recursive: true });

  // Round 1: fresh-counter rollout (e.g. draft or review round 1).
  const f1 = path.join(sdir, 'rollout-2026-06-07T10-00-00-r1.jsonl');
  fs.writeFileSync(f1, rolloutLines({ sessionId: 'r1', toolCalls: 2, tokenCounts: [{ input: 1000, output: 100, total: 1100 }] }));
  // Round 2: a NEW file with its own fresh total (codex exec resume behaviour).
  const f2 = path.join(sdir, 'rollout-2026-06-07T11-00-00-r2.jsonl');
  fs.writeFileSync(f2, rolloutLines({ sessionId: 'r2', model: 'gpt-5.5', toolCalls: 5, usagePercent: 56, tokenCounts: [{ input: 3000, output: 300, total: 3300 }] }));
  // Ensure deterministic mtime ordering (f2 newest).
  const base = Date.now();
  fs.utimesSync(f1, new Date(base - 60000), new Date(base - 60000));
  fs.utimesSync(f2, new Date(base), new Date(base));

  const t = extractCodexTelemetry(home, { sinceMs: 0 });
  assert.equal(t.rolloutCount, 2);
  // tokens summed across both rounds
  assert.equal(t.inputTokens, 4000);
  assert.equal(t.outputTokens, 400);
  assert.equal(t.totalTokens, 4400);
  assert.equal(t.toolCalls, 7);
  // model / usage% taken from the newest rollout
  assert.equal(t.model, 'gpt-5.5');
  assert.equal(t.usagePercent, 56);
});

test('extractCodexTelemetry sinceMs window excludes older rollouts (stage attribution)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
  const sdir = path.join(codexSessionsDir(home), '2026', '06', '07');
  fs.mkdirSync(sdir, { recursive: true });

  const draft = path.join(sdir, 'rollout-draft.jsonl');
  fs.writeFileSync(draft, rolloutLines({ sessionId: 'd', tokenCounts: [{ input: 9999, output: 9, total: 10008 }] }));
  const active = path.join(sdir, 'rollout-active.jsonl');
  fs.writeFileSync(active, rolloutLines({ sessionId: 'a', tokenCounts: [{ input: 500, output: 5, total: 505 }] }));

  const base = Date.now();
  fs.utimesSync(draft, new Date(base - 120000), new Date(base - 120000)); // 2 min ago
  fs.utimesSync(active, new Date(base), new Date(base));

  // Window starting after the draft rollout must only see the active rollout.
  const t = extractCodexTelemetry(home, { sinceMs: base - 60000 });
  assert.equal(t.rolloutCount, 1);
  assert.equal(t.totalTokens, 505);
});

test('extractCodexTelemetry returns null when no rollouts exist', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-empty-'));
  assert.equal(extractCodexTelemetry(home, { sinceMs: 0 }), null);
  assert.deepEqual(collectRolloutFiles(codexSessionsDir(home), { sinceMs: 0 }), []);
});
