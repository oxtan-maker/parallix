// Mission cancel contract: cancellation use case and persistence plus the CLI/web cancel surfaces.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Mission cancel: TASK-2466
//   Cancel surfaces: TASK-2466

import { describe, afterEach, it, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { MissionCancelService } from '../../../src/application/mission-cancel-service.js';
import { archiveTask } from '../../../src/adapters/backlog/task-transitions.js';
import { MissionIntakeService } from '../../../src/application/mission-intake-service.js';
import { BoardProjectionBuilder } from '../../../src/application/projections/board-readers.js';
import { availableBoardCommands } from '../../../src/application/projections/mission-board.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionLabels, missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { EventEmitter } from 'node:events';
import { Window, type HTMLButtonElement as DomButton } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Board } from '../../../web/src/board.js';
import { toWebBoardSnapshot } from '../../../src/interfaces/web/transport.js';
import { createCancelCommand, parseCancelCliRequest } from '../../../src/interfaces/cli/cancel.js';
import { missionCleanupCommand } from '../../../src/composition/production-capabilities.js';
import { makeCard, makeProjection } from '../../fixtures/board-projection.js';

// TASK-2466 (was test/task-2466-mission-cancel.test.ts)
describe('Mission cancel', () => {
  /**
   * TASK-2466 — the transactional `mission:cancel` delete, against real rows.
   *
   * Each test migrates its own temporary database and seeds three missions with a
   * row in every lifecycle table, so "scoped to one id" is proved by what the two
   * bystanders still have afterwards rather than by reading the SQL.
   */



  /** Every lifecycle table the contract retires, cascaded or explicit. */
  const LIFECYCLE_TABLES: readonly string[] = [
    'missions',
    'mission_labels',
    'mission_checkpoints',
    'mission_checkpoint_goal_checks',
    'mission_reviews',
    'mission_review_rounds',
    'mission_review_findings',
    'mission_review_resolutions',
    'mission_review_stage_launches',
    'mission_review_events',
    'mission_external_task_refs',
    'session_markers',
    'board_lane_events',
  ];

  const TARGET = 'task-2466-target';
  const SLUG = 'task-2466-projection';
  const BYSTANDERS = ['task-2466-keep-one', 'task-2466-keep-two'];
  const REPOSITORY = 'parallix';

  const temporaryDirectories: string[] = [];

  async function isolatedDatabase(): Promise<SqliteDatabaseAdapter> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2466-'));
    temporaryDirectories.push(directory);
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: path.join(directory, 'fixture.db') });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    return db;
  }

  /** One row in every lifecycle table, plus two usage rows carrying real cost. */
  async function seedMission(db: SqliteDatabaseAdapter, id: string): Promise<void> {
    await db.execute('INSERT INTO missions (id, repository_id, title, status) VALUES (?, ?, ?, ?)', [id, REPOSITORY, `Mission ${id}`, 'active']);
    await db.execute('INSERT INTO mission_labels (mission_id, position, label) VALUES (?, 0, ?)', [id, 'ai_sdlc']);
    await db.execute('INSERT INTO mission_checkpoints (mission_id, position, checkpoint_mission_id, name, next_action_text) VALUES (?, 0, ?, ?, ?)', [id, id, 'CP-1', 'Implement the cancel']);
    await db.execute('INSERT INTO mission_checkpoint_goal_checks (mission_id, checkpoint_position, position, criterion, evidence) VALUES (?, 0, 0, ?, ?)', [id, 'Deletion is scoped', 'test/task-2466-mission-cancel.test.ts']);
    await db.execute('INSERT INTO mission_reviews (mission_id) VALUES (?)', [id]);
    await db.execute(
      `INSERT INTO mission_review_rounds
         (mission_id, position, round_number, change_kind, source_branch, target_branch, revision, reviewer, implementer, started_at)
       VALUES (?, 0, 1, 'local-branch', ?, 'main', 'rev-1', 'codex', 'claude', '2026-09-07T10:00:00Z')`,
      [id, `mission/${id}`],
    );
    await db.execute('INSERT INTO mission_review_findings (mission_id, round_position, position, finding_id, summary) VALUES (?, 0, 0, ?, ?)', [id, 'F1', 'Deletion must be scoped']);
    await db.execute('INSERT INTO mission_review_resolutions (mission_id, round_position, position, finding_id, kind, explanation) VALUES (?, 0, 0, ?, ?, ?)', [id, 'F1', 'fixed', 'Scoped to the mission id']);
    await db.execute('INSERT INTO mission_review_stage_launches (mission_id, stage_key, position, fingerprint) VALUES (?, ?, 0, ?)', [id, 'reviewer', 'fingerprint-1']);
    await db.execute('INSERT INTO mission_review_events (mission_id, position, event_type, content) VALUES (?, 0, ?, ?)', [id, 'human_note', 'seeded event']);
    await db.execute('INSERT INTO mission_external_task_refs (mission_id, source, external_id) VALUES (?, ?, ?)', [id, 'backlog', id.toUpperCase()]);
    await db.execute('INSERT INTO session_markers (repository_id, mission_id, role, agent, last_launched) VALUES (?, ?, ?, ?, ?)', [REPOSITORY, id, 'execute', 'claude', '2026-09-07T10:00:00Z']);
    await db.execute(
      `INSERT INTO board_lane_events (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
       VALUES (?, ?, 'refined', 'active', 'activate', 'claude', '2026-09-07T10:00:00Z', ?)`,
      [REPOSITORY, id, `${id}-activate`],
    );
    await db.execute('INSERT INTO usage_statistics (repo, mission, stage, cost_usd, actor_key) VALUES (?, ?, ?, ?, ?)', [REPOSITORY, id, 'implementer', 1.25, 'claude']);
    await db.execute('INSERT INTO usage_statistics (repo, mission, stage, cost_usd, actor_key) VALUES (?, ?, ?, ?, ?)', [REPOSITORY, id, 'reviewer', 0.75, 'codex']);
  }

  async function seedBoard(db: SqliteDatabaseAdapter): Promise<void> {
    for (const id of [TARGET, ...BYSTANDERS]) { await seedMission(db, id); }
  }

  /** Row counts per lifecycle table for one mission id. */
  async function lifecycleCounts(db: SqliteDatabaseAdapter, id: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of LIFECYCLE_TABLES) {
      const column = table === 'missions' ? 'id' : 'mission_id';
      const rows = await db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table} WHERE ${column} = ?`, [id]);
      counts[table] = rows[0].total;
    }
    return counts;
  }

  async function usageFacts(db: SqliteDatabaseAdapter, id: string): Promise<{ rows: number; cost: number }> {
    const rows = await db.query<{ total: number; cost: number | null }>(
      'SELECT COUNT(*) AS total, SUM(cost_usd) AS cost FROM usage_statistics WHERE mission = ?',
      [id],
    );
    return { rows: rows[0].total, cost: rows[0].cost ?? 0 };
  }

  /** A pass-through adapter façade a test can fail at one chosen statement. */
  function adapterDouble(db: SqliteDatabaseAdapter, overrides: Partial<SqliteDatabaseAdapter>): SqliteDatabaseAdapter {
    const passthrough = {
      execute: (sql: string, params?: readonly unknown[]) => db.execute(sql, params),
      query: (sql: string, params?: readonly unknown[]) => db.query(sql, params),
      beginTransaction: () => db.beginTransaction(),
      commitTransaction: () => db.commitTransaction(),
      rollbackTransaction: () => db.rollbackTransaction(),
    };
    return { ...passthrough, ...overrides } as unknown as SqliteDatabaseAdapter;
  }

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  describe('mission:cancel deletes one mission and nothing else', () => {
    it('removes every lifecycle row for the cancelled mission id', async () => {
      const db = await isolatedDatabase();
      await seedBoard(db);
      await new SqliteMissionStore(db).cancel(missionId(TARGET));

      const remaining = await lifecycleCounts(db, TARGET);
      for (const table of LIFECYCLE_TABLES) {
        assert.equal(remaining[table], 0, `${table} still holds rows for ${TARGET}`);
      }
    });

    it('leaves the other two missions untouched in every lifecycle table', async () => {
      const db = await isolatedDatabase();
      await seedBoard(db);
      const before = await Promise.all(BYSTANDERS.map((id) => lifecycleCounts(db, id)));
      await new SqliteMissionStore(db).cancel(missionId(TARGET));

      for (const [index, id] of BYSTANDERS.entries()) {
        assert.deepEqual(await lifecycleCounts(db, id), before[index], `${id} lost rows to the cancel`);
        assert.deepEqual(before[index], Object.fromEntries(LIFECYCLE_TABLES.map((table) => [table, 1])));
      }
    });

    it('preserves the cancelled mission usage_statistics rows and summed cost_usd', async () => {
      const db = await isolatedDatabase();
      await seedBoard(db);
      const before = await usageFacts(db, TARGET);
      await new SqliteMissionStore(db).cancel(missionId(TARGET));

      assert.deepEqual(await usageFacts(db, TARGET), before);
      assert.deepEqual(before, { rows: 2, cost: 2 });
    });

    it('leaves no foreign-key violation behind', async () => {
      const db = await isolatedDatabase();
      await seedBoard(db);
      await new SqliteMissionStore(db).cancel(missionId(TARGET));

      assert.deepEqual(await db.query('PRAGMA foreign_key_check'), []);
    });

    it('rolls back the whole cancel when a statement fails mid-transaction', async () => {
      const db = await isolatedDatabase();
      await seedBoard(db);
      const before = await lifecycleCounts(db, TARGET);
      const failing = adapterDouble(db, {
        execute: (async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('FROM missions')) { throw new Error('induced mid-transaction failure'); }
          return db.execute(sql, params);
        }) as SqliteDatabaseAdapter['execute'],
      });

      await assert.rejects(
        () => new SqliteMissionStore(failing).cancel(missionId(TARGET)),
        /induced mid-transaction failure/,
      );
      assert.deepEqual(await lifecycleCounts(db, TARGET), before);
      assert.deepEqual(await usageFacts(db, TARGET), { rows: 2, cost: 2 });
    });

    it('refuses to delete anything when foreign keys are not enabled', async () => {
      const db = await isolatedDatabase();
      await seedBoard(db);
      const before = await lifecycleCounts(db, TARGET);
      const unenforced = adapterDouble(db, {
        query: (async (sql: string, params?: readonly unknown[]) =>
          sql === 'PRAGMA foreign_keys' ? [{ foreign_keys: 0 }] : db.query(sql, params)) as SqliteDatabaseAdapter['query'],
      });

      await assert.rejects(
        () => new SqliteMissionStore(unenforced).cancel(missionId(TARGET)),
        /PRAGMA foreign_keys is not enabled/,
      );
      assert.deepEqual(await lifecycleCounts(db, TARGET), before);
    });

    it('refuses to delete a delivered Mission while closeout is pending', async () => {
      const db = await isolatedDatabase();
      await seedBoard(db);
      await db.execute("UPDATE missions SET status = 'done', closed_at = NULL WHERE id = ?", [TARGET]);
      const before = await lifecycleCounts(db, TARGET);
      await assert.rejects(
        () => new SqliteMissionStore(db).cancel(missionId(TARGET)),
        /integrated Mission closeout must finish/,
      );
      assert.deepEqual(await lifecycleCounts(db, TARGET), before);
    });

    it('reports the operator git cleanup without running a git command', async () => {
      const db = await isolatedDatabase();
      await seedBoard(db);
      // The cleanup is a value the service renders, never a process it starts:
      // the only way this text can become a git invocation is the operator
      // running it. The production builder's read-only git use is asserted in
      // the Cancel surfaces section of this suite.
      const service = new MissionCancelService(
        new SqliteMissionStore(db),
        (slug) => `git worktree remove /tmp/${slug} && git branch -D mission/${slug}`,
        () => true,
      );

      const result = await service.executeForSlug(TARGET);
      assert.equal(result.slug, TARGET);
      assert.equal(result.cleanupCommand, `git worktree remove /tmp/${TARGET} && git branch -D mission/${TARGET}`);
      assert.equal((await lifecycleCounts(db, TARGET)).missions, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // Projection
  // ---------------------------------------------------------------------------

  test('the cancelled mission leaves the board projection without rebuilding the reader', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2466-projection-'));
    temporaryDirectories.push(directory);
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: path.join(directory, 'fixture.db') });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    const store = new SqliteMissionStore(db);
    const repository = repositoryId('parallix');
    const target = missionId(SLUG);
    await new MissionIntakeService(store).execute({
      operationId: 'op-intake',
      missionId: target,
      repositoryId: repository,
      title: 'Cancel a mission from the TUI and web board',
      labels: missionLabels(['ai_sdlc']),
      assignee: agentFamily('claude'),
      rawStatus: 'backlog',
      capabilities: new Set(['mission:intake', 'mission:transition'] as const),
    } as never);

    // One builder, held across both builds: "without a restart" is exactly this.
    const builder = new BoardProjectionBuilder(
      {
        async loadAllMissions() { return store.loadByRepository(repository); },
        async loadMission(id: never) { const loaded = await store.load(id); return loaded.kind === 'found' ? loaded.mission : null; },
        getSourceFacts() { return [{ source: 'mission-store' as const, status: 'fresh' as const, value: repository }]; },
      } as never,
      { async loadReviews(ids: readonly string[]) { return new Map(ids.map((id) => [id, { review: null, approval: null }])); } } as never,
      { async loadGateStatus() { return 'unknown' as const; } } as never,
      { async loadAgentAvailability() { return []; }, async loadAssignedAgent() { return null; } } as never,
      { async loadRepositoryId() { return repository; }, async loadHeadCommit() { return 'abc123'; } } as never,
      { async loadOperationLog() { return []; } } as never,
    );

    const before = await builder.build();
    assert.ok(before.stages.flatMap((stage) => stage.cards).some((card) => card.id === target), 'the mission must start on the board');

    await store.cancel(target);

    const after = await builder.build();
    assert.deepEqual(after.stages.flatMap((stage) => stage.cards).map((card) => card.id), []);
  });

  test('every persisted mission advertises an enabled cancel command, last', () => {
    const commands = availableBoardCommands(
      { id: missionId(SLUG), repositoryId: repositoryId('parallix'), title: 'Cancel', labels: [], status: 'active', closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null } as never,
      { reviewApproval: null } as never,
    );
    assert.deepEqual(commands.at(-1), { command: 'cancel', enabled: true, reason: null, targetLane: null, label: 'cancel ✕' });
  });

  test('a delivered Mission does not offer cancellation during closeout', () => {
    const commands = availableBoardCommands(
      { id: missionId(SLUG), repositoryId: repositoryId('parallix'), title: 'Delivered', labels: [], status: 'done', closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null } as never,
      { reviewApproval: null } as never,
    );
    assert.equal(commands.at(-1)?.command, 'cancel');
    assert.equal(commands.at(-1)?.enabled, false);
  });

  // ---------------------------------------------------------------------------
  // The board reads task markdown, not rows
  // ---------------------------------------------------------------------------

  test('cancellation archives the task file, the only thing that removes the card', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2466-archive-'));
    temporaryDirectories.push(directory);
    const tasksDir = path.join(directory, 'backlog', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    const taskFile = path.join(tasksDir, `${SLUG}-cancel-me.md`);
    fs.writeFileSync(taskFile, `---\nid: ${SLUG.toUpperCase()}\nstatus: refined\n---\n# Cancel me\n`, 'utf8');

    const db = await isolatedDatabase();
    const service = new MissionCancelService(
      new SqliteMissionStore(db),
      (slug) => `git worktree remove /tmp/${slug}`,
      (slug) => archiveTask(slug, directory),
    );

    const result = await service.executeForSlug(SLUG);

    assert.equal(result.taskArchived, true);
    assert.equal(fs.existsSync(taskFile), false, 'the task file must leave the tasks directory');
    assert.deepEqual(
      fs.readdirSync(path.join(directory, 'backlog', 'archive', 'tasks')),
      [`${SLUG}-cancel-me.md`],
    );
  });

  test('cancelling a mission with no task file reports that nothing was archived', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2466-archive-none-'));
    temporaryDirectories.push(directory);
    const db = await isolatedDatabase();
    const service = new MissionCancelService(
      new SqliteMissionStore(db),
      (slug) => `git worktree remove /tmp/${slug}`,
      (slug) => archiveTask(slug, directory),
    );

    assert.equal((await service.executeForSlug(SLUG)).taskArchived, false);
  });
});

