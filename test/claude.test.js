const test = require('node:test');
const assert = require('node:assert/strict');

// ---------- resolveClaudeCommand ----------

test('resolveClaudeCommand returns bare "claude"', () => {
  const { resolveClaudeCommand } = require('../lib/agents/claude');
  assert.equal(resolveClaudeCommand(), 'claude');
});

// ---------- extractClaudeSessionId ----------

test('extractClaudeSessionId matches claude --resume pattern', () => {
  const { extractClaudeSessionId } = require('../lib/agents/claude');
  const id = extractClaudeSessionId('Some text\nclaude --resume abc123-def456\nend');
  assert.equal(id, 'abc123-def456');
});

test('extractClaudeSessionId returns null for no match', () => {
  const { extractClaudeSessionId } = require('../lib/agents/claude');
  assert.equal(extractClaudeSessionId('no session here'), null);
  assert.equal(extractClaudeSessionId(null), null);
  assert.equal(extractClaudeSessionId(''), null);
});

test('extractClaudeSessionId extracts session_id from stream-json result event', () => {
  const { extractClaudeSessionId } = require('../lib/agents/claude');
  const jsonl = '{"type":"result","session_id":"sess-abc123","content":"done"}\n{"type":"ping"}\n';
  assert.equal(extractClaudeSessionId(jsonl), 'sess-abc123');
});

test('extractClaudeSessionId falls back to regex when no stream-json result', () => {
  const { extractClaudeSessionId } = require('../lib/agents/claude');
  const jsonl = '{"type":"tool_use","name":"read_file"}\n{"type":"assistant_text","text":"checking"}\nclaude --resume def789-abc012\n';
  assert.equal(extractClaudeSessionId(jsonl), 'def789-abc012');
});

test('extractClaudeSessionId prefers stream-json result over regex fallback', () => {
  const { extractClaudeSessionId } = require('../lib/agents/claude');
  const jsonl = '{"type":"result","session_id":"sess-preferred"}\nclaude --resume sess-regex\n';
  assert.equal(extractClaudeSessionId(jsonl), 'sess-preferred');
});

// ---------- buildClaudeInvocation ----------

test('buildClaudeInvocation includes --resume when resume and sessionId provided', () => {
  const { buildClaudeInvocation } = require('../lib/agents/claude');
  const inv = buildClaudeInvocation({ prompt: 'test', worktree: '/tmp', resume: true, sessionId: 'abc123' });
  assert.equal(inv.command, 'claude');
  assert.ok(inv.args.includes('--resume'));
  assert.ok(inv.args.includes('abc123'));
});

test('buildClaudeInvocation includes --continue when resume but no sessionId', () => {
  const { buildClaudeInvocation } = require('../lib/agents/claude');
  const inv = buildClaudeInvocation({ prompt: 'test', worktree: '/tmp', resume: true });
  assert.equal(inv.command, 'claude');
  assert.ok(inv.args.includes('--continue'));
  assert.ok(!inv.args.includes('--resume'));
});

test('buildClaudeInvocation omits resume flags when resume is false', () => {
  const { buildClaudeInvocation } = require('../lib/agents/claude');
  const inv = buildClaudeInvocation({ prompt: 'test', worktree: '/tmp', resume: false });
  assert.equal(inv.command, 'claude');
  assert.ok(!inv.args.includes('--resume'));
  assert.ok(!inv.args.includes('--continue'));
});

test('buildClaudeInvocation passes prompt via -p flag', () => {
  const { buildClaudeInvocation } = require('../lib/agents/claude');
  const inv = buildClaudeInvocation({ prompt: 'hello world', worktree: '/tmp' });
  assert.equal(inv.command, 'claude');
  assert.ok(inv.args.includes('-p'));
  assert.ok(inv.args.includes('hello world'));
});

test('buildClaudeInvocation includes --output-format stream-json --verbose --include-partial-messages for streaming progress', () => {
  const { buildClaudeInvocation } = require('../lib/agents/claude');
  const inv = buildClaudeInvocation({ prompt: 'test', worktree: '/tmp' });
  assert.ok(inv.args.includes('--output-format'));
  assert.ok(inv.args.includes('stream-json'));
  assert.ok(inv.args.includes('--verbose'));
  assert.ok(inv.args.includes('--include-partial-messages'));
});

