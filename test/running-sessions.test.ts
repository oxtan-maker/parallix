import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../src/domain/agents.js';
import type { MissionId } from '../src/domain/mission.js';
import { detectRunningMissionSessions, parsePxInvocation } from '../src/adapters/agents/running-sessions.js';
import { ConcreteAgentReadAdapter } from '../src/adapters/backlog/concrete-agent-read-adapter.js';
import type { AgentBlockEntry, AgentBlocklistRepository } from '../src/application/ports/agent-blocklist.js';
import type { SessionMarkerEntry, SessionMarkerRepository } from '../src/application/ports/mission-store.js';

// ---------------------------------------------------------------------------
// Running-session detection. Nothing durable records that an agent is running,
// so liveness comes from a live `px` process in a mission worktree — and must
// report unknown, never zero, when it cannot be observed.
// ---------------------------------------------------------------------------

const NOW_MS = Date.parse('2026-08-08T12:00:00Z');
const WORKTREES = new Map<string, MissionId>([
  ['/home/dev/parallix-task-2328', 'task-2328' as MissionId],
  ['/home/dev/parallix-task-2340', 'task-2340' as MissionId],
]);

// A real `ps -eo pid=,args=` line for a running review loop, plus its child.
const REVIEW_PARENT = 'node /home/dev/parallix-task-2328/node_modules/.bin/tsx src/entry/px.ts review --continue --max-attempts 8';
const REVIEW_CHILD = '/usr/bin/node --import file:///home/dev/parallix-task-2328/node_modules/tsx/dist/loader.mjs src/entry/px.ts review --continue';
const BOARD = 'node /home/dev/parallix/node_modules/.bin/tsx src/entry/px.ts board';
// A same-named draft launched from an unrelated checkout: same slug, other repo.
const DRAFT_IN_OTHER_REPO = 'node /home/other/parallix/node_modules/.bin/tsx src/entry/px.ts draft task-2328 --agent custom';
// `px draft` is launched from the main repository, before the mission worktree exists.
const DRAFT_FROM_MAIN = 'node /home/dev/parallix/node_modules/.bin/tsx src/entry/px.ts draft task-2217 --agent custom';

class EmptyBlocklistRepo implements AgentBlocklistRepository {
  async findAll(): Promise<readonly AgentBlockEntry[]> { return []; }
  async findByAgent(): Promise<AgentBlockEntry | undefined> { return undefined; }
  async save(): Promise<void> { /* unused */ }
  async deleteByAgent(): Promise<void> { /* unused */ }
  async clear(): Promise<void> { /* unused */ }
}

class StubSessionMarkers implements SessionMarkerRepository {
  constructor(private readonly entries: readonly SessionMarkerEntry[]) {}
  async findByMissionAndRole(): Promise<SessionMarkerEntry | undefined> { return undefined; }
  async save(): Promise<void> { /* unused */ }
  async deleteByMissionAndRole(): Promise<void> { /* unused */ }
  async findAll(): Promise<readonly SessionMarkerEntry[]> { return this.entries; }
  async clear(): Promise<void> { /* unused */ }
}

function marker(missionId: string, role: 'execute' | 'review' | 'draft', agent: string): SessionMarkerEntry {
  return {
    repositoryId: 'parallix' as SessionMarkerEntry['repositoryId'],
    missionId: missionId as MissionId,
    role,
    agent: agentFamily(agent),
    lastLaunched: '2026-08-08T06:58:19.322Z',
    sessionId: null,
    updatedAt: '2026-08-08T06:58:19Z',
  };
}

test('parsePxInvocation reads subcommand, mission slug, and pinned family', () => {
  assert.deepEqual(parsePxInvocation(REVIEW_PARENT), { subcommand: 'review', missionId: null, pinnedAgent: null });
  assert.deepEqual(parsePxInvocation(DRAFT_FROM_MAIN), { subcommand: 'draft', missionId: 'task-2217', pinnedAgent: 'custom' });
  assert.deepEqual(parsePxInvocation(BOARD), { subcommand: 'board', missionId: null, pinnedAgent: null });
  assert.equal(parsePxInvocation('/usr/bin/node server.js review'), null);
});

test('detectRunningMissionSessions identifies a draft launched from the main repository', () => {
  const sessions = detectRunningMissionSessions({
    rootDir: '/home/dev/parallix',
    now: () => NOW_MS,
    listWorktrees: () => WORKTREES,
    listProcesses: () => [{ pid: 100, elapsedSeconds: 30, args: DRAFT_FROM_MAIN }],
    // `px draft` runs in the main repository, not in a mission worktree.
    resolveCwd: () => '/home/dev/parallix',
  });

  assert.deepEqual(sessions, [{
    missionId: 'task-2217',
    role: 'draft',
    startedAtMs: NOW_MS - 30_000,
    worktree: null,
    pinnedAgent: 'custom',
  }], 'the slug on the command line identifies the mission before any worktree exists');
});

