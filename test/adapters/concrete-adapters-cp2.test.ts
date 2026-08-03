import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { ConcreteReviewReadAdapter } from '../../src/adapters/backlog/concrete-review-read-adapter.js';
import { ConcreteGateReadAdapter } from '../../src/adapters/backlog/concrete-gate-read-adapter.js';
import { ConcreteAgentReadAdapter } from '../../src/adapters/backlog/concrete-agent-read-adapter.js';
import { ConcreteOperationLogReadAdapter } from '../../src/adapters/backlog/concrete-operation-log-read-adapter.js';
import { ConcreteGitReadAdapter } from '../../src/adapters/backlog/concrete-git-read-adapter.js';
import { agentFamily } from '../../src/domain/agents.js';
import { missionId } from '../../src/domain/mission.js';
import { repositoryId } from '../../src/domain/repository.js';
import type { AgentBlocklistRepository } from '../../src/application/ports/agent-blocklist.js';
import type { OperationalHistoryRepository } from '../../src/application/ports/operation-history.js';

// ---------------------------------------------------------------------------
// Mock repositories
// ---------------------------------------------------------------------------

class MockBlocklistRepo implements AgentBlocklistRepository {
  private entries: Array<{ agent: string; blocked: boolean; until?: string; reason?: string }> = [];

  async findAll() { return this.entries as ReadonlyArray<{ agent: string; blocked: boolean; until?: string; reason?: string }>; }
  async findByAgent(_agent: string) { return this.entries.find(e => e.agent === _agent); }
  async save(entry: { agent: string; blocked: boolean; until?: string; reason?: string }) {
    const idx = this.entries.findIndex(e => e.agent === entry.agent);
    if (idx >= 0) this.entries[idx] = entry; else this.entries.push(entry);
  }
  async deleteByAgent(agent: string) { this.entries = this.entries.filter(e => e.agent !== agent); }
  async clear() { this.entries = []; }
}

class MockHistoryRepo implements OperationalHistoryRepository {
  private entries: Array<{ id?: number; eventType: string; eventData: string; createdAt: string }> = [];

  async findAll() { return this.entries as ReadonlyArray<{ id?: number; eventType: string; eventData: string; createdAt: string }>; }
  async findByType(type: string) { return this.entries.filter(e => e.eventType === type); }
  async append(entry: { eventType: string; eventData: string; createdAt: string }) {
    this.entries.push({ id: this.entries.length + 1, ...entry });
  }
  async clear() { this.entries = []; }
}

// ---------------------------------------------------------------------------
// ReviewReadAdapter tests
// ---------------------------------------------------------------------------

test('ReviewReadAdapter loadReview returns null when no review state exists', async () => {
  const adapter = new ConcreteReviewReadAdapter({
    rootDir: '/tmp',
    readReviewState: () => null,
    findMissionDir: () => null,
  });

  const review = await adapter.loadReview(missionId('task-1001'));
  assert.equal(review, null);
});

test('ReviewReadAdapter loadReview returns domain Review from review state', async () => {
  const adapter = new ConcreteReviewReadAdapter({
    rootDir: '/tmp',
    readReviewState: () => ({
      slug: 'task-1001',
      reviewer: 'codex',
      implementer: 'custom',
      round: 2,
      startedAt: '2026-07-20T10:00:00Z',
      phase: 'reviewing',
      disposition: null,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
      metadata: {},
      phaseOriginal: null,
    } as any),
    findMissionDir: () => '/tmp/missions/task-1001',
  });

  const review = await adapter.loadReview(missionId('task-1001'));
  assert.ok(review !== null);
  assert.equal(review!.rounds.length, 1);
  assert.equal(review!.rounds[0].number, 2);
  assert.equal(review!.rounds[0].reviewer, 'codex');
  assert.equal(review!.rounds[0].implementer, 'custom');
});

