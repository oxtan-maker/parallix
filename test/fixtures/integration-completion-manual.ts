/** Manual public CLI/HTTP probe. Every mutation belongs to disposable state. */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { workflowBoard } from './workflow-board.js';
import { workflowHttp } from './workflow-http.js';
import { missionLabels } from '../../src/domain/mission.js';
import { agentFamily } from '../../src/domain/agents.js';
import { fixtureMission, approvedReview } from './mission-builders.js';
import { projectExecutionActivity } from '../../src/domain/execution-activity.js';
import { claimWorkflow, finishWorkflow, workflowOperation } from '../../src/domain/workflow-operation.js';
import { SqliteExecutionActivityStore } from '../../src/adapters/sqlite/execution-activity-store.js';
import type { WebBoardSnapshot } from '../../src/interfaces/web/transport.js';

const entry = path.resolve('build/px.mjs');
const f = await workflowBoard(2, { cli: { command: process.execPath, args: [entry] } });
const environment = { ...f.configuration.forwardedEnvironment, PRIMARY_WORKTREE: f.root, PARALLIX_NO_TUI: '1' };
for (const key of ['PARALLIX_WORKFLOW_OPERATION', 'PARALLIX_WORKFLOW_GENERATION', 'PARALLIX_MISSION_TERMINAL', 'PARALLIX_MISSION_SOCKET', 'PARALLIX_OPERATION_CAPTURE']) {
  delete environment[key as keyof typeof environment];
}
const git = (...args: string[]) => execFileSync('git', ['-C', f.root, ...args], { env: environment, encoding: 'utf8' });
let child: ReturnType<typeof spawn> | undefined;
async function cli(slug: string): Promise<number | null> {
  child = spawn(process.execPath, [entry, 'integrate', slug, '--recover-landed'], {
    cwd: f.root, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks: string[] = [];
  child.stdout!.on('data', data => chunks.push(String(data)));
  child.stderr!.on('data', data => chunks.push(String(data)));
  const timer = setTimeout(() => child?.kill('SIGTERM'), 45000);
  const code = await new Promise<number | null>((resolve, reject) => {
    child!.once('exit', resolve); child!.once('error', reject);
  }).finally(() => clearTimeout(timer));
  console.log(`Public CLI ${slug}: exit=${code}\n${chunks.join('').slice(-7000)}`);
  return code;
}
try {
  const configPath = path.join(f.root, 'workflow.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.adapters.missions = { worktreePattern: 'worktrees/<slug>' };
  fs.writeFileSync(configPath, JSON.stringify(config));
  git('add', 'workflow.config.json');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'align disposable worktree paths');
  const first = await f.store.load(f.slugs[0] as Parameters<typeof f.store.load>[0]);
  assert.equal(first.kind, 'found');
  if (first.kind !== 'found') { throw new Error('fixture missing'); }
  const repo = first.mission.repositoryId;
  for (const slug of f.slugs) {
    const loaded = await f.store.load(slug as typeof first.mission.id);
    if (loaded.kind !== 'found') { throw new Error('fixture missing'); }
    await f.store.save(fixtureMission(slug, { repositoryId: repo, status: 'integration',
      assignee: agentFamily('codex'), labels: missionLabels(['ai_sdlc']),
      review: approvedReview(slug), checkpoints: [] }), loaded.version);
  }
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    'commit', '--allow-empty', '-m', `mission/${f.slugs[0]}: already landed disposable payload`);
  assert.equal(await cli(f.slugs[0]), 0);
  const activity = new SqliteExecutionActivityStore(f.database, repo);
  const success = (await activity.loadMissionCurrentWork(first.mission.id))[0];
  assert.equal(success.frames.length, 0);
  assert.equal(success.terminal?.state, 'ended');
  assert.equal(projectExecutionActivity([success], { nowMs: Date.now(), ttlMs: 300000 }).get(first.mission.id)?.blockingReason, null);
  const closed = await f.store.load(first.mission.id);
  assert.ok(closed.kind === 'found' && closed.mission.closedAt);
  console.log('Completion: root=completed, integration=ended, frames=0, blocker=null, mission=closed');
  assert.notEqual(await cli(f.slugs[1]), 0);

  // Persist the old bug shape through supported activity and workflow owners.
  for (const slug of ['px-0008', 'px-0020']) {
    const mission = fixtureMission(slug, { repositoryId: repo, status: 'done', closedAt: new Date().toISOString() });
    await f.store.save(mission, null);
    const intent = workflowOperation({ id: `stale:${slug}`, requestKey: slug, missionId: mission.id,
      repositoryId: repo, command: 'integrate:merge', generation: 0, phase: 'accepted', owner: null,
      providerStarted: false, agent: null, reviewer: null, originalStatus: 'integration', previousAssignee: null,
      reason: null, createdAt: mission.closedAt!, updatedAt: mission.closedAt! });
    const event = { missionId: mission.id, operationId: intent.id, phase: 'integrate' as const,
      state: 'running' as const, summary: `px integrate ${slug}`, agent: null, processId: null,
      blockedReason: null, occurredAt: intent.createdAt };
    await activity.publish(event, intent.id);
    await activity.publish(event, `child:${slug}`);
    await activity.publish({ ...event, state: 'blocked', blockedReason: 'integration cannot continue autonomously' }, `child:${slug}`);
    await activity.publish({ ...event, state: 'ended' }, intent.id);
    await f.operations.insert(finishWorkflow(claimWorkflow(intent, { pid: process.pid, identity: 'manual' }, intent.createdAt), 1, true, null, intent.updatedAt));
  }
  const host = await f.start();
  const http = await workflowHttp(host);
  const retained = async () => Promise.all(['missions', 'board_lane_events', 'operational_history', 'execution_activity', 'workflow_operations', 'usage_statistics']
    .map(table => f.database.query(`SELECT * FROM ${table} ORDER BY rowid`)));
  const before = await retained();
  for (let read = 0; read < 2; read++) {
    const snapshot = await http.snapshot() as WebBoardSnapshot;
    const cards = snapshot.stages.flatMap(stage => [...stage.cards, ...(stage.historyCards ?? [])]);
    for (const slug of [f.slugs[0], 'px-0008', 'px-0020']) {
      const card = cards.find(card => card.id === slug)!;
      assert.ok(card, `public board includes ${slug}`);
      assert.equal(card.activity.work.kind, 'idle');
      assert.equal(card.blockingReason, null);
      assert.ok(card.actions.every(action => action.state !== 'enabled'));
      assert.ok(!snapshot.attentionQueue.some(item => item.missionId === slug));
    }
    assert.ok(snapshot.attentionQueue.some(item => item.missionId === f.slugs[1]));
    assert.match(cards.find(card => card.id === f.slugs[1])!.blockingReason!, /status 1|No landed squash/);
    console.log(`HTTP /api/board read ${read + 1}: 3 closed missions idle, no blockers/attention/enabled actions; open failure visible`);
  }
  assert.deepEqual(await retained(), before, 'HTTP readback preserves lifecycle, audit, activity and statistics');
  console.log('Repeat HTTP reads preserve disposable history and statistics exactly.');
} finally {
  if (child?.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); }
  await f.close();
}