test('buildClaudeInvocation places streaming flags before -p', () => {
  const { buildClaudeInvocation } = require('../lib/agents/claude');
  const inv = buildClaudeInvocation({ prompt: 'test', worktree: '/tmp' });
  const fmtIdx = inv.args.indexOf('--output-format');
  const verboseIdx = inv.args.indexOf('--verbose');
  const partialIdx = inv.args.indexOf('--include-partial-messages');
  const pIdx = inv.args.indexOf('-p');
  assert.ok(fmtIdx !== -1 && verboseIdx !== -1 && partialIdx !== -1 && pIdx !== -1);
  assert.ok(fmtIdx < verboseIdx && verboseIdx < partialIdx && partialIdx < pIdx);
});

test('buildClaudeInvocation sets cwd to worktree', () => {
  const { buildClaudeInvocation } = require('../lib/agents/claude');
  const inv = buildClaudeInvocation({ prompt: 'test', worktree: '/custom/worktree' });
  assert.equal(inv.command, 'claude');
  assert.equal(inv.options.cwd, '/custom/worktree');
});

// ---------- model override ----------

test('buildClaudeInvocation adds --model flag when model is provided', () => {
  const { buildClaudeInvocation } = require('../lib/agents/claude');
  const inv = buildClaudeInvocation({ prompt: 'test', worktree: '/tmp', model: 'sonnet-4-20250514' });
  const i = inv.args.indexOf('--model');
  assert.ok(i !== -1);
  assert.equal(inv.args[i + 1], 'sonnet-4-20250514');
});

test('buildClaudeInvocation omits --model flag when model is null/undefined', () => {
  const { buildClaudeInvocation } = require('../lib/agents/claude');
  assert.ok(!buildClaudeInvocation({ prompt: 't', worktree: '/tmp' }).args.includes('--model'));
  assert.ok(!buildClaudeInvocation({ prompt: 't', worktree: '/tmp', model: null }).args.includes('--model'));
});

// ---------- extractClaudeTelemetryFromStdout (task-1318) ----------

test('extractClaudeTelemetryFromStdout returns null for empty content', () => {
  const { extractClaudeTelemetryFromStdout } = require('../lib/agents/claude-telemetry');
  assert.equal(extractClaudeTelemetryFromStdout(''), null);
  assert.equal(extractClaudeTelemetryFromStdout(null), null);
  assert.equal(extractClaudeTelemetryFromStdout(undefined), null);
});

test('extractClaudeTelemetryFromStdout handles normal multi-turn stream correctly', () => {
  const { extractClaudeTelemetryFromStdout } = require('../lib/agents/claude-telemetry');
  const jsonl = [
    '{"type":"stream_event","event":{"type":"message_start","message":{"usage":{"input_tokens":5000,"cache_read_input_tokens":4000,"cache_creation_input_tokens":0}}}}',
    '{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","name":"read_file"}}}',
    '{"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":300}}}',
    '{"type":"result","session_id":"sess-normal","usage":{"input_tokens":5000,"output_tokens":300,"cache_read_input_tokens":4000}}',
  ].join('\n');
  const tel = extractClaudeTelemetryFromStdout(jsonl);
  assert.ok(tel);
  assert.equal(tel.inputTokens, 5000);
  assert.equal(tel.outputTokens, 300);
  assert.equal(tel.cachedTokens, 4000);
  assert.equal(tel.totalTokens, 5300);
});

test('extractClaudeTelemetryFromStdout falls back to resultUsage when partial events are truncated (zero input/output)', () => {
  const { extractClaudeTelemetryFromStdout } = require('../lib/agents/claude-telemetry');
  // Only a result event survives — no message_start or message_delta
  const jsonl = '{"type":"result","session_id":"sess-truncated","usage":{"input_tokens":6000,"output_tokens":1200,"cache_read_input_tokens":5000}}\n';
  const tel = extractClaudeTelemetryFromStdout(jsonl);
  assert.ok(tel);
  assert.equal(tel.inputTokens, 6000);
  assert.equal(tel.outputTokens, 1200);
  assert.equal(tel.cachedTokens, 5000);
});

