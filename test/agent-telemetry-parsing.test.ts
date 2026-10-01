// Agent telemetry parsing contract: Codex rollout JSONL and Vibe session meta extraction.
//
// Behavior-owned suite (TASK-2622.11). Legacy case names are unchanged; each section keeps its
// historical task provenance.
//   Codex rollout telemetry: task-1251
//   Vibe telemetry: task-1288

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCodexRollout, collectRolloutFiles, extractCodexTelemetry, codexSessionsDir } from '../src/adapters/agents/codex-telemetry.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';
import { parseVibeMeta, extractVibeTelemetry, getVibeProviderModel } from '../src/adapters/agents/vibe-telemetry.js';

describe('Codex rollout telemetry (task-1251)', () => {
  'use strict';

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

  test('parseCodexRollout counts current custom_tool_call response items', () => {
    const content = [
      JSON.stringify({ type: 'session_meta', payload: { id: 'custom-call', model_provider: 'openai' } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-luna' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } } }),
    ].join('\n');

    assert.equal(parseCodexRollout(content).toolCalls, 2);
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
    const home = registeredMkdtemp('codex-home-');
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
    const home = registeredMkdtemp('codex-home-');
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
    const home = registeredMkdtemp('codex-home-empty-');
    assert.equal(extractCodexTelemetry(home, { sinceMs: 0 }), null);
    assert.deepEqual(collectRolloutFiles(codexSessionsDir(home), { sinceMs: 0 }), []);
  });
});

describe('Vibe telemetry (task-1288)', () => {
  // ---------- parseVibeMeta ----------

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

  test('parseVibeMeta extracts telemetry from meta.json stats', () => {
    const t = parseVibeMeta(SAMPLE_META);
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

  test('parseVibeMeta returns null for missing stats block', () => {
    assert.equal(parseVibeMeta({}), null);
    assert.equal(parseVibeMeta({ session_id: 'x' }), null);
  });

  test('parseVibeMeta returns null for empty/garbage input', () => {
    assert.equal(parseVibeMeta(null), null);
    assert.equal(parseVibeMeta(undefined), null);
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    assert.equal(parseVibeMeta('not json'), null);
  });

  test('parseVibeMeta returns null for all-zero stats (no usable signal)', () => {
    assert.equal(parseVibeMeta(EMPTY_STATS_META), null);
  });

  test('parseVibeMeta coerces string-like numbers gracefully', () => {
    const meta = {
      stats: {
        session_prompt_tokens: '1000',
        session_completion_tokens: '200',
        session_total_llm_tokens: '1200',
      },
    };
    const t = parseVibeMeta(meta);
    assert.ok(t);
    assert.equal(t.inputTokens, 1000);
    assert.equal(t.outputTokens, 200);
    assert.equal(t.totalTokens, 1200);
  });

  // ---------- extractVibeTelemetry ----------

  test('extractVibeTelemetry returns null for empty session directory', () => {
    const tmp = registeredMkdtemp('vibe-empty-');
    try {
      assert.equal(extractVibeTelemetry(null, tmp), null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('extractVibeTelemetry returns null when no sessions exist', () => {
    const tmp = registeredMkdtemp('vibe-nosess-');
    try {
      assert.equal(extractVibeTelemetry(null, tmp), null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('extractVibeTelemetry parses the most recent session meta.json', () => {
    const tmp = registeredMkdtemp('vibe-fix-');
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

      const result = extractVibeTelemetry(null, tmp);
      assert.ok(result);
      assert.equal(result.inputTokens, 9331);
      assert.equal(result.outputTokens, 62);
      assert.equal(result.totalTokens, 9393);
      assert.equal(result.path, path.join(newDir, 'meta.json'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('extractVibeTelemetry skips sessions without meta.json', () => {
    const tmp = registeredMkdtemp('vibe-nometa-');
    try {
      const dir = path.join(tmp, 'session_20260701_171711_ccdddddd');
      fs.mkdirSync(dir, { recursive: true });
      // Only write messages.jsonl, no meta.json.
      fs.writeFileSync(path.join(dir, 'messages.jsonl'), '');

      assert.equal(extractVibeTelemetry(null, tmp), null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('extractVibeTelemetry skips corrupt meta.json', () => {
    const tmp = registeredMkdtemp('vibe-corrupt-');
    try {
      const dir = path.join(tmp, 'session_20260701_171711_eefffff');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'meta.json'), 'not valid json{{{');

      assert.equal(extractVibeTelemetry(null, tmp), null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('extractVibeTelemetry skips session with all-zero stats', () => {
    const tmp = registeredMkdtemp('vibe-zero-');
    try {
      const dir = path.join(tmp, 'session_20260701_171711_gggggggg');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(EMPTY_STATS_META));

      // All-zero stats should be skipped (no usable signal).
      assert.equal(extractVibeTelemetry(null, tmp), null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('extractVibeTelemetry picks valid session when newer one has zero stats', () => {
    const tmp = registeredMkdtemp('vibe-zeronew-');
    try {
      const oldDir = path.join(tmp, 'session_20260601_100000_hhhhhhhh');
      const newDir = path.join(tmp, 'session_20260701_171711_iiiiiiii');
      fs.mkdirSync(oldDir, { recursive: true });
      fs.mkdirSync(newDir, { recursive: true });

      fs.writeFileSync(path.join(oldDir, 'meta.json'), JSON.stringify(SAMPLE_META));
      fs.writeFileSync(path.join(newDir, 'meta.json'), JSON.stringify(EMPTY_STATS_META));

      const result = extractVibeTelemetry(null, tmp);
      // Should fall back to the older session which has real stats.
      assert.ok(result);
      assert.equal(result.inputTokens, 9331);
      assert.equal(result.path, path.join(oldDir, 'meta.json'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ---------- getVibeProviderModel ----------

  test('getVibeProviderModel returns correct fallback identity', () => {
    const pm = getVibeProviderModel();
    assert.equal(pm.provider, 'mistral');
    assert.equal(pm.model, 'mistral');
  });
});
