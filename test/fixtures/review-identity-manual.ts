/** Public CLI observation against disposable Git, SQLite and a loopback provider. No model traffic. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { fixtureMission } from './mission-builders.js';
import { resolveCanonicalRepositoryId } from '../../src/adapters/git/repository-identity.js';
import { agentFamily } from '../../src/domain/agents.js';
import { missionLabels } from '../../src/domain/mission.js';
import { startReview, changeRevision, ConfiguredReviewerEligibility } from '../../src/domain/review.js';

const cli = path.resolve(process.env.MANUAL_PX_ENTRY || 'build/px.mjs');
const failures: string[] = [];
for (const scenario of ['publication', 'fallback-publication', 'fallback-pr-retry', 'single-family', 'independent-approval', 'self-author', 'original-drift-approval', 'identity-drift', 'wrong-author-pr'] as const) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-review-identity-'));
  const base = path.join(root, 'repo');
  const worktree = `${base}-px-97781`;
  const home = path.join(root, 'home');
  const forgejo = path.join(root, 'forgejo');
  const bare = path.join(root, 'review.git');
  const bin = path.join(root, 'bin');
  const slug = 'px-97781';
  const db = new SqliteDatabaseAdapter();
  const approval = ['single-family', 'independent-approval', 'self-author', 'original-drift-approval'].includes(scenario);
  let pr: Record<string, unknown> | null = approval || scenario === 'wrong-author-pr' || scenario === 'fallback-pr-retry' ? {
    number: 739, user: { login: scenario === 'independent-approval' ? 'codex' : scenario === 'fallback-pr-retry' ? 'manual' : 'claude' }, head: { ref: `mission/${slug}` }, base: { ref: 'main' }, state: 'open',
  } : null;
  const publications: string[] = [];
  const provider = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) { body += chunk; }
    const url = new URL(request.url!, 'http://fixture');
    const api = url.pathname.replace('/api/v1/repos/manual/repo', '');
    let data: unknown = [];
    if (request.method === 'POST' && api === '/pulls') {
      const author = String(request.headers.authorization).replace('token ', '').replace('-token', '');
      publications.push(author);
      pr = { number: 739, user: { login: author }, head: { ref: `mission/${slug}` }, base: { ref: 'main' }, state: 'open',
        html_url: `http://fixture/manual/repo/pulls/739` };
      data = pr;
    } else if (api === '/pulls') { data = pr ? [pr] : []; }
    else if (api === '/pulls/739') { data = pr; }
    else if (api === '/pulls/739/reviews' && request.method === 'POST') {
      data = { id: 1, state: 'APPROVED', user: { login: 'claude' } };
    }
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(data));
  });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(provider.address() as import('node:net').AddressInfo).port}`;
    const env = { PATH: `${bin}:${process.env.PATH}`, HOME: root, PARALLIX_HOME: home, FORGEJO_HOME: forgejo,
      FORGEJO_URL: origin, FORGEJO_REPO: 'manual/repo', PRIMARY_WORKTREE: base, PARALLIX_MISSION_TERMINAL: slug, PARALLIX_NO_TUI: '1' };
    const git = (cwd: string, ...args: string[]) => {
      const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
    };
    fs.mkdirSync(base); fs.mkdirSync(home); fs.mkdirSync(bin); fs.mkdirSync(path.join(forgejo, 'tokens'), { recursive: true }); fs.mkdirSync(bare);
    fs.writeFileSync(path.join(root, '.bashrc'), `export PATH='${bin}':$PATH\n`);
    for (const family of ['claude', 'codex']) { fs.writeFileSync(path.join(bin, family), '#!/bin/sh\nexit 0\n', { mode: 0o755 }); }
    for (const family of ['claude', 'codex', 'human', 'manual']) { fs.writeFileSync(path.join(forgejo, 'tokens', family), `${family}-token`); }
    if (scenario === 'fallback-publication') { fs.unlinkSync(path.join(forgejo, 'tokens', 'codex')); }
    git(base, 'init', '-qb', 'main'); git(base, 'config', 'user.name', 'Fixture'); git(base, 'config', 'user.email', 'fixture@example.invalid');
    git(bare, 'init', '--bare', '-qb', 'main');
    fs.writeFileSync(path.join(base, 'payload.txt'), 'unique implementation\n');
    fs.writeFileSync(path.join(base, 'check.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(base, 'workflow.config.json'), JSON.stringify({ adapters: {
      terminal: { host: 'pipe' }, verification: { command: './check.sh' },
      review: { provider: 'forgejo', baseUrl: origin, repo: 'manual/repo', remote: 'review' },
    } }));
    if (scenario === 'single-family') {
      fs.mkdirSync(path.join(base, 'backlog', 'tasks'), { recursive: true });
      fs.writeFileSync(path.join(base, 'backlog', 'tasks', `${slug} - intake.md`), `---\nid: ${slug}\ntitle: Intake\nstatus: active\nassignee: [claude]\n---\n`);
      fs.mkdirSync(path.join(base, 'config'));
      fs.writeFileSync(path.join(base, 'config', 'agents.json'), JSON.stringify({ steps: { review: { eligible: ['claude'], selection: 'random' } } }));
    }
    git(base, 'add', '.'); git(base, 'commit', '-qm', 'base');
    git(base, 'remote', 'add', 'review', bare); git(base, 'push', '-q', 'review', 'main');
    for (const family of ['codex', 'claude', 'human', 'manual']) {
      git(base, 'config', '--add', `url.${bare}.insteadOf`, origin.replace('http://', `http://${family}:${family}-token@`) + '/manual/repo.git');
    }
    git(base, 'worktree', 'add', '-qb', `mission/${slug}`, worktree);
    fs.writeFileSync(path.join(worktree, 'unique.txt'), 'mission intent\n'); git(worktree, 'add', '.'); git(worktree, 'commit', '-qm', 'implementation');
    const head = git(worktree, 'rev-parse', 'HEAD'); const baseHead = git(base, 'rev-parse', 'HEAD');
    const review = startReview({ change: { kind: 'pull-request', provider: 'forgejo', id: '739', url: null,
      sourceBranch: `mission/${slug}`, targetBranch: 'main' }, revision: changeRevision(head) }, agentFamily('claude'), agentFamily(scenario === 'single-family' ? 'claude' : 'codex'),
    '2026-10-19T10:00:00Z', ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('claude')], strategy: 'random' }));
    await db.open({ path: path.join(home, 'parallix.db') }); await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    const store = new SqliteMissionStore(db);
    await store.save(fixtureMission(slug, { repositoryId: resolveCanonicalRepositoryId(base),
      status: approval ? 'review' : 'active',
      assignee: agentFamily(scenario === 'identity-drift' || scenario === 'original-drift-approval' || scenario === 'single-family' ? 'claude' : 'codex'), review,
      labels: missionLabels(['user_value']), brief: { goal: 'Retain payload', why: 'Manual identity observation', scope: 'disposable state', outOfScope: ['real state'] },
      successCriteria: ['Retain payload'], completedSuccessCriteria: [0], predictedNelBucket: 'Small', declaredGates: ['./check.sh'],
      checkpoints: [{ missionId: fixtureMission(slug).id, name: 'CP-1',
        goalCheck: [{ criterion: 'Retain payload', evidence: 'payload.txt' }], nextActionText: 'review' }],
    }), null);
    const args = approval ? ['review', slug, '--submit-review', 'approve', '--message', 'looks good'] : ['review', slug, '--submit'];
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      child = spawn(process.execPath, [cli, ...args], { cwd: base, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout!.on('data', chunk => { output += chunk; }); child.stderr!.on('data', chunk => { output += chunk; });
      const timer = setTimeout(() => { child!.kill('SIGKILL'); reject(new Error('public CLI timeout')); }, 30_000);
      child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', code => { clearTimeout(timer); resolve({ code, output }); });
    });
    console.log(JSON.stringify({ scenario, args, ...result, publications }));
    const loaded = await store.load(fixtureMission(slug).id); assert.equal(loaded.kind, 'found');
    if (loaded.kind !== 'found') { throw new Error('missing fixture'); }
    if (scenario === 'publication' || scenario === 'fallback-publication' || scenario === 'fallback-pr-retry') {
      assert.deepEqual(publications, scenario === 'fallback-pr-retry' ? [] : [scenario === 'publication' ? 'codex' : 'manual']); assert.equal(result.code, 0, result.output);
      assert.equal(loaded.mission.assignee, 'codex'); assert.equal(loaded.mission.review!.rounds.at(-1)!.implementer, 'codex');
      assert.notEqual(loaded.mission.review!.rounds.at(-1)!.reviewer, 'codex');
    } else if (scenario === 'single-family' || scenario === 'independent-approval') {
      assert.equal(result.code, 0, result.output);
      assert.equal(loaded.mission.status, 'integration');
      assert.equal(loaded.mission.review!.rounds.at(-1)!.decision?.kind, 'approved');
      if (scenario === 'single-family') {
        assert.match(fs.readFileSync(path.join(worktree, 'backlog', 'tasks', `${slug} - intake.md`), 'utf8'), /^status: review$/m);
        assert.equal(git(worktree, 'status', '--porcelain'), '', 'Backlog mirror transition is committed before return');
      }
    } else {
      assert.notEqual(result.code, 0, 'identity drift/self-author approval must stop');
      assert.deepEqual(publications, []); assert.equal(loaded.mission.review!.rounds.at(-1)!.decision, null);
      assert.notEqual(loaded.mission.status, 'integration');
      if (scenario === 'wrong-author-pr') { assert.match(result.output, /authorship is immutable/); }
    }
    assert.equal(git(base, 'rev-parse', 'HEAD'), baseHead); assert.equal(git(base, 'status', '--porcelain'), '');
    console.log(`PASS ${scenario}`);
  } catch (error) { failures.push(`${scenario}: ${error instanceof Error ? error.message : error}`); }
  finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); }
    await db.close(); await new Promise<void>(resolve => provider.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true });
  }
}
assert.deepEqual(failures, []);