test('extractClaudeTelemetryFromStdout preserves a tiny input alongside a large cache read (prompt caching, not an artifact) (task-1318)', () => {
  const { extractClaudeTelemetryFromStdout } = require('../lib/agents/claude-telemetry');
  // Reproduces the real "1 input token" row: input_tokens=1 is the UNCACHED
  // prompt delta; the bulk of the re-sent context (462739) is billed under
  // cache_read_input_tokens. This is legitimate prompt caching, so the parser
  // must keep the values truthful and must NOT overwrite them from resultUsage.
  const jsonl = [
    '{"type":"system","model":"claude-opus-4-8"}',
    '{"type":"stream_event","event":{"type":"message_start","message":{"usage":{"input_tokens":1,"cache_read_input_tokens":462739,"cache_creation_input_tokens":0}}}}',
    '{"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":4010}}}',
    '{"type":"result","session_id":"sess-cache","usage":{"input_tokens":1,"output_tokens":4010,"cache_read_input_tokens":462739}}',
  ].join('\n');
  const tel = extractClaudeTelemetryFromStdout(jsonl);
  assert.ok(tel);
  assert.equal(tel.inputTokens, 1, 'tiny uncached input is preserved, not clobbered');
  assert.equal(tel.outputTokens, 4010);
  assert.equal(tel.cachedTokens, 462739, 'cache reads are recorded honestly');
});

test('extractClaudeTelemetryFromStdout still falls back to resultUsage only when partial events are entirely absent (task-1318)', () => {
  const { extractClaudeTelemetryFromStdout } = require('../lib/agents/claude-telemetry');
  // No message_start/message_delta survived; the genuine truncation fallback to
  // the result event's aggregate usage still applies (this is the ONLY rewrite).
  const jsonl = [
    '{"type":"result","session_id":"sess-trunc","usage":{"input_tokens":6000,"output_tokens":1200,"cache_read_input_tokens":5000}}',
  ].join('\n');
  const tel = extractClaudeTelemetryFromStdout(jsonl);
  assert.ok(tel);
  assert.equal(tel.inputTokens, 6000);
  assert.equal(tel.outputTokens, 1200);
  assert.equal(tel.cachedTokens, 5000);
});

test('extractClaudeTelemetryFromStdout records input/output verbatim for a normal turn (input=15, output=2000) (task-1318)', () => {
  const { extractClaudeTelemetryFromStdout } = require('../lib/agents/claude-telemetry');
  // Parsed token counts are reported as-is — no ratio-based rewriting.
  const jsonl = [
    '{"type":"stream_event","event":{"type":"message_start","message":{"usage":{"input_tokens":15,"cache_read_input_tokens":10,"cache_creation_input_tokens":0}}}}',
    '{"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":2000}}}',
    '{"type":"result","session_id":"sess-plausible","usage":{"input_tokens":15,"output_tokens":2000,"cache_read_input_tokens":10}}',
  ].join('\n');
  const tel = extractClaudeTelemetryFromStdout(jsonl);
  assert.ok(tel);
  assert.equal(tel.inputTokens, 15);
  assert.equal(tel.outputTokens, 2000);
});

test('extractClaudeTelemetryFromStdout records input/output verbatim for a small turn (task-1318)', () => {
  const { extractClaudeTelemetryFromStdout } = require('../lib/agents/claude-telemetry');
  // Small uncached input + small output is recorded as-is.
  const jsonl = [
    '{"type":"stream_event","event":{"type":"message_start","message":{"usage":{"input_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}}',
    '{"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":500}}}',
    '{"type":"result","session_id":"sess-small","usage":{"input_tokens":5,"output_tokens":500,"cache_read_input_tokens":0}}',
  ].join('\n');
  const tel = extractClaudeTelemetryFromStdout(jsonl);
  assert.ok(tel);
  assert.equal(tel.inputTokens, 5);
  assert.equal(tel.outputTokens, 500);
});

