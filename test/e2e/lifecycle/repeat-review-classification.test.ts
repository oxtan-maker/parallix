import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../../src/composition/create-cli.js';
import { createDecisionPort } from '../../../src/composition/decision.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { clearOperatorStateCache } from '../../../src/adapters/sqlite/adapter-factory.js';
import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../../src/adapters/agents/agents.js';
import { fakeLifecycleAgent } from '../../fixtures/e2e-lifecycle-fake-agent.js';
import { isolatedForgejo } from '../../fixtures/isolated-forgejo.js';
import { createTempRootRegistry } from '../../../src/adapters/verification/temp-root-registry.js';
import { childCpuUsageModule } from '../../lib/child-cpu-usage.js';

// Owns live classifier lifecycle: real CLI, Git, SQLite, gate failure, Forgejo
// publication and Jev model. Deterministic drafting/implementation use the same
// fake-agent boundary as mission-lifecycle; no model result is fabricated.
test('live Jev applies an integration-repair verdict and the standard lifecycle lands it (TASK-2667 regression)', { timeout: 240_000 }, async t => {
  assert.equal((await createDecisionPort(resolveConfiguration(process.env).decision).available()).status, 'available', 'A configured live Jev provider is required');
  const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const { waitedChildCpuUs } = createRequire(import.meta.url)(childCpuUsageModule(sourceRoot, process.execPath)) as { waitedChildCpuUs(): number };
  const cpuUs = () => {
    const own = process.cpuUsage(); return own.user + own.system + waitedChildCpuUs();
  };
  const startedCpu = cpuUs();
  const registry = createTempRootRegistry();
  const root = registry.register(fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-classifier-lifecycle-')));
  const previousEnv = { ...process.env };
  const previousCwd = process.cwd();
  const home = path.join(root, 'operator-state');
  const repo = path.join(root, 'repo');
  const slug = 'task-9001';
  const worktree = path.join(root, `repo-${slug}`);
  const transcript: string[] = [];
  let provider: Awaited<ReturnType<typeof isolatedForgejo>> | undefined;
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 15_000 }).trim();
  const write = (file: string, body: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body);
  };
  const readDb = (sql: string) => {
    const db = new DatabaseSync(path.join(home, 'parallix.db'), { readOnly: true });
    try { return db.prepare(sql).all() as Record<string, any>[]; } finally { db.close(); }
  };
  async function px(cwd: string, args: string[], allowFailure = false) {
    process.chdir(cwd);
    const lines: string[] = [];
    const stdout = process.stdout.write;
    const stderr = process.stderr.write;
    const capture = (original: typeof stdout) => ((chunk: string | Uint8Array, ...rest: any[]) => {
      if (typeof chunk !== 'string') { return (original as any).call(process.stdout, chunk, ...rest); }
      lines.push(chunk); return true;
    }) as typeof stdout;
    process.stdout.write = capture(stdout); process.stderr.write = capture(stderr);
    let status: number;
    try {
      status = await run(args, { baseCwd: cwd, log: line => { lines.push(line); return ''; }, error: line => { lines.push(line); return ''; } });
    } finally { process.stdout.write = stdout; process.stderr.write = stderr; }
    transcript.push(`px ${args.join(' ')} => ${status}`, ...lines);
    if (!allowFailure) { assert.equal(status, 0, lines.join('\n')); }
    return { status, output: lines.join('\n') };
  }
  t.after(async () => {
    process.chdir(previousCwd);
    setWorkflowLaunchPort(null); setCommandPathProbe(null); setLauncherHealthProbe(null);
    await clearOperatorStateCache();
    provider?.cleanup();
    for (const key of Object.keys(process.env)) { if (!(key in previousEnv)) { delete process.env[key]; } }
    Object.assign(process.env, previousEnv);
    registry.cleanup();
  });
  t.after(() => {
    const usedMs = (cpuUs() - startedCpu) / 1000;
    t.diagnostic(`Lifecycle CPU including waited children: ${usedMs.toFixed(0)} ms; finite case/suite budget: 15000 ms.`);
    assert.ok(usedMs <= 15_000, `Lifecycle CPU budget exceeded: ${usedMs} ms`);
  });
  try {
    fs.mkdirSync(repo, { recursive: true });
    process.env.PARALLIX_HOME = home;
    process.env.FORGEJO_HOME = path.join(root, 'forgejo');
    process.env.PRIMARY_WORKTREE = repo;
    process.env.PARALLIX_NO_BUBBLEWRAP = '1';
    process.env.PARALLIX_JEV_REVIEW = 'on';
    process.env.FORGEJO_USER = 'human';
    provider = await isolatedForgejo(process.env.FORGEJO_HOME);
    process.env.FORGEJO_URL = provider.baseUrl;
    process.env.FORGEJO_REPO = 'human/probe';
    process.env.FORGEJO_AUTHORIZED_APPROVER = 'human';
    write(path.join(repo, 'workflow.config.json'), JSON.stringify({ product: { name: 'classifier-lifecycle', targetUser: 'tests' }, adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
      agents: { models: { custom: 'stub/custom' } },
      missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      verification: { command: 'node --check answer.mjs', defaultArea: 'all' },
      review: { provider: 'forgejo', remote: 'review', baseUrl: provider.baseUrl, repo: 'human/probe', tmpDir: path.join(root, 'review-artifacts') },
      gates: { preIntegration: [{ key: 'required-output', command: 'node answer.mjs' }] },
    } }, null, 2));
    write(path.join(repo, 'config/state-map.json'), JSON.stringify({ ready: 'refined', approved: 'ready-for-integration' }));
    write(path.join(repo, `backlog/tasks/${slug} - Classifier-lifecycle.md`), `---\nid: TASK-9001\ntitle: Classifier lifecycle\nstatus: backlog\nassignee: []\nlabels: [ai_sdlc]\ndependencies: []\n---\n\n## Description\n\nPreserve required Hello output.\n`);
    write(path.join(repo, 'answer.mjs'), `const output = 'Goodbye';\nif (output !== 'Hello') { throw new Error('required Hello output is missing'); }\nconsole.log(output);\n`);
    git(repo, 'init', '-b', 'main'); git(repo, 'config', 'user.name', 'Isolated Lifecycle'); git(repo, 'config', 'user.email', 'probe@example.test');
    git(repo, 'config', 'core.hooksPath', path.join(root, 'empty-hooks'));
    git(repo, 'remote', 'add', 'review', provider.remote);
    git(repo, 'add', '.'); git(repo, 'commit', '-m', 'initial fixture');
    const remote = new URL(provider.remote);
    remote.username = 'human'; remote.password = fs.readFileSync(path.join(process.env.FORGEJO_HOME, 'tokens/human'), 'utf8');
    // Credential is passed to Git only; no command or remote containing it is logged or persisted.
    git(repo, 'push', remote.href, 'main');
    let executeLaunches = 0;
    let repairLaunches = 0;
    let reviewLaunches = 0;
    setCommandPathProbe(() => '/in-process-fake-agent');
    setLauncherHealthProbe(() => ({ ok: true }));
    setWorkflowLaunchPort(options => {
      transcript.push(`agent: ${options.prompt.match(/^Mode:.*$/m)?.[0] ?? options.prompt.slice(0, 120)}`);
      const reviewing = /^Mode: review\./m.test(options.prompt);
      if (reviewing) {
        reviewLaunches++;
        assert.equal(reviewLaunches, 1, 'Jev must apply the repair verdict without falling back to another reviewer');
      }
      const executing = /^Mode: execute after lock\./m.test(options.prompt);
      const repairing = /^[^\n]*(?:FIX REQUIRED|REPAIR REQUIRED)$/m.test(options.prompt);
      if (executing) { executeLaunches++; }
      if (repairing) { repairLaunches++; }
      const launch = fakeLifecycleAgent(options);
      return { ...launch, resultPromise: launch.resultPromise.then(result => {
        if (repairing) {
          write(path.join(options.worktree!, 'answer.mjs'), `const output = 'Hello';\nif (output !== 'Hello') { throw new Error('required Hello output is missing'); }\nconsole.log(output);\n`);
          git(options.worktree!, 'add', 'answer.mjs'); git(options.worktree!, 'commit', '-m', 'preserve required Hello output');
        }
        return result;
      }) };
    });
    await px(repo, ['draft', slug, '--agent', 'custom']);
    await px(worktree, ['active', slug, '--implementer', 'custom']);
    assert.equal(readDb('SELECT status FROM missions')[0].status, 'integration');
    const prs = await provider.api('GET', '/repos/human/probe/pulls?state=open');
    assert.equal(prs.length, 1);
    await provider.api('POST', `/repos/human/probe/pulls/${prs[0].number}/reviews`, { event: 'APPROVED', body: 'Initial fixture approval', commit_id: prs[0].head.sha });
    const failedIntegration = await px(worktree, ['integrate', slug], true);
    assert.match(failedIntegration.output, /required-output/);
    const rounds = readDb('SELECT * FROM mission_review_rounds ORDER BY position');
    assert.equal(rounds[0].revoked_cause, 'integration-gate-failure');
    assert.match(rounds[0].revoked_gate_log, new RegExp(`${worktree}/answer.mjs`));
    assert.equal(executeLaunches, 1);
    assert.equal(repairLaunches, 1, 'the normal integration rebound must run the repair implementer');
    assert.equal(reviewLaunches, 1);
    const classified = readDb('SELECT * FROM mission_review_rounds WHERE classifier_source IS NOT NULL');
    assert.equal(classified.length, 1, transcript.join('\n'));
    assert.equal(classified[0].decision_kind, 'approved');
    const source = JSON.parse(classified[0].classifier_source);
    assert.equal(source.identity, 'jev');
    assert.equal(source.integrationRepair.revokedAt, rounds[0].revoked_at);
    assert.equal(source.candidateRevision, classified[0].revision);
    const measurements = readDb('SELECT samples FROM review_classifier_measurements').flatMap(row => JSON.parse(row.samples));
    assert.ok(measurements.some(row => row.model && row.classificationMs !== null && row.route === 'clear'), 'live Jev call must clear the packet');
    const reviews = await provider.api('GET', `/repos/human/probe/pulls/${prs[0].number}/reviews`);
    assert.ok(reviews.some((review: any) => review.user.login === 'jev' && review.state === 'APPROVED' && review.commit_id === source.candidateRevision));
    // A lane transition commits locally after the last push, so the PR head trails the revision Jev judged (TASK-2675).
    const pushedHead = git(worktree, 'rev-parse', 'HEAD');
    git(worktree, 'commit', '--allow-empty', '-m', 'backlog: local lane transition');
    const localRevision = git(worktree, 'rev-parse', 'HEAD');
    assert.notEqual(localRevision, pushedHead);
    const { createReviewClassification } = await import('../../../src/composition/review-classification.js');
    const { resolveConfiguration } = await import('../../../src/composition/config.js');
    assert.equal(await createReviewClassification(slug, worktree, resolveConfiguration(process.env).decision).publish({ ...source, candidateRevision: localRevision }, 'clear', 'Classifier cleared the prior findings. [TASK-2675]'), true,
      'Jev publication must not depend on the PR head matching a later local revision');
    git(worktree, 'reset', '--hard', pushedHead);
    assert.equal(readDb('SELECT status FROM missions')[0].status, 'integration');
    await provider.api('POST', `/repos/human/probe/pulls/${prs[0].number}/reviews`, { event: 'APPROVED', body: 'Integrate repaired fixture', commit_id: source.candidateRevision });
    await px(worktree, ['integrate', slug]);
    assert.equal(readDb('SELECT status FROM missions')[0].status, 'done');
    assert.deepEqual(readDb('SELECT id FROM missions').map(row => row.id), [slug]);
    assert.equal(readDb('PRAGMA integrity_check')[0].integrity_check, 'ok');
    assert.equal(fs.existsSync(worktree), false);
    assert.match(git(repo, 'show', 'main:answer.mjs'), /const output = 'Hello'/);
    t.diagnostic(`Live Jev ${source.provider}/${source.model}: approved ${source.candidateRevision}; real Forgejo publication, isolated SQLite approval and integration closeout verified.`);
  } catch (error) {
    if (fs.existsSync(worktree)) {
      const first = readDb('SELECT revision FROM mission_review_rounds ORDER BY position LIMIT 1')[0];
      if (first) { t.diagnostic(git(worktree, 'diff', first.revision, 'HEAD')); }
    }
    t.diagnostic(transcript.join('\n').split('\n').filter(Boolean).slice(-100).join('\n')); throw error;
  }
});
