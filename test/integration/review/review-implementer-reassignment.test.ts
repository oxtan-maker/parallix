// Public continuation boundary: reassignment, rebase, publication and independent
// review share real disposable Git/SQLite state. Only the model launcher is fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { openRepairFixture } from '../../lib/integration-repair-fixture.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { startReview, changeRevision, ConfiguredReviewerEligibility, currentReviewRound, reviewStatus } from '../../../src/domain/review.js';
import { run as runCli } from '../../../src/composition/create-cli.js';
import { setLogger } from '../../../src/application/presentation/cli-format.js';
import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../../src/adapters/agents/agents.js';

test('continued review preserves the Codex PR after Claude reassignment (TASK-2784)', { timeout: 3500 }, async t => {
  const fixture = await openRepairFixture({ slug: 'task-reassignment', state: 'undecided-review' });
  t.after(() => fixture.close());
  const { root, repo, worktree, slug, git } = fixture;
  const branch = `mission/${slug}`;
  const url = 'http://fixture/repo/pulls/739';
  const priorComment = { id: 41, body: 'Prior discussion', user: { login: 'codex' } };
  const priorReview = { id: 42, state: 'COMMENT', body: 'Prior review', user: { login: 'custom' } };
  // A worker keeps sync curl calls from blocking the loopback server. The test
  // runner owns the worker lifetime even on timeout, signal or process exit.
  const provider = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const http = require('node:http');
    const pr = { number: 739, html_url: workerData.url, state: 'open', user: { login: 'codex' },
      head: { ref: workerData.branch }, base: { ref: 'main' } };
    const mutations = [];
    const comments = [workerData.priorComment]; const reviews = [workerData.priorReview];
    const server = http.createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const route = new URL(req.url, 'http://fixture').pathname.replace('/api/v1/repos/fixture/repo', '');
      if (req.method !== 'GET') mutations.push({ method: req.method, route, body: raw });
      let data = [];
      if (route === '/pulls') data = [pr];
      else if (route === '/pulls/739' || route === '/pulls/main/' + workerData.branch) data = pr;
      else if (route === '/pulls/739/reviews') data = reviews;
      else if (route === '/issues/739/comments') data = comments;
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data));
    });
    server.listen(0, '127.0.0.1', () => parentPort.postMessage({ port: server.address().port }));
    parentPort.on('message', () => parentPort.postMessage({ pr, mutations, comments, reviews }));
  `, { eval: true, workerData: { branch, url, priorComment, priorReview } });
  t.after(() => provider.terminate());
  const { port } = await new Promise<{ port: number }>((resolve, reject) => { provider.once('message', resolve); provider.once('error', reject); });
  const origin = `http://127.0.0.1:${port}`;
  const forgejo = path.join(root, 'forgejo');
  fs.mkdirSync(path.join(forgejo, 'tokens'), { recursive: true });
  for (const user of ['codex', 'claude', 'custom', 'fixture']) fs.writeFileSync(path.join(forgejo, 'tokens', user), `${user}-token`);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(process.env.PARALLIX_TEST_REAL_CURL || '/usr/bin/curl', path.join(bin, 'curl'));
  const overrides = { PATH: `${bin}:${process.env.PATH}`,  FORGEJO_HOME: forgejo, FORGEJO_URL: origin, FORGEJO_REPO: 'fixture/repo', PARALLIX_TEST_NO_FORGEJO: '0' };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const bare = path.join(root, 'review.git');
  fs.mkdirSync(bare); git(bare, ['init', '--bare', '-b', 'main']);
  git(repo, ['remote', 'add', 'review', bare]);
  const configPath = path.join(worktree, 'workflow.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.adapters.review = { provider: 'forgejo', baseUrl: origin, repo: 'fixture/repo', remote: 'review' };
  fs.writeFileSync(configPath, JSON.stringify(config));
  fs.writeFileSync(path.join(worktree, 'config/agents.json'), JSON.stringify({ steps: {
    active: { eligible: ['codex', 'claude', 'custom'], selection: 'random' },
    review: { eligible: ['custom'], selection: 'random' },
  } }));
  const taskPath = path.join(worktree, 'backlog/tasks', `${slug} - Fixture.md`);
  fs.writeFileSync(taskPath, fs.readFileSync(taskPath, 'utf8').replace('ready-for-integration', 'review').replace('[custom]', '[codex]'));
  git(worktree, ['add', '.']); git(worktree, ['commit', '-m', 'seed Codex publication']);
  git(worktree, ['push', '-q', 'review', branch]);
  const oldHead = git(worktree, ['rev-parse', 'HEAD']);
  // Advance main to force an observable rebase on continuation.
  fs.writeFileSync(path.join(repo, 'base-advance.txt'), 'new base\n');
  git(repo, ['add', '.']); git(repo, ['commit', '-m', 'advance primary']);
  const baseHead = git(repo, ['rev-parse', 'HEAD']);
  for (const user of ['codex', 'claude', 'custom', 'fixture']) {
    git(repo, ['config', '--add', `url.${bare}.insteadOf`, origin.replace('http://', `http://${user}:${user}-token@`) + '/fixture/repo.git']);
  }
  const mission = await fixture.load();
  const review = startReview({ change: { kind: 'pull-request', provider: 'forgejo', id: '739', url,
    sourceBranch: branch, targetBranch: 'main' }, revision: changeRevision(oldHead) }, agentFamily('custom'), agentFamily('codex'),
    '2026-10-19T10:00:00Z', ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('custom')], strategy: 'random' }));
  await new SqliteMissionStore(fixture.database).save({ ...mission, assignee: agentFamily('codex'), review }, missionVersion(await fixture.version()));
  const messages: string[] = [];
  const logger = setLogger({ log: message => { messages.push(String(message)); }, error: message => { messages.push(String(message)); } });
  t.after(() => { setLogger(logger); setWorkflowLaunchPort(null); setCommandPathProbe(null); setLauncherHealthProbe(null); });
  const invoke = (args: string[]) => runCli(args, { baseCwd: worktree, log: m => { messages.push(m); return m; }, error: m => { messages.push(m); return m; } });
  const reviewers: string[] = [];
  let reviewedHead = '';
  setCommandPathProbe(() => '/fixture-agent');
  setLauncherHealthProbe(() => ({ ok: true as const }));
  setWorkflowLaunchPort(({ prompt, worktree: cwd }) => ({
    invocation: { command: 'fixture-agent', args: [], options: { cwd } },
    resultPromise: (async () => {
      assert.match(prompt, /^Mode: review\./m);
      const current = await fixture.load();
      const round = currentReviewRound(current.review!);
      reviewers.push(String(round.reviewer));
      reviewedHead = git(worktree, ['rev-parse', 'HEAD']);
      assert.equal(round.implementer, 'claude');
      assert.equal(round.reviewer, 'custom');
      assert.equal(await invoke(['verdict', 'approve', '--slug', slug, '--actor', 'custom', '--comment', 'Independent revision reviewed']), 0, messages.join('\n'));
      return { status: 0, stdout: '', stderr: '' };
    })(),
  }));
  const args = ['review', slug, '--continue', '--implementer', 'claude', '--reviewer', 'custom'];
  assert.equal(await invoke(args), 0, messages.join('\n'));
  const persisted = await fixture.load();
  assert.equal(persisted.assignee, 'claude');
  assert.equal(currentReviewRound(persisted.review!).implementer, 'claude');
  assert.deepEqual(reviewers, ['custom']);
  assert.equal(reviewStatus(persisted.review!), 'approved', messages.join('\n'));
  const head = git(worktree, ['rev-parse', 'HEAD']);
  assert.equal(currentReviewRound(persisted.review!).decision?.revision, reviewedHead);
  assert.notEqual(head, oldHead);
  assert.equal(git(worktree, ['merge-base', 'HEAD', 'main']), baseHead);
  assert.equal(git(bare, ['rev-parse', `refs/heads/${branch}`]), reviewedHead);
  provider.postMessage('snapshot');
  const snapshot = await new Promise<{ pr: { number: number; html_url: string; user: { login: string }; state: string }; mutations: Array<{ method: string; route: string }>; comments: unknown[]; reviews: unknown[] }>(resolve => provider.once('message', resolve));
  assert.deepEqual(snapshot.pr, { number: 739, html_url: url, state: 'open', user: { login: 'codex' }, head: { ref: branch }, base: { ref: 'main' } });
  assert.deepEqual(snapshot.comments, [priorComment]);
  assert.deepEqual(snapshot.reviews, [priorReview]);
  assert.ok(snapshot.mutations.every(m => m.route !== '/pulls' && m.route !== '/pulls/739'), JSON.stringify(snapshot.mutations));
  assert.equal(git(repo, ['rev-parse', 'HEAD']), baseHead);
  t.diagnostic(`px ${args.join(' ')}: PR #739 ${url}, author=codex, implementer=${persisted.assignee}, reviewer=${reviewers[0]}, approval=${reviewStatus(persisted.review!)}, published=${reviewedHead}`);
});