test('ReviewReadAdapter loadReview returns Review with approved decision', async () => {
  const adapter = new ConcreteReviewReadAdapter({
    rootDir: '/tmp',
    readReviewState: () => ({
      slug: 'task-1001',
      reviewer: 'codex',
      implementer: 'custom',
      round: 1,
      startedAt: '2026-07-20T10:00:00Z',
      phase: 'approved',
      disposition: 'APPROVED',
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
      metadata: {},
      phaseOriginal: null,
    } as any),
    findMissionDir: () => '/tmp/missions/task-1001',
  });

  const review = await adapter.loadReview(missionId('task-1001'));
  assert.ok(review !== null);
  assert.equal(review!.rounds[0].decision?.kind, 'approved');
});

test('ReviewReadAdapter loadReviewApproval returns null for non-approved phase', async () => {
  const adapter = new ConcreteReviewReadAdapter({
    rootDir: '/tmp',
    readReviewState: () => ({
      slug: 'task-1001',
      reviewer: 'codex',
      implementer: 'custom',
      round: 1,
      startedAt: '2026-07-20T10:00:00Z',
      phase: 'reviewing',
      disposition: null,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
      metadata: {},
      phaseOriginal: null,
    } as any),
    findMissionDir: () => '/tmp/missions/task-1001',
  });

  const approval = await adapter.loadReviewApproval(missionId('task-1001'));
  assert.equal(approval, null);
});

test('ReviewReadAdapter loadReviewApproval returns approval data for approved phase', async () => {
  const adapter = new ConcreteReviewReadAdapter({
    rootDir: '/tmp',
    readReviewState: () => ({
      slug: 'task-1001',
      reviewer: 'codex',
      implementer: 'custom',
      round: 1,
      startedAt: '2026-07-20T10:00:00Z',
      phase: 'approved',
      disposition: 'APPROVED',
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
      metadata: {},
      phaseOriginal: null,
    } as any),
    findMissionDir: () => '/tmp/missions/task-1001',
  });

  const approval = await adapter.loadReviewApproval(missionId('task-1001'));
  assert.ok(approval !== null);
  assert.ok(approval!.approvedAt);
});

test('ReviewReadAdapter loadReview returns null when no mission dir exists', async () => {
  const adapter = new ConcreteReviewReadAdapter({
    rootDir: '/tmp',
    readReviewState: () => null,
    findMissionDir: () => null,
  });

  const review = await adapter.loadReview(missionId('task-9999'));
  assert.equal(review, null);
});

// ---------------------------------------------------------------------------
// GateReadAdapter tests
// ---------------------------------------------------------------------------

test('GateReadAdapter loadGateStatus returns unknown when no mission dir', async () => {
  const adapter = new ConcreteGateReadAdapter({
    rootDir: '/tmp',
    findMissionDir: () => null,
  });

  const status = await adapter.loadGateStatus(missionId('task-9999'));
  assert.equal(status, 'unknown');
});

test('GateReadAdapter loadGateStatus returns unknown when no gate file exists', async () => {
  const adapter = new ConcreteGateReadAdapter({
    rootDir: '/tmp',
    findMissionDir: () => '/tmp/missions/task-1001',
    readGateFile: () => null,
  });

  const status = await adapter.loadGateStatus(missionId('task-1001'));
  assert.equal(status, 'unknown');
});

test('GateReadAdapter loadGateStatus returns passed from gate content', async () => {
  const adapter = new ConcreteGateReadAdapter({
    rootDir: '/tmp',
    findMissionDir: () => '/tmp/missions/task-1001',
    readGateFile: () => JSON.stringify({ status: 'passed' }),
  });

  const status = await adapter.loadGateStatus(missionId('task-1001'));
  assert.equal(status, 'passed');
});

test('GateReadAdapter loadGateStatus returns failed from gate content', async () => {
  const adapter = new ConcreteGateReadAdapter({
    rootDir: '/tmp',
    findMissionDir: () => '/tmp/missions/task-1001',
    readGateFile: () => 'FAILED: lint errors',
  });

  const status = await adapter.loadGateStatus(missionId('task-1001'));
  assert.equal(status, 'failed');
});

test('GateReadAdapter loadGateStatus returns running from gate content', async () => {
  const adapter = new ConcreteGateReadAdapter({
    rootDir: '/tmp',
    findMissionDir: () => '/tmp/missions/task-1001',
    readGateFile: () => 'in-progress',
  });

  const status = await adapter.loadGateStatus(missionId('task-1001'));
  assert.equal(status, 'running');
});