test('extractClaudeTelemetryFromStdout handles raw (non-wrapped) stream-json events', () => {
  const { extractClaudeTelemetryFromStdout } = require('../lib/agents/claude-telemetry');
  const jsonl = [
    '{"type":"message_start","message":{"usage":{"input_tokens":3000,"cache_read_input_tokens":2000,"cache_creation_input_tokens":0}}}',
    '{"type":"message_delta","usage":{"output_tokens":500}}',
    '{"type":"result","session_id":"sess-raw","usage":{"input_tokens":3000,"output_tokens":500,"cache_read_input_tokens":2000}}',
  ].join('\n');
  const tel = extractClaudeTelemetryFromStdout(jsonl);
  assert.ok(tel);
  assert.equal(tel.inputTokens, 3000);
  assert.equal(tel.outputTokens, 500);
  assert.equal(tel.cachedTokens, 2000);
});

// ---------- startClaudeAgent stale session detection (task-1322) ----------

test('startClaudeAgent retries without --resume when spawn returns "Session not found"', async () => {
  const claude = require('../lib/agents/claude');
  const mockSessions = { clearSessionCalledWith: null, clearSession(worktree, slug, role) { this.clearSessionCalledWith = { worktree, slug, role }; return true; } };
  let spawnCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    spawnCount++;
    if (spawnCount === 1) {
      return Promise.resolve({ status: 1, signal: null, stdout: '', stderr: 'Error: Session not found', error: null });
    }
    return Promise.resolve({ status: 0, signal: null, stdout: 'claude --resume sess_fresh\n', stderr: '', error: null });
  };
  const mockExport = () => Promise.resolve(null);

  claude.__setSpawnAndTeeForTest(mockSpawn);
  claude.__setSessionsForTest(mockSessions);

  const { invocation, resultPromise } = claude.startClaudeAgent({
    prompt: 'review task', worktree: '/tmp/wt', env: {}, resume: true, sessionId: 'ses_stale', slug: 'task-1322', role: 'reviewer'
  });
  const result = await resultPromise;

  assert.equal(spawnCount, 2, 'must spawn twice: stale session then fresh');
  assert.ok(invocation.args.includes('--resume'), 'original invocation must include --resume');
  assert.equal(mockSessions.clearSessionCalledWith.worktree, '/tmp/wt', 'clearSession must be called with worktree');
  assert.equal(result.status, 0, 'final result must show success');

  claude.__setSpawnAndTeeForTest(null);
  claude.__setSessionsForTest(null);
});

test('startClaudeAgent does NOT retry when resume is false', async () => {
  const claude = require('../lib/agents/claude');
  let spawnCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    spawnCount++;
    return Promise.resolve({ status: 1, signal: null, stdout: '', stderr: 'Session not found', error: null });
  };

  claude.__setSpawnAndTeeForTest(mockSpawn);

  const { resultPromise } = claude.startClaudeAgent({
    prompt: 'test', worktree: '/tmp/wt', env: {}, resume: false, sessionId: null
  });
  const result = await resultPromise;

  assert.equal(spawnCount, 1, 'must NOT retry when resume=false');
  assert.equal(result.status, 1, 'must return the original failure');

  claude.__setSpawnAndTeeForTest(null);
});

test('startClaudeAgent healthy resume still uses --resume flag', async () => {
  const claude = require('../lib/agents/claude');
  let spawnCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    spawnCount++;
    assert.ok(args.includes('--resume'), 'must include --resume flag for healthy resume');
    assert.ok(args.includes('ses_valid'), 'must include the session ID');
    return Promise.resolve({ status: 0, signal: null, stdout: 'claude --resume ses_valid\n', stderr: '', error: null });
  };

  claude.__setSpawnAndTeeForTest(mockSpawn);

  const { invocation, resultPromise } = claude.startClaudeAgent({
    prompt: 'test', worktree: '/tmp/wt', env: {}, resume: true, sessionId: 'ses_valid'
  });
  const result = await resultPromise;

  assert.equal(spawnCount, 1, 'must only spawn once for healthy resume');
  assert.equal(result.status, 0, 'must succeed');

  claude.__setSpawnAndTeeForTest(null);
});
