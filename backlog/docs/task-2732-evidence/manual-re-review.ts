// Manual public CLI probe; not a discovered E2E suite. Disposable Git/SQLite/Forgejo.
// Decision HTTP responses and reviewer effects are controlled; no model accuracy claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from '../../../src/composition/create-cli.js';
import { createMissionApplicationServices } from '../../../src/composition/application-services.js';
import { clearOperatorStateCache } from '../../../src/adapters/sqlite/adapter-factory.js';
import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../../src/adapters/agents/agents.js';
import { fakeLifecycleAgent } from '../../../test/fixtures/e2e-lifecycle-fake-agent.js';
import { isolatedForgejo } from '../../../test/fixtures/isolated-forgejo.js';
import { fixtureMission } from '../../../test/fixtures/mission-builders.js';
import { repeatReview } from '../../../test/fixtures/repeat-review.js';
import { changeRevision } from '../../../src/domain/review.js';
import { DatabaseSync } from 'node:sqlite';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-manual-re-review-'));
const previousCwd = process.cwd();
const previousEnv = { ...process.env };
const previousFetch = globalThis.fetch;
let provider: Awaited<ReturnType<typeof isolatedForgejo>> | undefined;
const packets: Record<string, any>[] = [];
const transcript: string[] = [];
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 15000 }).trim();
const write = (file: string, body: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
try {
  process.env.PARALLIX_HOME = path.join(root, 'home');
  process.env.FORGEJO_HOME = path.join(root, 'forgejo');
  process.env.PARALLIX_NO_BUBBLEWRAP = '1';
  process.env.PARALLIX_JEV_REVIEW = 'on';
  process.env.JEV_CODE_PROVIDER = 'typesafe';
  process.env.TYPESAFE_API_KEY = 'isolated-fake-key';
  process.env.TYPESAFE_BASE_URL = 'https://decision.invalid';
  delete process.env.OPENROUTER_API_KEY; delete process.env.AI_GATEWAY_API_KEY;
  process.env.FORGEJO_USER = 'custom';
  provider = await isolatedForgejo(process.env.FORGEJO_HOME);
  process.env.FORGEJO_URL = provider.baseUrl;
  process.env.FORGEJO_REPO = 'human/probe';
  globalThis.fetch = async (request, options) => {
    if (String(request).startsWith('https://decision.invalid/')) {
      const packet = JSON.parse(String(options?.body)); packets.push(packet);
      return Response.json({ model: 'jev-latest', answers: Object.fromEntries(Object.keys(packet.questions).map(id => [id,
        { type: 'choice', choice: 'addresses', probabilities: { addresses: 1, does_not_address: 0, insufficient_evidence: 0 }, confidence: 1 }])) });
    }
    return previousFetch(request, options);
  };
  setCommandPathProbe(() => '/controlled-manual-agent');
  setLauncherHealthProbe(() => ({ ok: true }));
  setWorkflowLaunchPort(options => fakeLifecycleAgent(options));
  for (const [index, mode] of ['repair', 'budget', 'preparation'].entries()) {
    const slug = `task-9${index}01`;
    const repo = path.join(root, `repo-${mode}`);
    const worktree = `${repo}-${slug}`;
    process.env.PRIMARY_WORKTREE = repo;
    write(path.join(repo, 'workflow.config.json'), JSON.stringify({ product: { name: 'manual-re-review', targetUser: 'probe' }, adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
      agents: { models: { custom: 'stub/custom' } },
      missions: { branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      verification: { command: 'node -e ""' },
      review: { provider: 'forgejo', remote: 'review', baseUrl: provider.baseUrl, repo: 'human/probe', tmpDir: path.join(root, 'artifacts') },
    } }));
    write(path.join(repo, 'config/state-map.json'), JSON.stringify({ approved: 'ready-for-integration' }));
    write(path.join(repo, `backlog/tasks/${slug} - Probe with spaces.md`), `---\nid: ${slug.toUpperCase()}\ntitle: Probe\nstatus: review\nassignee: [custom]\nlabels: [ai_sdlc]\n---\n\n## Description\n\nProbe review.\n`);
    write(path.join(repo, 'answer.mjs'), 'export const answer = 1;\n');
    write(path.join(repo, 'failure.ts'), 'broken\n');
    if (mode === 'budget') { write(path.join(repo, 'large-context.ts'), 'export const context = [' + '12345,'.repeat(20000) + '];\n'); }
    git(repo, 'init', '-qb', 'main'); git(repo, 'config', 'user.name', 'Manual Probe'); git(repo, 'config', 'user.email', 'probe@example.test');
    git(repo, 'config', 'core.hooksPath', path.join(root, 'empty-hooks'));
    git(repo, 'remote', 'add', 'review', provider.remote);
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base'); const base = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'worktree', 'add', '-qb', `mission/${slug}`, worktree);
    write(path.join(worktree, 'answer.mjs'), 'export const answer = 2;\n');
    git(worktree, 'add', '-A'); git(worktree, 'commit', '-qm', 'prior'); const prior = git(worktree, 'rev-parse', 'HEAD');
    write(path.join(repo, 'failure.ts'), 'fixed-by-main\n');
    write(path.join(repo, 'main-only.ts'), 'unrelated main change\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'main fix'); const main = git(repo, 'rev-parse', 'HEAD');
    git(worktree, 'rebase', '-q', 'main');
    const spaced = `backlog/tasks/${slug} - Probe with spaces.md`;
    if (mode === 'preparation') {
      git(worktree, 'rm', '-q', 'failure.ts', 'answer.mjs');
    } else {
      write(path.join(worktree, spaced), fs.readFileSync(path.join(worktree, spaced), 'utf8') + '\nuncited-spaced-repair\n');
      if (mode === 'budget') { write(path.join(worktree, 'large-context.ts'), fs.readFileSync(path.join(worktree, 'large-context.ts'), 'utf8') + '// repair\n'); }
    }
    git(worktree, 'add', '-A'); git(worktree, 'commit', '-qm', 'repair'); const candidate = git(worktree, 'rev-parse', 'HEAD');
    const url = new URL(provider.remote); url.username = 'human'; url.password = fs.readFileSync(path.join(process.env.FORGEJO_HOME!, 'tokens/human'), 'utf8');
    git(repo, 'push', '-q', '--force', url.href, 'main');
    git(worktree, 'push', '-q', url.href, `mission/${slug}`);
    for (let attempt = 0; ; attempt++) {
      const branches = await provider.api('GET', '/repos/human/probe/branches');
      if (branches?.some((branch: { name: string }) => branch.name === `mission/${slug}`)) { break; }
      if (attempt >= 30) { throw new Error('Disposable Forgejo did not observe pushed branch'); }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const pr = await provider.api('POST', '/repos/human/probe/pulls', { title: mode, head: `mission/${slug}`, base: 'main' });
    process.chdir(worktree);
    const services = await createMissionApplicationServices(worktree);
    const review = repeatReview();
    review.rounds = review.rounds.map((round, position) => ({ ...round, reviewer: 'custom' as never, implementer: 'custom' as never,
      subject: { change: { kind: 'pull-request', provider: 'forgejo', id: String(pr.number), url: pr.html_url, sourceBranch: `mission/${slug}`, targetBranch: 'main' },
        revision: changeRevision(position ? candidate : prior), baseline: position ? main : base },
      ...(position ? {} : { decision: { kind: 'changes-requested', decidedAt: new Date().toISOString(), comment: 'Fix failure.ts',
        findings: [{ id: 'F1' as never, summary: 'failure.ts is broken', location: 'failure.ts:1' }] },
        implementerResponseContent: 'The failure was fixed by main', response: { kind: 'resolved', respondedAt: new Date().toISOString(), resultingRevision: changeRevision(candidate), resolutions: [{ findingId: 'F1' as never, kind: 'fixed', evidence: 'main fixed failure' }] } }),
    }));
    await services.store.save(fixtureMission(slug, { repositoryId: services.repositoryId, status: 'review', assignee: 'custom' as never, review, checkpoints: [] }), null);
    const start = packets.length;
    const status = await run(['review', slug, '--continue', '--reviewer', 'custom', '--max-attempts', '1', '--poll-timeout-seconds', '2'], {
      baseCwd: worktree, log: line => { transcript.push(line); return ''; }, error: line => { transcript.push(line); return ''; },
    });
    const db = new DatabaseSync(path.join(process.env.PARALLIX_HOME!, 'parallix.db'), { readOnly: true });
    const measurements = db.prepare('SELECT samples FROM review_classifier_measurements').all().flatMap(row => JSON.parse(String(row.samples))).filter(row => row.mission === slug);
    db.close();
    console.log(JSON.stringify({ mode, status, calls: packets.length - start, measurements }));
    if (mode === 'preparation') {
      assert.equal(packets.length - start, 0);
      assert.ok(measurements.some(row => row.reason === 'evidence-preparation-fallback' && row.panel.calls === 0));
    } else {
      assert.equal(packets.length - start, 3);
      const state = packets[start].state;
      assert.equal(state.missionRange.approved.baseline, base); assert.equal(state.missionRange.candidate.baseline, main);
      assert.match(JSON.stringify(state.mainCommits), /fixed-by-main/);
      assert.doesNotMatch(state.diff, /unrelated main change/);
      assert.ok(state.changedPaths.includes(spaced)); assert.match(state.diff, /uncited-spaced-repair/);
      if (mode === 'budget') { assert.match(state.contextOmissions.join('\n'), /large-context.ts: complete candidate file omitted/); }
      console.log(JSON.stringify({ mode, state }));
    }
  }
  console.log('MANUAL_SMOKE_PASS');
} catch (error) {
  console.error(transcript.slice(-70).join('\n')); throw error;
} finally {
  process.chdir(previousCwd); globalThis.fetch = previousFetch;
  setWorkflowLaunchPort(null); setCommandPathProbe(null); setLauncherHealthProbe(null);
  await clearOperatorStateCache(); provider?.cleanup();
  for (const key of Object.keys(process.env)) { if (!(key in previousEnv)) { delete process.env[key]; } }
  Object.assign(process.env, previousEnv); fs.rmSync(root, { recursive: true, force: true });
}