// ---------------------------------------------------------------------------
// AgentReadAdapter tests
// ---------------------------------------------------------------------------

test('AgentReadAdapter loadAgentAvailability returns availability from blocklist snapshot', async () => {
  const blocklist = new MockBlocklistRepo();
  await blocklist.save({ agent: 'codex', blocked: false });
  await blocklist.save({ agent: 'claude', blocked: true, reason: 'rate-limited' });

  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/tmp',
    blocklistRepo: blocklist,
    knownAgentFamilies: [agentFamily('codex'), agentFamily('claude')],
    resolveTaskFile: () => ({ ok: false, matches: [] }),
  });

  const availability = await adapter.loadAgentAvailability();
  assert.equal(availability.length, 2);

  const codex = availability.find(a => a.family === 'codex');
  assert.ok(codex);
  assert.equal(codex!.block.kind, 'none');
  assert.equal(codex!.launcherAvailable, true);

  const claude = availability.find(a => a.family === 'claude');
  assert.ok(claude);
  assert.equal(claude!.block.kind, 'indefinite');
  assert.equal(claude!.block.reason, 'rate-limited');
});

test('AgentReadAdapter loadAgentAvailability handles timed blocks', async () => {
  const blocklist = new MockBlocklistRepo();
  const futureTime = new Date(Date.now() + 3600000).toISOString();
  await blocklist.save({ agent: 'gemini', blocked: true, until: futureTime, reason: 'cooldown' });

  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/tmp',
    blocklistRepo: blocklist,
    knownAgentFamilies: [agentFamily('gemini')],
    resolveTaskFile: () => ({ ok: false, matches: [] }),
  });

  const availability = await adapter.loadAgentAvailability();
  assert.equal(availability.length, 1);
  assert.equal(availability[0].block.kind, 'until');
  assert.ok(availability[0].block.untilMs > Date.now());
});

test('AgentReadAdapter loadAssignedAgent returns agent from task file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-agent-test-'));
  try {
    const taskFile = path.join(tmpDir, 'task-1001.md');
    fs.writeFileSync(taskFile, '---\nid: TASK-1001\nassignee: [codex]\n---\n', 'utf8');

    const adapter = new ConcreteAgentReadAdapter({
      rootDir: tmpDir,
      blocklistRepo: new MockBlocklistRepo(),
      knownAgentFamilies: [agentFamily('codex')],
      resolveTaskFile: () => ({ ok: true, taskFile, matches: [taskFile] }),
      getTaskAssignee: (f) => {
        if (f === taskFile) return 'codex';
        return null;
      },
    });

    const assigned = await adapter.loadAssignedAgent(missionId('task-1001'));
    assert.equal(assigned, 'codex');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AgentReadAdapter loadAssignedAgent returns null for missing task', async () => {
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/tmp',
    blocklistRepo: new MockBlocklistRepo(),
    knownAgentFamilies: [agentFamily('codex')],
    resolveTaskFile: () => ({ ok: false, matches: [] }),
  });

  const assigned = await adapter.loadAssignedAgent(missionId('task-9999'));
  assert.equal(assigned, null);
});

test('AgentReadAdapter loadAgentAvailability returns empty blocklist as all available', async () => {
  const blocklist = new MockBlocklistRepo();

  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/tmp',
    blocklistRepo: blocklist,
    knownAgentFamilies: [agentFamily('codex'), agentFamily('claude'), agentFamily('gemini')],
    resolveTaskFile: () => ({ ok: false, matches: [] }),
  });

  const availability = await adapter.loadAgentAvailability();
  assert.equal(availability.length, 3);
  for (const agent of availability) {
    assert.equal(agent.block.kind, 'none');
    assert.equal(agent.launcherAvailable, true);
  }
});

// ---------------------------------------------------------------------------
// OperationLogReadAdapter tests
// ---------------------------------------------------------------------------

