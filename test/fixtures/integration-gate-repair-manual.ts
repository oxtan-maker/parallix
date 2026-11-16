/** Manual built-CLI probe for one- and multi-gate integration repair. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { workflowBoard } from './workflow-board.js';
import { fixtureMission } from './mission-builders.js';
import { agentFamily } from '../../src/domain/agents.js';
import { missionId, missionLabels } from '../../src/domain/mission.js';
import {
  applyReviewerCommand,
  changeRevision,
  ConfiguredReviewerEligibility,
  startReview,
} from '../../src/domain/review.js';

const entry = path.resolve('build/px.mjs');

function executableSource(): string {
  return `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

if (process.argv.includes('--help')) {
  process.stdout.write('manual fixture agent\\n');
  process.exit(0);
}

function runPx(args) {
  const result = childProcess.spawnSync(process.execPath, [process.env.PARALLIX_MANUAL_PX_ENTRY].concat(args), {
    cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 30000
  });
  if (result.status !== 0) {
    process.stderr.write((result.stdout || '') + (result.stderr || ''));
    process.exit(result.status || 1);
  }
  return result.stdout || '';
}

function version(slug) {
  return String(JSON.parse(runPx(['status', slug, '--json'])).version);
}

function slugFrom(prompt) {
  const match = prompt.match(/^Mission:\\s*((?:task|px)-[a-z0-9-]+)/im)
    || prompt.match(/^Mission slug:\\s*((?:task|px)-[a-z0-9-]+)/im)
    || prompt.match(/mission\\/((?:task|px)-[a-z0-9-]+)/i);
  if (!match) { throw new Error('manual agent could not resolve the Mission slug'); }
  return match[1];
}

const stdin = fs.readFileSync(0, 'utf8');
const prompt = stdin || process.argv[process.argv.length - 1] || '';
if (!prompt) {
  process.stdout.write('{"sessionID":"ses_manual_probe"}\\n');
  process.exit(0);
}
const slug = slugFrom(prompt);
const log = process.env.PARALLIX_MANUAL_AGENT_LOG;

if (/^Mode: review\\./m.test(prompt)) {
  fs.appendFileSync(log, 'review\\n');
  runPx(['verdict', 'approve', '--slug', slug, '--actor', 'codex',
    '--expected-version', version(slug), '--comment', 'Manual repair probe verified']);
} else {
  fs.appendFileSync(log, 'implementer\\n');
  const gateKeys = process.env.PARALLIX_MANUAL_GATE_KEYS.split(',');
  for (const key of gateKeys) { fs.writeFileSync(path.join(process.cwd(), key + '.ok'), 'repaired\\n'); }
  childProcess.execFileSync('git', ['add'].concat(gateKeys.map(key => key + '.ok')), { cwd: process.cwd() });
  childProcess.execFileSync('git', ['commit', '-m', 'repair manual integration gates'], { cwd: process.cwd() });
  const checkpoints = [...prompt.matchAll(/— (CP-\\d+) \\(Mission version/g)].map(match => match[1]);
  if (checkpoints.length !== gateKeys.length) {
    throw new Error('manual repair prompt did not expose one checkpoint per failed gate');
  }
  for (const checkpoint of checkpoints) {
    runPx(['checkpoint', 'record', '--slug', slug, '--name', checkpoint,
      '--criterion', 'feature ships', '--evidence', 'feature.txt; ' + gateKeys.join('.ok; ') + '.ok',
      '--next', 'Certify every gate repair checkpoint with the shared integration rerun']);
  }
}
process.stdout.write('{"sessionID":"ses_manual_probe","type":"result","session_id":"manual-probe"}\\n');
`;
}

function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function runCli(root: string, env: NodeJS.ProcessEnv, ...args: string[]) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, `px ${args.join(' ')} failed\n${output.slice(-12_000)}`);
  return output;
}

async function scenario(name: string, gateKeys: string[]): Promise<void> {
  const fixture = await workflowBoard(1, { cli: { command: process.execPath, args: [entry] } });
  const slug = fixture.slugs[0];
  const worktree = path.join(fixture.root, 'worktrees', fixture.slugs[0]);
  const bin = path.join(fixture.root, 'manual-bin');
  const agentLog = path.join(fixture.root, 'manual-agent.log');
  const env = {
    ...fixture.configuration.forwardedEnvironment,
    PRIMARY_WORKTREE: fixture.root,
    PARALLIX_HOME: fixture.root,
    PARALLIX_NO_BUBBLEWRAP: '1',
    PARALLIX_NO_TUI: '1',
    PARALLIX_TEST_NO_FORGEJO: '1',
    PARALLIX_MANUAL_PX_ENTRY: entry,
    PARALLIX_MANUAL_AGENT_LOG: agentLog,
    PARALLIX_MANUAL_GATE_KEYS: gateKeys.join(','),
    FORCE_COLOR: '0',
    PATH: `${bin}:${process.env.PATH}`,
  };
  for (const key of ['PARALLIX_WORKFLOW_OPERATION', 'PARALLIX_WORKFLOW_GENERATION', 'PARALLIX_MISSION_TERMINAL',
    'PARALLIX_MISSION_SOCKET', 'PARALLIX_OPERATION_CAPTURE']) { delete env[key as keyof typeof env]; }
  try {
    fs.mkdirSync(bin);
    for (const executable of ['opencode', 'codex']) {
      fs.writeFileSync(path.join(bin, executable), executableSource(), { mode: 0o755 });
    }
    fs.mkdirSync(path.join(fixture.root, 'backlog', 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(fixture.root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(fixture.root, '.gitignore'), '.workflow/\nparallix.db*\n');
    const config = {
      product: { name: 'manual-gate-repair' },
      adapters: {
        terminal: { host: 'pipe', whenUnavailable: 'fallback' },
        tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
        missions: { branchPrefix: 'mission/', worktreePattern: 'worktrees/<slug>' },
        review: { provider: 'none' },
        verification: { command: ':' },
        agents: { models: { custom: 'stub/manual' }, runners: { custom: 'opencode' } },
        gates: { requirePreIntegration: true, preIntegration: gateKeys.map((key, index) => ({
          key, order: index + 1,
          command: `test -f ${key}.ok || { echo "${key} failed" >&2; exit ${index + 2}; }`,
        })) },
      },
    };
    fs.writeFileSync(path.join(fixture.root, 'workflow.config.json'), JSON.stringify(config, null, 2));
    fs.writeFileSync(path.join(fixture.root, 'config', 'agents.json'), JSON.stringify({ steps: {
      draft: { eligible: ['custom'], selection: 'random' },
      active: { eligible: ['custom'], selection: 'random' },
      review: { eligible: ['codex'], selection: 'random' },
    } }, null, 2));
    fs.writeFileSync(path.join(fixture.root, 'config', 'state-map.json'), JSON.stringify({
      ready: 'refined', approved: 'ready-for-integration',
    }, null, 2));
    fs.writeFileSync(path.join(fixture.root, 'backlog', 'tasks', `${slug} - Manual.md`), [
      '---', `id: ${slug.toUpperCase()}`, 'title: Manual gate repair', 'status: ready-for-integration',
      'assignee: [custom]', 'labels: []', '---', '',
    ].join('\n'));
    git(fixture.root, 'add', '.');
    git(fixture.root, 'commit', '-m', 'configure manual gate repair');
    git(worktree, 'rebase', 'main');
    fs.writeFileSync(path.join(worktree, 'feature.txt'), 'approved feature\n');
    git(worktree, 'add', 'feature.txt');
    git(worktree, 'commit', '-m', `${slug}: approved feature`);
    const revision = git(worktree, 'rev-parse', 'HEAD');
    const baseline = git(fixture.root, 'rev-parse', 'main');
    const reviewer = agentFamily('codex');
    const implementer = agentFamily('custom');
    const pending = startReview({
      change: { kind: 'local-branch', sourceBranch: `mission/${fixture.slugs[0]}`, targetBranch: 'main' },
      revision: changeRevision(revision), baseline: changeRevision(baseline),
    }, reviewer, implementer, '2026-11-16T08:00:00.000Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' }));
    const loaded = await fixture.store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    if (loaded.kind !== 'found') { throw new Error('manual fixture mission missing'); }
    await fixture.store.save(fixtureMission(slug, {
      repositoryId: loaded.mission.repositoryId,
      title: `Manual ${name} gate repair`,
      labels: missionLabels(['ai_sdlc']),
      status: 'integration', assignee: implementer,
      checkpoints: [{ missionId: missionId(slug), name: 'CP-1', rawFilename: 'CP-1.md', firstLine: 'CP-1',
        goalCheck: [{ criterion: 'feature ships', evidence: 'feature.txt' }], nextActionText: 'integrate' }],
      brief: { goal: 'Exercise gate repair', why: 'Manual E2E proof', scope: 'feature.txt', outOfScope: [] },
      successCriteria: ['feature ships'], completedSuccessCriteria: [0], declaredGates: [':'],
      review: applyReviewerCommand(pending, { type: 'approve', revision: changeRevision(revision),
        decidedAt: '2026-11-16T08:30:00.000Z', comment: 'Approved manual fixture', source: { kind: 'local' } }),
    }), loaded.version);

    runCli(worktree, env, 'integrate', slug);
    const status = runCli(worktree, env, 'status', slug);
    const repairLines = status.split('\n').filter(line => line.includes('Repair incident:'));
    assert.equal(repairLines.length, gateKeys.length, status);
    for (const key of gateKeys) {
      assert.equal(repairLines.filter(line => line.includes(`; gate ${key};`)).length, 1, status);
    }
    const launches = fs.readFileSync(agentLog, 'utf8').trim().split('\n');
    assert.equal(launches.filter(role => role === 'implementer').length, 1, launches.join(','));
    assert.equal(launches.filter(role => role === 'review').length, 1, launches.join(','));
    const repaired = await fixture.store.load(missionId(slug));
    assert.equal(repaired.kind, 'found');
    if (repaired.kind !== 'found') { throw new Error('repaired fixture mission missing'); }
    const repairs = repaired.mission.checkpoints.filter(checkpoint => checkpoint.repair);
    assert.equal(repairs.length, gateKeys.length);
    assert.ok(repairs.every(checkpoint => checkpoint.repair?.verified), 'shared rerun certifies every repair checkpoint');
    assert.equal(new Set(repairs.map(checkpoint => checkpoint.repair?.incidentId)).size, 1,
      'all gate checkpoints use the tested-revision incident');

    runCli(worktree, env, 'integrate', slug);
    const closed = await fixture.store.load(missionId(slug));
    assert.ok(closed.kind === 'found' && closed.mission.status === 'done' && closed.mission.closedAt,
      'resumed public integrate closes the mission');
    console.log(JSON.stringify({ scenario: name, command: `px integrate ${slug}`, status: `px status ${slug}`,
      resume: `px integrate ${slug}`, repairCheckpoints: repairs.map(checkpoint => ({
        name: checkpoint.name, gateKey: checkpoint.repair?.gateKey, incidentId: checkpoint.repair?.incidentId,
        verified: checkpoint.repair?.verified,
      })), implementerHandoffs: 1, reviewerHandoffs: 1, closed: true }));
  } finally {
    await fixture.close();
  }
}

assert.ok(fs.existsSync(entry), 'run npm run build before the manual probe');
await scenario('one', ['gate-one']);
await scenario('multi', ['gate-one', 'gate-two']);
