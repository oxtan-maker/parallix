import test from 'node:test';
import assert from 'node:assert/strict';
import { agentRunId, agentRunIdentity, isAgentRunId, parseAgentRunId, runToken } from '../../../src/domain/agent-run.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { repositoryId } from '../../../src/domain/repository.js';

const base = { repositoryId: 'a1b2c3d4e5f6', missionId: 'task-2643', role: 'execute', family: 'claude', attempt: 1, startedAtMs: 1_790_000_000_000 };

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
  assert.equal(runToken('../x', 'role'), 'x');
  assert.equal(isAgentRunId('../execute-claude-a1-abc'), false);
  assert.equal(isAgentRunId('execute-claude-a1-abc/../../other'), false);
  const hyphenated = agentRunIdentity({ ...base, role: 'act-on-review', family: 'custom-pi' });
  assert.deepEqual(parseAgentRunId(agentRunId(hyphenated)), { role: 'act_on_review', family: 'custom-pi', attempt: 1 });
  assert.throws(() => agentRunIdentity({ ...base, attempt: 0 }), /attempt/);
});

test('agent invocation scope keeps canonical Mission IDs lossless, dots and hyphens included (TASK-2749)', () => {
  for (const missionId of ['task-2622.18', 'task-2622-18', 'px-0042', 'adhoc-a.b-c']) {
    const run = agentRunIdentity({ ...base, missionId });
    assert.equal(run.missionId, missionId, 'the run carries the canonical id unchanged');
    assert.equal(run.repositoryId, base.repositoryId);
    assert.equal('repositoryKey' in run, false, 'native storage keys stay out of logical invocation identity');
  }
  const keys = ['task-2622.18', 'task-2622-18', 'task-262218'].flatMap(missionId => ['repoa', 'repob'].map(repositoryId => {
    const run = agentRunIdentity({ ...base, repositoryId, missionId });
    return JSON.stringify([run.repositoryId, run.missionId]);
  }));
  assert.equal(new Set(keys).size, 6);
  assert.equal(agentRunIdentity({ ...base, repositoryId: 'Repository A / logical' }).repositoryId, repositoryId('Repository A / logical'), 'repository domain validation is independent of native path encoding');
});

test('agent invocation scope rejects aliases and invalid ids instead of rewriting them (TASK-2749)', () => {
  for (const missionId of ['TASK-2622.18', 'task-2622_18', 'task-1:2', '../task-1', 'task-1.', '']) {
    assert.throws(() => agentRunIdentity({ ...base, missionId }), /Invalid mission slug/);
  }
  assert.throws(() => agentRunIdentity({ ...base, repositoryId: '' }), /Repository id must not be empty/);
});


test('agent invocation uses canonical AgentFamily while retaining legacy run-id encoding (TASK-2749)', () => {
  const identity = agentRunIdentity({ ...base, family: 'custom-pi' });
  assert.equal(identity.family, agentFamily('custom-pi'));
  const oldId = `execute-custom_pi-a1-${base.startedAtMs.toString(36)}`;
  assert.equal(agentRunId(identity), oldId, 'existing directory and terminal window ids remain stable');
  assert.equal(parseAgentRunId(oldId)!.family, agentFamily('custom-pi'));
  for (const family of ['custom_pi', 'CODEX', '../codex', 'custom pi', '1codex', '']) {
    assert.throws(() => agentRunIdentity({ ...base, family }), /Invalid agent family/);
  }
});
