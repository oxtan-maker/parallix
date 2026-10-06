import test from 'node:test';
import assert from 'node:assert/strict';
import { agentRunId, agentRunIdentity, isAgentRunId, parseAgentRunId, runToken } from '../../../src/domain/agent-run.js';

const base = { repositoryKey: 'a1b2c3d4e5f6', missionId: 'task-2643', role: 'execute', family: 'claude', attempt: 1, startedAtMs: 1_790_000_000_000 };

test('run id names role, family and attempt and round-trips (TASK-2643)', () => {
  const identity = agentRunIdentity(base);
  const id = agentRunId(identity);
  assert.match(id, /^execute-claude-a1-[a-z0-9]+$/);
  assert.deepEqual(parseAgentRunId(id), { role: 'execute', family: 'claude', attempt: 1 });
  assert.equal(isAgentRunId(id), true);
});

test('fallback families, attempts and relaunches never share a run id (TASK-2643)', () => {
  const ids = new Set([
    agentRunId(agentRunIdentity(base)),
    agentRunId(agentRunIdentity({ ...base, family: 'codex', attempt: 2 })),
    agentRunId(agentRunIdentity({ ...base, role: 'review' })),
    agentRunId(agentRunIdentity({ ...base, startedAtMs: base.startedAtMs + 1 })),
  ]);
  assert.equal(ids.size, 4);
});

test('identity tokens refuse path traversal and separator collisions (TASK-2643)', () => {
  assert.throws(() => runToken('', 'role'), /Invalid agent-run role/);
  assert.equal(runToken('../x', 'mission'), 'x');
  assert.equal(isAgentRunId('../execute-claude-a1-abc'), false);
  assert.equal(isAgentRunId('execute-claude-a1-abc/../../other'), false);
  const hyphenated = agentRunIdentity({ ...base, role: 'act-on-review', family: 'custom-pi' });
  assert.deepEqual(parseAgentRunId(agentRunId(hyphenated)), { role: 'act_on_review', family: 'custom_pi', attempt: 1 });
  assert.throws(() => agentRunIdentity({ ...base, attempt: 0 }), /attempt/);
});