test('detectRunningMissionSessions reports unknown when a slug-less session cannot be placed', () => {
  const sessions = detectRunningMissionSessions({
    rootDir: '/home/dev/parallix',
    now: () => NOW_MS,
    listWorktrees: () => null,
    listProcesses: () => [{ pid: 100, elapsedSeconds: 60, args: REVIEW_PARENT }],
  });

  assert.equal(sessions, null, 'px review --continue needs the worktree listing to be identified');
});

test('detectRunningMissionSessions counts one session per mission and role', () => {
  const sessions = detectRunningMissionSessions({
    rootDir: '/home/dev/parallix',
    now: () => NOW_MS,
    listWorktrees: () => WORKTREES,
    listProcesses: () => [
      { pid: 100, elapsedSeconds: 60, args: REVIEW_PARENT },
      { pid: 101, elapsedSeconds: 60, args: REVIEW_CHILD },
    ],
    resolveCwd: () => '/home/dev/parallix-task-2328',
  });

  assert.deepEqual(sessions, [{
    missionId: 'task-2328',
    // `px review` runs the reviewer and then the act-on-review implementer, so
    // no single marker role describes what is running.
    role: null,
    startedAtMs: NOW_MS - 60_000,
    worktree: '/home/dev/parallix-task-2328',
    pinnedAgent: null,
  }]);
});

test('detectRunningMissionSessions ignores px commands that launch no agent', () => {
  const sessions = detectRunningMissionSessions({
    rootDir: '/home/dev/parallix',
    now: () => NOW_MS,
    listWorktrees: () => WORKTREES,
    listProcesses: () => [{ pid: 100, elapsedSeconds: 5, args: `${BOARD} ` }],
    resolveCwd: () => '/home/dev/parallix-task-2328',
  });

  assert.deepEqual(sessions, [], 'px board is not an agent session');
});

test('detectRunningMissionSessions falls back to the worktree path in the arguments', () => {
  const sessions = detectRunningMissionSessions({
    rootDir: '/home/dev/parallix',
    now: () => NOW_MS,
    listWorktrees: () => WORKTREES,
    listProcesses: () => [{ pid: 100, elapsedSeconds: 60, args: REVIEW_PARENT }],
    // Platform without /proc: no working directory is available.
    resolveCwd: () => null,
  });

  assert.equal(sessions?.length, 1, 'the worktree in argv must still identify the mission');
  assert.equal(sessions?.[0]?.missionId, 'task-2328');
});

test('detectRunningMissionSessions ignores an explicit slug from a different repository', () => {
  // A same-named mission launched from an unrelated checkout must not appear
  // on this board (SC1 / AC #1).
  const sessions = detectRunningMissionSessions({
    rootDir: '/home/dev/parallix',
    now: () => NOW_MS,
    listWorktrees: () => WORKTREES,
    listProcesses: () => [{ pid: 100, elapsedSeconds: 30, args: DRAFT_IN_OTHER_REPO }],
    resolveCwd: () => '/home/other/parallix',
  });

  assert.deepEqual(sessions, [], 'a same-named slug in another checkout is not local');
});

test('detectRunningMissionSessions reports unknown when an explicit slug has no repository evidence', () => {
  // A matching explicit-slug process whose working directory cannot be resolved
  // and whose arguments name no board-root or worktree path: we cannot tell if
  // it is local, so omitting it would make the count untrustworthy. Report
  // unknown rather than a fabricated zero (SC3).
  const sessions = detectRunningMissionSessions({
    rootDir: '/home/dev/parallix',
    now: () => NOW_MS,
    listWorktrees: () => WORKTREES,
    listProcesses: () => [{ pid: 100, elapsedSeconds: 30, args: DRAFT_IN_OTHER_REPO }],
    // Platform without /proc, and the argv path is outside the board repo.
    resolveCwd: () => null,
  });

  assert.equal(sessions, null, 'a matching explicit slug with no repository evidence is unknown, not zero');
});

test('detectRunningMissionSessions resolves a slug-less command from a nested worktree CWD', () => {
  // A slug-less command started below a worktree root resolves to that mission
  // (SC2 / AC #2).
  const sessions = detectRunningMissionSessions({
    rootDir: '/home/dev/parallix',
    now: () => NOW_MS,
    listWorktrees: () => WORKTREES,
    listProcesses: () => [{ pid: 100, elapsedSeconds: 60, args: REVIEW_PARENT }],
    resolveCwd: () => '/home/dev/parallix-task-2328/subtasks/nested',
  });

  assert.deepEqual(sessions?.map((session) => [session.missionId, session.worktree]), [
    ['task-2328', '/home/dev/parallix-task-2328'],
  ], 'the nested CWD resolves to its registered mission worktree');
});

test('detectRunningMissionSessions reports unknown when the process table cannot be read', () => {
  const sessions = detectRunningMissionSessions({
    rootDir: '/home/dev/parallix',
    now: () => NOW_MS,
    listWorktrees: () => WORKTREES,
    listProcesses: () => null,
  });

  assert.equal(sessions, null, 'an unreadable process table is unknown, not zero');
});

