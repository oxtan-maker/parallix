/** Public-CLI publication recovery against disposable Git, SQLite and loopback Forgejo. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { resolveCanonicalRepositoryId } from '../../src/adapters/git/repository-identity.js';
import { agentFamily } from '../../src/domain/agents.js';
import { missionId, missionLabels } from '../../src/domain/mission.js';
import { beginNextReviewRound, changeRevision, ConfiguredReviewerEligibility, startReview } from '../../src/domain/review.js';
import { parseReviewPublication } from '../../src/adapters/review/review-publication.js';
import { run as runCli } from '../../src/composition/create-cli.js';
import { fixtureMission } from './mission-builders.js';
import { pxNodeArgs, type PxEntryLoader } from '../lib/px-entry.js';

export type ReviewPublicationRecoveryObservation = {
  exits: Array<number | null>;
  comments: number;
  reviews: number;
  completedPublications: number;
  uniquePublicationMarkers: number;
  usageRows: number;
  cleaned: boolean;
};

export async function exerciseReviewPublicationRecoveryCli(cli: PxEntryLoader): Promise<ReviewPublicationRecoveryObservation> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-review-publication-'));
  const worktree = path.join(root, 'repo');
  const operatorHome = path.join(root, 'operator');
  const forgejoHome = path.join(root, 'forgejo');
  const slug = 'task-97782';
  const comments: Array<Record<string, unknown>> = [];
  const reviews: Array<Record<string, unknown>> = [];
  let interruptNextComment = true;
  let provider: http.Server | null = null;
  const database = new SqliteDatabaseAdapter();
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-C', worktree, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  try {
    fs.mkdirSync(worktree, { recursive: true });
    fs.mkdirSync(operatorHome, { recursive: true });
    fs.mkdirSync(path.join(forgejoHome, 'tokens'), { recursive: true });
    git('init', '-qb', `mission/${slug}`);
    git('config', 'user.name', 'Disposable publication exercise');
    git('config', 'user.email', 'fixture@example.invalid');
    fs.writeFileSync(path.join(worktree, 'payload.txt'), 'isolated publication recovery\n');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    git('worktree', 'add', '-qb', 'main', path.join(root, 'base'));
    const pull = { number: 739, html_url: 'http://fixture/manual/repo/pulls/739', user: { login: 'codex' },
      head: { ref: `mission/${slug}`, sha: git('rev-parse', 'HEAD') }, base: { ref: 'main' }, state: 'open' };

    provider = http.createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) { raw += chunk; }
      const url = new URL(request.url!, 'http://fixture');
      const api = url.pathname.replace('/api/v1/repos/manual/repo', '');
      const actor = String(request.headers.authorization ?? '').replace('token ', '').replace('-token', '') || 'unknown';
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      const laterPage = Number(url.searchParams.get('page') ?? 1) > 1;
      let data: unknown = [];
      if (api === '/pulls') { data = laterPage ? [] : [pull]; }
      else if (/^\/pulls\/main\//.test(api)) { data = [pull]; }
      else if (api === '/pulls/739') { data = pull; }
      else if (api === '/issues/739/comments' && request.method === 'GET') { data = laterPage ? [] : comments; }
      else if (api === '/pulls/739/reviews' && request.method === 'GET') { data = laterPage ? [] : reviews; }
      else if (/^\/pulls\/739\/reviews\/[^/]+\/comments$/.test(api)) { data = []; }
      else if (api === '/issues/739/comments' && request.method === 'POST') {
        const record = { id: comments.length + 1, body: String(body.body ?? ''), user: { login: actor },
          created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        comments.push(record);
        if (interruptNextComment) { interruptNextComment = false; request.socket.destroy(); return; }
        data = record;
      } else if (api === '/pulls/739/reviews' && request.method === 'POST') {
        const record = { id: reviews.length + 1, body: String(body.body ?? ''), state: String(body.event ?? ''),
          commit_id: body.commit_id ?? pull.head.sha, user: { login: actor }, submitted_at: new Date().toISOString(), dismissed: false };
        reviews.push(record);
        data = record;
      }
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(data));
    });
    await new Promise<void>(resolve => provider!.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(provider.address() as import('node:net').AddressInfo).port}`;
    fs.writeFileSync(path.join(worktree, 'workflow.config.json'), JSON.stringify({ adapters: {
      review: { provider: 'forgejo', baseUrl: origin, repo: 'manual/repo', remote: 'review' },
    } }));
    git('add', '.');
    git('commit', '-qm', 'configure controlled provider');
    const revision = git('rev-parse', 'HEAD');
    pull.head.sha = revision;
    for (const actor of ['claude', 'codex']) {
      fs.writeFileSync(path.join(forgejoHome, 'tokens', actor), `${actor}-token`);
    }

    await database.open({ path: path.join(operatorHome, 'parallix.db') });
    await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
    const store = new SqliteMissionStore(database);
    const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('claude')], strategy: 'random' });
    const review = startReview({ change: { kind: 'pull-request', provider: 'forgejo', id: '739', url: pull.html_url,
      sourceBranch: `mission/${slug}`, targetBranch: 'main' }, revision: changeRevision(revision) },
    agentFamily('claude'), agentFamily('codex'), new Date().toISOString(), eligibility);
    await store.save(fixtureMission(slug, { repositoryId: resolveCanonicalRepositoryId(worktree), status: 'review', rawStatus: 'review',
      assignee: agentFamily('codex'), labels: missionLabels(['ai_sdlc']), review }), null);

    const env: NodeJS.ProcessEnv = { ...process.env, PARALLIX_HOME: operatorHome, FORGEJO_HOME: forgejoHome,
      FORGEJO_URL: origin, FORGEJO_REPO: 'manual/repo', PARALLIX_NO_TUI: '1', PARALLIX_NO_BUBBLEWRAP: '1' };
    // Native test coverage cannot attribute the prebuilt bundle back to src/.
    // Do not make these intentionally restarted CLI children emit redundant raw
    // V8 payloads into the parent test runner's scratch directory. They can
    // share an isolated compile cache because none contributes source coverage.
    delete env.NODE_V8_COVERAGE;
    delete env.NODE_DISABLE_COMPILE_CACHE;
    env.NODE_COMPILE_CACHE = path.join(root, 'node-compile-cache');
    const realCurl = process.env.PARALLIX_TEST_REAL_CURL;
    if (realCurl) {
      const curlBin = path.join(root, 'curl-bin');
      fs.mkdirSync(curlBin);
      fs.symlinkSync(realCurl, path.join(curlBin, 'curl'));
      env.PATH = `${curlBin}${path.delimiter}${env.PATH ?? ''}`;
    }
    const recoveryPath = env.PATH;
    const interruptedRequest = path.join(root, 'interrupted-request.json');
    const interruptBin = path.join(root, 'interrupt-bin');
    fs.mkdirSync(interruptBin);
    fs.writeFileSync(path.join(interruptBin, 'curl'), `#!/bin/sh
method=
url=
while test "$#" -gt 0; do
  if test "$1" = -X; then shift; method="$1"; fi
  url="$1"
  shift
done
if test "$method" = POST; then
  body=$(cat)
  printf '%s\\t%s\\n' "$url" "$body" > '${interruptedRequest}'
  exit 7
fi
case "$url" in
  *issues/739/comments*|*pulls/739/reviews*) data='[]' ;;
  *pulls/739*) data='${JSON.stringify(pull)}' ;;
  *) data='[${JSON.stringify(pull)}]' ;;
esac
printf '%s\\n200' "$data"
`, { mode: 0o755 });
    for (const key of ['PARALLIX_MISSION_SOCKET', 'PARALLIX_MISSION_TERMINAL', 'PARALLIX_OPERATION_CAPTURE',
      'PARALLIX_RESOURCE_BOUNDARY', 'PARALLIX_WORKFLOW_GENERATION', 'PARALLIX_WORKFLOW_OPERATION']) { delete env[key]; }
    const run = (args: string[]) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, pxNodeArgs(cli, args, { stopPrebuiltCoverage: false }), { cwd: worktree, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`CLI timeout: ${args.join(' ')}`)); }, 20_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); resolve({ code, output }); });
    });
    const runInProcess = async (args: string[], commandPath: string) => {
      const output: string[] = [];
      const previousPath = process.env.PATH;
      process.env.PATH = commandPath;
      let code: number;
      try {
        code = await runCli(args, { baseCwd: worktree, environment: { ...env, PATH: commandPath },
          log: line => { output.push(String(line)); return null; },
          error: line => { output.push(String(line)); return null; } });
      } finally {
        if (previousPath === undefined) { delete process.env.PATH; } else { process.env.PATH = previousPath; }
      }
      return { code, output: output.join('\n') };
    };
    const verdict = ['verdict', 'request-changes', '--slug', slug, '--actor', 'claude', '--finding', 'F1',
      '--summary', 'Repair the controlled fixture', '--comment', 'Changes required.'];
    const interrupted = await runInProcess(verdict, `${interruptBin}${path.delimiter}${process.env.PATH ?? ''}`);
    assert.notEqual(interrupted.code, 0, interrupted.output);
    const [acceptedUrl, acceptedBody] = fs.readFileSync(interruptedRequest, 'utf8').trim().split('\t');
    assert.match(acceptedUrl ?? '', /\/issues\/739\/comments$/);
    const accepted = JSON.parse(acceptedBody ?? '') as { body?: unknown };
    comments.push({ id: 1, body: String(accepted.body ?? ''), user: { login: 'claude' },
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    interruptNextComment = false;
    env.PATH = recoveryPath;
    const recovered = await run(verdict);
    assert.equal(recovered.code, 0, recovered.output);
    assert.deepEqual([comments.length, reviews.length], [1, 1]);

    fs.writeFileSync(path.join(worktree, 'repair.txt'), 'controlled repair\n');
    git('add', '.');
    git('commit', '-qm', 'repair');
    const fixedRevision = git('rev-parse', 'HEAD');
    pull.head.sha = fixedRevision;
    const resolvedRequest = path.join(root, 'resolved-request.json');
    const resolvedBin = path.join(root, 'resolved-bin');
    fs.mkdirSync(resolvedBin);
    fs.writeFileSync(path.join(resolvedBin, 'curl'), `#!/bin/sh
method=
url=
while test "$#" -gt 0; do
  if test "$1" = -X; then shift; method="$1"; fi
  url="$1"
  shift
done
if test "$method" = POST; then
  body=$(cat)
  printf '%s\\t%s\\n' "$url" "$body" >> '${resolvedRequest}'
  printf '{}\\n200'
  exit 0
fi
case "$url" in
  *issues/739/comments*) data='${JSON.stringify(comments)}' ;;
  *pulls/739/reviews*) data='${JSON.stringify(reviews)}' ;;
  *pulls/739*) data='${JSON.stringify(pull)}' ;;
  *) data='[${JSON.stringify(pull)}]' ;;
esac
printf '%s\\n200' "$data"
`, { mode: 0o755 });
    const resolved = await runInProcess(['resolve', '--slug', slug, '--actor', 'codex', '--finding', 'F1',
      '--fixed', 'Controlled repair evidence', '--revision', fixedRevision],
    `${resolvedBin}${path.delimiter}${process.env.PATH ?? ''}`);
    assert.equal(resolved.code, 0, resolved.output);
    for (const [index, line] of fs.readFileSync(resolvedRequest, 'utf8').trim().split('\n').entries()) {
      const [url, body] = line.split('\t');
      assert.match(url ?? '', /\/issues\/739\/comments$/);
      const parsed = JSON.parse(body ?? '') as { body?: unknown };
      comments.push({ id: comments.length + 1, body: String(parsed.body ?? ''), user: { login: 'codex' },
        created_at: new Date(Date.now() + index).toISOString(), updated_at: new Date(Date.now() + index).toISOString() });
    }
    let loaded = await store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    if (loaded.kind !== 'found') { throw new Error('fixture mission disappeared'); }
    const next = beginNextReviewRound(loaded.mission.review!, agentFamily('claude'), agentFamily('codex'), new Date().toISOString(), eligibility);
    await store.save({ ...loaded.mission, status: 'review', rawStatus: 'review', closedAt: null, review: next }, loaded.version);
    const approved = await run(['verdict', 'approve', '--slug', slug, '--actor', 'claude', '--comment', 'Repair approved.']);
    assert.equal(approved.code, 0, approved.output);
    loaded = await store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    if (loaded.kind !== 'found') { throw new Error('approved fixture mission disappeared'); }
    assert.deepEqual([comments.length, reviews.length], [4, 2]);
    const providerEntries = [...comments, ...reviews];
    assert.ok(providerEntries.every(entry => /Review provenance: round \d+; actor (claude|codex); revision [0-9a-f]+/.test(String(entry.body))),
      JSON.stringify(providerEntries.map(entry => entry.body)));
    const markers = providerEntries.map(entry => /parallix-publication:([^ ]+) -->/.exec(String(entry.body))?.[1]);
    assert.equal(new Set(markers).size, 6);
    const publications = loaded.mission.review!.reviewEvents.flatMap(event => {
      const publication = parseReviewPublication(event.followUpReference);
      return publication ? [publication] : [];
    });
    assert.equal(publications.length, 6);
    assert.ok(publications.every(publication => publication.state === 'completed'));
    const usage = await database.query<{ count: number }>('SELECT COUNT(*) AS count FROM usage_statistics');
    const usageRows = Number(usage[0]?.count ?? -1);
    assert.equal(usageRows, 0);
    return { exits: [interrupted.code, recovered.code, resolved.code, approved.code],
      comments: comments.length, reviews: reviews.length, completedPublications: publications.length,
      uniquePublicationMarkers: new Set(markers).size, usageRows, cleaned: true };
  } finally {
    await database.close();
    if (provider) { await new Promise<void>(resolve => provider!.close(() => resolve())); }
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, 'disposable CLI state is removed');
  }
}