test('OperationLogReadAdapter loadOperationLog returns entries from SQLite snapshot', async () => {
  const history = new MockHistoryRepo();
  await history.append({
    eventType: 'migration-applied',
    eventData: JSON.stringify({ message: 'Applied migration 0001', agent: 'system' }),
    createdAt: '2026-07-20T10:00:00Z',
  });
  await history.append({
    eventType: 'import-completed',
    eventData: JSON.stringify({ message: 'Imported 5 records' }),
    createdAt: '2026-07-20T11:00:00Z',
  });

  const adapter = new ConcreteOperationLogReadAdapter({ historyRepo: history });
  const log = await adapter.loadOperationLog();

  assert.equal(log.length, 2);
  assert.equal(log[0].phase, 'migration-applied');
  assert.equal(log[0].message, 'Applied migration 0001');
  assert.equal(log[0].agent, 'system');
  assert.equal(log[1].phase, 'import-completed');
  assert.equal(log[1].message, 'Imported 5 records');
});

test('OperationLogReadAdapter loadOperationLog returns empty array for empty history', async () => {
  const history = new MockHistoryRepo();
  const adapter = new ConcreteOperationLogReadAdapter({ historyRepo: history });
  const log = await adapter.loadOperationLog();
  assert.equal(log.length, 0);
});

test('OperationLogReadAdapter loadOperationLog handles non-JSON eventData', async () => {
  const history = new MockHistoryRepo();
  await history.append({
    eventType: 'adapter-initialized',
    eventData: 'plain text data',
    createdAt: '2026-07-20T10:00:00Z',
  });

  const adapter = new ConcreteOperationLogReadAdapter({ historyRepo: history });
  const log = await adapter.loadOperationLog();

  assert.equal(log.length, 1);
  assert.equal(log[0].phase, 'adapter-initialized');
  assert.ok(log[0].message.includes('adapter-initialized'));
});

// ---------------------------------------------------------------------------
// GitReadAdapter tests
// ---------------------------------------------------------------------------

test('GitReadAdapter loadRepositoryId returns configured repository id', async () => {
  const adapter = new ConcreteGitReadAdapter({
    rootDir: '/tmp/repo',
    repositoryId: repositoryId('my-repo'),
    gitRunner: () => ({ status: 1, stdout: '', stderr: 'error' }),
  });

  const id = await adapter.loadRepositoryId();
  assert.equal(id, 'my-repo');
});

test('GitReadAdapter loadRepositoryId extracts name from git remote URL', async () => {
  const adapter = new ConcreteGitReadAdapter({
    rootDir: '/tmp/repo',
    gitRunner: (args) => {
      if (args.includes('remote.origin.url')) {
        return { status: 0, stdout: 'git@github.com:user/parallix.git', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'not found' };
    },
  });

  const id = await adapter.loadRepositoryId();
  assert.equal(id, 'parallix');
});

test('GitReadAdapter loadRepositoryId falls back to directory name', async () => {
  const adapter = new ConcreteGitReadAdapter({
    rootDir: '/tmp/my-project',
    gitRunner: () => ({ status: 1, stdout: '', stderr: 'no remote' }),
  });

  const id = await adapter.loadRepositoryId();
  assert.equal(id, 'my-project');
});

test('GitReadAdapter loadHeadCommit returns HEAD sha', async () => {
  const adapter = new ConcreteGitReadAdapter({
    rootDir: '/tmp/repo',
    gitRunner: (args) => {
      if (args.includes('rev-parse') && args.includes('HEAD')) {
        return { status: 0, stdout: 'abc123def456\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'error' };
    },
  });

  const sha = await adapter.loadHeadCommit();
  assert.equal(sha, 'abc123def456');
});

test('GitReadAdapter loadHeadCommit returns empty string on git error', async () => {
  const adapter = new ConcreteGitReadAdapter({
    rootDir: '/tmp/repo',
    gitRunner: () => ({ status: 1, stdout: '', stderr: 'not a git repo' }),
  });

  const sha = await adapter.loadHeadCommit();
  assert.equal(sha, '');
});

test('GateReadAdapter handles missing gate artifacts gracefully (R2)', async () => {
  const adapter = new ConcreteGateReadAdapter({
    rootDir: '/tmp',
    findMissionDir: () => null,
  });

  const status = await adapter.loadGateStatus(missionId('task-new'));
  assert.equal(status, 'unknown');
});