// TASK-2466 (was test/task-2466-cancel-surfaces.test.ts)
describe('Cancel surfaces', () => {
  /**
   * TASK-2466 — the three surfaces of `mission:cancel`.
   *
   * Every test drives a real surface: the CLI command, the Ink shell's keyboard
   * router, and the browser board rendered into happy-dom. What they assert is
   * what a dismissed confirmation must never produce — a dispatch.
   */




  const SLUG = 'task-2466-surface';
  const CANCEL_COMMAND = { command: 'cancel', enabled: true, reason: null, targetLane: null, label: 'cancel ✕' } as const;
  const ESCAPE = '';

  /** Records every request a surface dispatches, and answers with one outcome. */
  function dispatcherSpy(outcome: unknown = { status: 'completed', value: { slug: SLUG, cleanupCommand: `git worktree remove /tmp/${SLUG} && git branch -D mission/${SLUG}` }, durableEvidence: [] }) {
    const requests: Array<Record<string, unknown>> = [];
    return {
      requests,
      canExecute: () => true,
      async dispatch(request: Record<string, unknown>) { requests.push(request); return outcome; },
    };
  }

  // ---------------------------------------------------------------------------
  // CLI
  // ---------------------------------------------------------------------------

  describe('px cancel', () => {
    it('refuses to dispatch without the explicit --yes confirmation', async () => {
      const dispatcher = dispatcherSpy();
      const lines: string[] = [];
      const codes: number[] = [];
      const code = await createCancelCommand(dispatcher as never, (line) => lines.push(line), (value) => codes.push(value))([SLUG]);

      assert.equal(code, 1);
      assert.deepEqual(codes, [1]);
      assert.deepEqual(dispatcher.requests, []);
      assert.match(lines.join('\n'), /Re-run with: px cancel task-2466-surface --yes/);
    });

    it('dispatches mission:cancel carrying the mission id alone and prints the operator git cleanup', async () => {
      const dispatcher = dispatcherSpy();
      const lines: string[] = [];
      const code = await createCancelCommand(dispatcher as never, (line) => lines.push(line), () => {})([SLUG, '--yes']);

      assert.equal(code, 0);
      assert.equal(dispatcher.requests.length, 1);
      assert.equal(dispatcher.requests[0].kind, 'mission:cancel');
      assert.equal(dispatcher.requests[0].missionId, SLUG);
      assert.equal(dispatcher.requests[0].payload, undefined);
      assert.match(lines.join('\n'), /Usage statistics for task-2466-surface are preserved\./);
      assert.match(lines.join('\n'), /git worktree remove \/tmp\/task-2466-surface && git branch -D mission\/task-2466-surface/);
    });

    it('rejects an unknown flag and a missing slug', () => {
      assert.throws(() => parseCancelCliRequest([SLUG, '--force']), /Unknown cancel option: --force/);
      assert.throws(() => parseCancelCliRequest(['--yes']), /requires exactly one mission slug/);
    });
  });

  // ---------------------------------------------------------------------------
  // Advisory git cleanup
  // ---------------------------------------------------------------------------

  test('the cleanup command is built with read-only git and mutates nothing', () => {
    const gitCalls: string[][] = [];
    const gitFn = (args: string[]) => {
      gitCalls.push(args);
      return { stdout: '', status: 0 };
    };
    const command = missionCleanupCommand(SLUG, '/fixture/parallix', gitFn);

    assert.match(command, /^git worktree remove .*task-2466-surface && git branch -D .*task-2466-surface$/);
    // The builder may only *read* git state; a mutating verb here would mean
    // cancellation touched the worktree it merely reports on.
    for (const call of gitCalls) {
      assert.deepEqual(call, ['worktree', 'list', '--porcelain']);
    }
  });

  // ---------------------------------------------------------------------------
  // TUI
  // ---------------------------------------------------------------------------

  class Stream extends EventEmitter {
    public columns = 120;
    public rows = 30;
    public readonly isTTY = true;
    public readonly writes: string[] = [];
    private readonly input: string[] = [];
    write(value: string): boolean { this.writes.push(value); this.emit('write'); return true; }
    setRawMode(_enabled: boolean): void {}
    setEncoding(_encoding: string): void {}
    resume(): void {}
    ref(): void {}
    unref(): void {}
    read(): string | null { return this.input.shift() ?? null; }
    send(value: string): void { this.input.push(value); this.emit('readable'); }
  }

  async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (predicate()) { return true; }
      if (Date.now() >= deadline) { return false; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  function waitForOutput(stream: Stream, pattern: RegExp, timeoutMs = 2_000): Promise<boolean> {
    return waitFor(() => pattern.test(stream.writes.join('')), timeoutMs);
  }

  async function renderCancelBoard(dispatcher: { dispatch: (..._args: any[]) => Promise<any> }, refreshProjection?: () => Promise<any>) {
    const ink = await import('ink');
    const { BoardShell } = await import('../../../src/interfaces/tui/shell.js');
    const stdin = new Stream();
    const stdout = new Stream();
    const card = makeCard({
      id: SLUG as never,
      lane: 'active', status: 'active', rawStatus: 'active',
      commands: [CANCEL_COMMAND],
    });
    const instance = ink.render(React.createElement(BoardShell, {
      projection: makeProjection({ active: [card] }),
      initialSelectedMissionId: SLUG,
      commandControllerFactory: () => ({ canExecute: (kind: string) => kind === 'mission:cancel', ...dispatcher }),
      refreshProjection,
    } as never), { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false });
    await waitFor(() => stdout.writes.length > 0);
    return { stdin, stdout, instance };
  }

  describe('the TUI cancel confirmation', () => {
    it('ignores the Enter that confirms every other command and deletes only on a second Shift+X', async () => {
      const dispatcher = dispatcherSpy();
      const ui = await renderCancelBoard(dispatcher);
      try {
        ui.stdin.send('X');
        assert.ok(await waitForOutput(ui.stdout, /CONFIRM DESTRUCTIVE CANCELLATION/), 'Shift+X must open the destructive dialog');

        ui.stdin.send('\r');
        assert.equal(await waitFor(() => dispatcher.requests.length > 0, 300), false, 'Enter must not confirm a cancellation');

        ui.stdin.send('X');
        assert.ok(await waitFor(() => dispatcher.requests.length === 1), 'the second Shift+X must dispatch');
        assert.equal(dispatcher.requests[0].kind, 'mission:cancel');
        assert.equal(dispatcher.requests[0].missionId, SLUG);
      } finally { ui.instance.unmount(); }
    });

    it('dismissing with Escape deletes nothing', async () => {
      const dispatcher = dispatcherSpy();
      const ui = await renderCancelBoard(dispatcher);
      try {
        ui.stdin.send('X');
        assert.ok(await waitForOutput(ui.stdout, /CONFIRM DESTRUCTIVE CANCELLATION/));
        ui.stdin.send(ESCAPE);
        assert.ok(await waitForOutput(ui.stdout, /CANCELLED: cancelled before dispatch/));
        assert.deepEqual(dispatcher.requests, []);
      } finally { ui.instance.unmount(); }
    });

    it('drops the cancelled mission from the board without a restart', async () => {
      const dispatcher = dispatcherSpy();
      let refreshes = 0;
      const ui = await renderCancelBoard(dispatcher, async () => { refreshes += 1; return makeProjection({}); });
      try {
        ui.stdin.send('X');
        assert.ok(await waitForOutput(ui.stdout, /CONFIRM DESTRUCTIVE CANCELLATION/));
        ui.stdin.send('X');
        assert.ok(await waitFor(() => refreshes === 1), 'a completed cancel must rebuild the projection');
        assert.ok(await waitFor(() => !ui.stdout.writes.slice(-1).join('').includes(SLUG)), 'the cancelled card must leave the rendered board');
      } finally { ui.instance.unmount(); }
    });
  });

  // ---------------------------------------------------------------------------
  // Web board
  // ---------------------------------------------------------------------------

  function webSnapshot() {
    return toWebBoardSnapshot(makeProjection({
      active: [makeCard({ id: missionId(SLUG), status: 'active', lane: 'active', commands: [CANCEL_COMMAND] })],
    }));
  }

  async function renderWebBoard() {
    const window = new Window();
    const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT, requestAnimationFrame: globalThis.requestAnimationFrame };
    Object.assign(globalThis, { window, document: window.document });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.requestAnimationFrame = (callback) => { callback(0); return 0; };
    const calls: RequestInit[] = [];
    globalThis.fetch = async (_url, init) => {
      calls.push(init!);
      return new Response(
        JSON.stringify({ kind: 'command-result', transportVersion: 2, status: 'completed', value: { slug: SLUG, cleanupCommand: 'git worktree remove /tmp/x && git branch -D mission/x' }, error: null, durableEvidence: [] }),
        { headers: { 'content-type': 'application/json' } },
      );
    };
    let refreshes = 0;
    const mount = window.document.createElement('div');
    window.document.body.append(mount);
    const root = createRoot(mount);
    await act(async () => { root.render(React.createElement(Board, { snapshot: webSnapshot(), onRefresh: async () => { refreshes += 1; } })); });
    return {
      window, mount, calls, root,
      refreshCount: () => refreshes,
      async close() {
        await act(async () => { root.unmount(); });
        Object.assign(globalThis, previous);
        await window.happyDOM.close();
      },
    };
  }

  function cancelButton(page: { mount: any }): DomButton {
    return page.mount.querySelector('button[aria-label^="px cancel"]');
  }

  function buttonLabelled(page: { mount: any }, text: string): DomButton {
    return [...page.mount.querySelectorAll('button')].find((button: DomButton) => button.textContent?.includes(text));
  }

  describe('the web cancel confirmation', () => {
    it('asks before deleting: the card button alone sends no command', async () => {
      const page = await renderWebBoard();
      try {
        await act(async () => { cancelButton(page).click(); });
        assert.deepEqual(page.calls, []);
        assert.ok(page.mount.querySelector(`section[aria-label="Confirm cancelling ${SLUG}"]`), 'the destructive confirmation must be rendered');
      } finally { await page.close(); }
    });

    it('dismissing the confirmation deletes nothing', async () => {
      const page = await renderWebBoard();
      try {
        await act(async () => { cancelButton(page).click(); });
        await act(async () => { buttonLabelled(page, 'keep mission').click(); });
        assert.deepEqual(page.calls, []);
        assert.equal(page.mount.querySelector(`section[aria-label="Confirm cancelling ${SLUG}"]`), null);
      } finally { await page.close(); }
    });

    it('confirming sends one mission:cancel request and refreshes the board', async () => {
      const page = await renderWebBoard();
      try {
        await act(async () => { cancelButton(page).click(); });
        await act(async () => { buttonLabelled(page, `delete ${SLUG} lifecycle rows`).click(); });
        assert.equal(page.calls.length, 1);
        assert.deepEqual(JSON.parse(String(page.calls[0].body)), {
          missionId: SLUG,
          kind: 'mission:cancel',
          missionStatusAtRequest: 'active',
        });
        assert.equal(page.refreshCount(), 1);
      } finally { await page.close(); }
    });
  });
});