test('loadRunningSessions leaves a live px review process unattributed', async () => {
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('claude')],
    resolveTaskFile: () => ({ ok: false, matches: [] }),
    sessionMarkers: new StubSessionMarkers([
      marker('task-2328', 'review', 'claude'),
      marker('task-2328', 'execute', 'custom'),
    ]),
    detectRunningSessions: () => [
      { missionId: 'task-2328' as MissionId, role: null, startedAtMs: NOW_MS, worktree: '/home/dev/parallix-task-2328', pinnedAgent: null },
    ],
  });

  assert.deepEqual(await adapter.loadRunningSessions(), [
    { missionId: 'task-2328', family: null },
  ], 'the reviewer marker must not be claimed while act-on-review may be the live phase');
});

test('loadRunningSessions falls back to the family pinned on the command line', async () => {
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('custom')],
    resolveTaskFile: () => ({ ok: false, matches: [] }),
    // A fresh `px draft <slug> --agent custom` has not written a marker yet.
    sessionMarkers: new StubSessionMarkers([]),
    detectRunningSessions: () => [
      { missionId: 'task-2217' as MissionId, role: 'draft', startedAtMs: NOW_MS, worktree: null, pinnedAgent: 'custom' },
    ],
  });

  assert.deepEqual(await adapter.loadRunningSessions(), [
    { missionId: 'task-2217', family: 'custom' },
  ]);
});

test('loadRunningSessions ignores a session marker older than the running process', async () => {
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('codex')],
    resolveTaskFile: () => ({ ok: true, taskFile: '/home/dev/parallix/backlog/tasks/task-2217.md', matches: [] }),
    // The assignee is not evidence about who is running, and the marker below
    // was written by a previous run: the launcher writes it after a launch
    // exits, so it lags by one launch and can name a family that fell back.
    getTaskAssignee: () => 'codex',
    sessionMarkers: new StubSessionMarkers([marker('task-2217', 'execute', 'codex')]),
    detectRunningSessions: () => [
      { missionId: 'task-2217' as MissionId, role: 'execute', startedAtMs: NOW_MS, worktree: '/home/dev/parallix-task-2217', pinnedAgent: null },
    ],
  });

  assert.deepEqual(await adapter.loadRunningSessions(), [
    { missionId: 'task-2217', family: null },
  ], 'a marker from a previous run must not be reported as the running family');
});

test('loadRunningSessions uses a session marker written after the process started', async () => {
  const fresh: SessionMarkerEntry = {
    ...marker('task-2217', 'execute', 'custom'),
    lastLaunched: new Date(NOW_MS + 1_000).toISOString(),
  };
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('custom')],
    resolveTaskFile: () => ({ ok: false, matches: [] }),
    sessionMarkers: new StubSessionMarkers([fresh]),
    detectRunningSessions: () => [
      { missionId: 'task-2217' as MissionId, role: 'execute', startedAtMs: NOW_MS, worktree: '/home/dev/parallix-task-2217', pinnedAgent: 'codex' },
    ],
  });

  assert.deepEqual(await adapter.loadRunningSessions(), [
    { missionId: 'task-2217', family: 'custom' },
  ], 'a launch inside this process outranks the family pinned on the command line');
});

test('detectRunningMissionSessions leaves px review and px resolve-conflict role-less', () => {
  const sessions = detectRunningMissionSessions({
    rootDir: '/home/dev/parallix',
    now: () => NOW_MS,
    listWorktrees: () => WORKTREES,
    listProcesses: () => [
      { pid: 100, elapsedSeconds: 10, args: REVIEW_PARENT },
      { pid: 200, elapsedSeconds: 10, args: 'node /home/dev/parallix/node_modules/.bin/tsx src/entry/px.ts resolve-conflict task-2340' },
    ],
    resolveCwd: () => '/home/dev/parallix-task-2328',
  });

  assert.deepEqual(sessions?.map((session) => [session.missionId, session.role]), [
    // `px review` alternates reviewer and act-on-review implementer in one
    // process; `px resolve-conflict` launches without a slug or role and so
    // writes no marker at all.
    ['task-2328', null],
    ['task-2340', null],
  ]);
});

test('loadRunningSessions leaves a session unattributed when no source names a family', async () => {
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('claude')],
    resolveTaskFile: () => ({ ok: false, matches: [] }),
    sessionMarkers: null,
    detectRunningSessions: () => [
      { missionId: 'task-2328' as MissionId, role: null, startedAtMs: NOW_MS, worktree: '/home/dev/parallix-task-2328', pinnedAgent: null },
    ],
  });

  assert.deepEqual(await adapter.loadRunningSessions(), [
    { missionId: 'task-2328', family: null },
  ], 'an unattributable session is reported without a family rather than invented');
});

test('loadRunningSessions reports an observed empty process table as zero sessions', async () => {
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('claude')],
    resolveTaskFile: () => ({ ok: false, matches: [] }),
    detectRunningSessions: () => [],
  });

  assert.deepEqual(await adapter.loadRunningSessions(), [], 'nothing running is a fact, not unknown');
});

test('loadRunningSessions reports unknown when liveness could not be observed', async () => {
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('claude')],
    resolveTaskFile: () => ({ ok: false, matches: [] }),
    detectRunningSessions: () => null,
  });

  assert.equal(await adapter.loadRunningSessions(), null);
});
