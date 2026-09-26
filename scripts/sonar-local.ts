import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// Single Sonar analysis service for local missions and GitHub verification:
// SonarQube Cloud, one project, native branch analysis. See ADR 0060.
const SONAR_URL = 'https://sonarcloud.io';
const SONAR_ORGANIZATION = 'oxtan-maker';
const SONAR_PROJECT_KEY = 'parallix';

export type SonarContext =
  | { kind: 'local-branch', branch: string }
  | { kind: 'github-branch', branch: string }
  | { kind: 'github-pull-request', pullRequest: string };

// The Sonar branch identity is the Git branch the worktree already owns; no
// derived project key, no sanitisation. GitHub runs let the scanner's own CI
// integration derive branch/pull-request metadata from the event, so the local
// branch resolution is skipped there (a pull_request checkout is a detached
// merge commit and would otherwise analyse as `HEAD`).
function resolveSonarBranch(rootDir: string = process.cwd()): string | null {
  if (process.env.GITHUB_ACTIONS === 'true') return null;
  const git = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
  const branch = git.error || git.status !== 0 ? '' : git.stdout.trim();
  if (!branch || branch === 'HEAD') { throw new Error('Cannot resolve the Git branch for the Sonar analysis; check out a branch before scanning.'); }
  return branch;
}

export function resolveSonarContext(rootDir: string = process.cwd()): SonarContext {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    return { kind: 'local-branch', branch: resolveSonarBranch(rootDir)! };
  }
  const pullRequest = process.env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\//)?.[1];
  if (pullRequest) { return { kind: 'github-pull-request', pullRequest }; }
  if (process.env.GITHUB_REF_NAME) { return { kind: 'github-branch', branch: process.env.GITHUB_REF_NAME }; }
  throw new Error('SonarQube Cloud analysis context is unavailable on GitHub.');
}

// The repository's configured mission branch namespace (workflow.config.json
// adapters.missions.branchPrefix). Mission identity is positive: only this
// prefix is a Parallix mission. "Not GitHub" is not a mission — local main and
// arbitrary local branches are not missions either.
export function isMissionBranch(rootDir: string, branch: string): boolean {
  const config = JSON.parse(fs.readFileSync(path.join(rootDir, 'workflow.config.json'), 'utf8')) as { adapters?: { missions?: { branchPrefix?: string } } };
  const prefix = config.adapters?.missions?.branchPrefix;
  if (typeof prefix !== 'string' || prefix.length === 0) { throw new Error('workflow.config.json adapters.missions.branchPrefix is required for the mission Sonar boundary.'); }
  return branch.startsWith(prefix);
}

// Repository-owned total-code proof for a mission candidate: the branch must
// exist on the provider as LONG (total-code metrics require it) and the
// complete candidate must carry no unresolved HIGH or BLOCKER software-quality
// impacts. Fail-closed at every step.
// The provider read is a hosted API: a single transient 5xx or network blip
// must not fail the gate. Retry with a bounded backoff; once attempts are
// exhausted, fail closed with the last response or error. 4xx is a final
// provider answer and is never retried.
const SONAR_READ_ATTEMPTS = 3;
const SONAR_READ_BACKOFF_MS = 5000;

async function sonarGet(request: typeof fetch, url: string, headers: Record<string, string>, backoffMs: number): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SONAR_READ_ATTEMPTS; attempt += 1) {
    try {
      const response = await request(url, { headers });
      if (response.ok || response.status < 500 || attempt === SONAR_READ_ATTEMPTS) { return response; }
    } catch (error) {
      lastError = error; // network-level failure: retry while attempts remain
    }
    if (attempt < SONAR_READ_ATTEMPTS) { await new Promise((resolve) => { setTimeout(resolve, backoffMs * attempt); }); }
  }
  throw lastError;
}

export async function assertNoOpenHighOrBlockerIssues(options: { token: string, branch: string, request?: typeof fetch, backoffMs?: number }) {
  const request = options.request || fetch;
  const backoffMs = options.backoffMs ?? SONAR_READ_BACKOFF_MS;
  const headers = { Authorization: `Basic ${Buffer.from(`${options.token}:`).toString('base64')}` };
  const branches = await sonarGet(request, `${SONAR_URL}/api/project_branches/list?project=${SONAR_PROJECT_KEY}`, headers, backoffMs);
  if (!branches.ok) { throw new Error(`SonarQube Cloud branch lookup failed (HTTP ${branches.status}).`); }
  const branchList = await branches.json() as { branches?: Array<{ name?: string, type?: string }> };
  const branch = branchList.branches?.find(({ name }) => name === options.branch);
  if (!branch) { throw new Error(`SonarQube Cloud branch lookup failed (HTTP ${branches.status}).`); }
  if (branch.type !== 'LONG') { throw new Error(`SonarQube Cloud mission branch ${options.branch} must be analysed as LONG before checking total-code HIGH/BLOCKER impacts.`); }
  const params = new URLSearchParams({ component: SONAR_PROJECT_KEY, metricKeys: 'reliability_issues,security_issues,maintainability_issues' });
  params.set('branch', options.branch);
  const response = await sonarGet(request, `${SONAR_URL}/api/measures/component?${params}`, headers, backoffMs);
  if (!response.ok) { throw new Error(`SonarQube Cloud metrics lookup failed (HTTP ${response.status}).`); }
  const result = await response.json() as { component?: { measures?: Array<{ value?: string }> } };
  if (result.component?.measures?.length !== 3) { throw new Error(`SonarQube Cloud metrics lookup failed (HTTP ${response.status}).`); }
  const total = result.component.measures.reduce((count, measure) => {
    const impacts = JSON.parse(measure.value || '{}') as Record<string, number>;
    return count + (impacts.HIGH || 0) + (impacts.BLOCKER || 0);
  }, 0);
  if (total !== 0) {
    throw new Error('SonarQube Cloud mission analysis has unresolved HIGH/BLOCKER impacts.');
  }
}

// Post-scan mission assertion, run after the long-lived analysis completes.
// The short comparison scan has already passed the provider new-code gate;
// this adds the repository-owned total-code HIGH/BLOCKER proof for a local
// mission candidate before integration. GitHub publication branches
// (github-publish/<sha>), pull requests, local main, and other local branches
// are not missions: they get no branch-type lookup and no total-code metrics
// call.
export async function assertMissionTotalCode(options: { token: string, rootDir?: string, request?: typeof fetch, backoffMs?: number }): Promise<void> {
  const rootDir = options.rootDir || process.cwd();
  const context = resolveSonarContext(rootDir);
  if (context.kind !== 'local-branch' || !isMissionBranch(rootDir, context.branch)) return;
  await assertNoOpenHighOrBlockerIssues({ token: options.token, branch: context.branch, request: options.request, backoffMs: options.backoffMs });
}

export async function deleteSonarBranch(options: { token: string, branch: string, request?: typeof fetch }) {
  const request = options.request || fetch;
  const headers = { Authorization: `Basic ${Buffer.from(`${options.token}:`).toString('base64')}` };
  const url = `${SONAR_URL}/api/project_branches/delete?project=${SONAR_PROJECT_KEY}&branch=${encodeURIComponent(options.branch)}`;
  const response = await request(url, { method: 'POST', headers });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`SonarQube Cloud branch deletion failed (HTTP ${response.status}).`);
}

export async function deleteMissionBranch(options: { slug?: string; branchPrefix?: string; token?: string; request?: typeof fetch; emit?: (_message: string) => void }): Promise<{ ok: boolean; error?: string }> {
  const emit = options.emit || ((message: string) => console.error(message));
  const slug = options.slug?.trim();
  const branchPrefix = options.branchPrefix?.trim();
  if (!slug || !branchPrefix) {
    const error = 'SonarQube Cloud mission branch deletion skipped: the post-integrate hook slug and the configured mission branch prefix are required.';
    emit(error);
    return { ok: false, error };
  }
  if (!options.token) {
    const error = 'SonarQube Cloud mission branch deletion failed: SONAR_TOKEN is not set.';
    emit(error);
    return { ok: false, error };
  }
  try {
    await deleteSonarBranch({ token: options.token, branch: `${branchPrefix}${slug}`, request: options.request });
    await deleteSonarBranch({ token: options.token, branch: `candidate/${branchPrefix}${slug}`, request: options.request });
    return { ok: true };
  } catch (error) {
    const message = (error as Error).message;
    emit(message);
    return { ok: false, error: message };
  }
}

export function runSonar(options: { rootDir?: string, spawn?: typeof spawnSync, branch?: string, waitForGate?: boolean } = {}) {
  const rootDir = options.rootDir || process.cwd();
  // The token is environment-owned in both environments: an operator export
  // locally, a GitHub Actions secret on CI. It is never read from, or written
  // to, the repository, and never printed.
  const token = process.env.SONAR_TOKEN;
  if (!token) { throw new Error('SONAR_TOKEN is not set. Export a SonarQube Cloud token before running `npm run sonar`.'); }
  const branch = options.branch ?? resolveSonarBranch(rootDir);
  // Lockfile-pinned scanner (devDependency `sonarqube-scanner`), never `npx --yes`.
  const scannerBin = path.join(rootDir, 'node_modules', '.bin', 'sonar-scanner-npm');
  if (!fs.existsSync(scannerBin)) { throw new Error('sonar-scanner-npm is not installed. Run `npm ci` before running `npm run sonar`.'); }
  const scannerHome = path.join(rootDir, 'tmp', 'sonar');
  fs.mkdirSync(scannerHome, { recursive: true });
  const result = (options.spawn || spawnSync)(scannerBin, [
    `-Dsonar.host.url=${SONAR_URL}`,
    `-Dsonar.organization=${SONAR_ORGANIZATION}`,
    `-Dsonar.projectKey=${SONAR_PROJECT_KEY}`,
    ...(branch ? [`-Dsonar.branch.name=${branch}`] : []),
    ...(options.branch ? ['-Dsonar.branch.target=main'] : []),
    ...(options.waitForGate === false ? ['-Dsonar.qualitygate.wait=false'] : []),
  ], { cwd: rootDir, stdio: 'inherit', env: { ...process.env, SONAR_TOKEN: token, SONAR_USER_HOME: scannerHome } });
  if (result.error) { throw result.error; }
  // A non-zero scanner status covers analysis failure and, when waiting for
  // the provider gate, a failed quality gate as well.
  if (result.status !== 0) { throw new Error(`SonarQube Cloud analysis or quality gate failed (exit ${result.status ?? 'signal'}).`); }
  return result;
}

async function awaitAnalysis(token: string, rootDir: string, request: typeof fetch = fetch): Promise<void> {
  const report = fs.readFileSync(path.join(rootDir, '.scannerwork', 'report-task.txt'), 'utf8');
  const taskId = report.match(/^ceTaskId=(.+)$/m)?.[1];
  if (!taskId) throw new Error('SonarQube Cloud did not provide an analysis task ID.');
  const headers = { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` };
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await sonarGet(request, `${SONAR_URL}/api/ce/task?id=${encodeURIComponent(taskId)}`, headers, SONAR_READ_BACKOFF_MS);
    if (!response.ok) throw new Error(`SonarQube Cloud analysis task lookup failed (HTTP ${response.status}).`);
    const result = await response.json() as { task?: { status?: string } };
    if (result.task?.status === 'SUCCESS') return;
    if (result.task?.status === 'FAILED' || result.task?.status === 'CANCELED') throw new Error(`SonarQube Cloud analysis task ${result.task.status}.`);
    await new Promise((resolve) => { setTimeout(resolve, SONAR_READ_BACKOFF_MS); });
  }
  throw new Error('SonarQube Cloud analysis task did not finish within five minutes.');
}

async function assertShortBranch(token: string, branch: string, request: typeof fetch = fetch): Promise<void> {
  const headers = { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` };
  const response = await sonarGet(request, `${SONAR_URL}/api/project_branches/list?project=${SONAR_PROJECT_KEY}`, headers, SONAR_READ_BACKOFF_MS);
  if (!response.ok) throw new Error(`SonarQube Cloud branch lookup failed (HTTP ${response.status}).`);
  const result = await response.json() as { branches?: Array<{ name: string, type: string }> };
  if (result.branches?.find((item) => item.name === branch)?.type !== 'SHORT') {
    throw new Error(`SonarQube Cloud comparison branch ${branch} must be SHORT to evaluate changes against main.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (process.argv[2] === 'scan') try {
    const rootDir = process.cwd();
    const context = resolveSonarContext(rootDir);
    if (context.kind === 'local-branch' && isMissionBranch(rootDir, context.branch)) {
      const comparison = `candidate/${context.branch}`;
      runSonar({ rootDir, branch: comparison });
      await assertShortBranch(process.env.SONAR_TOKEN!, comparison);
      runSonar({ rootDir, waitForGate: false });
      await awaitAnalysis(process.env.SONAR_TOKEN!, rootDir);
      await assertMissionTotalCode({ token: process.env.SONAR_TOKEN!, rootDir });
    } else {
      runSonar({ rootDir });
    }
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
  else if (process.argv[2] === 'delete-branch') {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'workflow.config.json'), 'utf8')) as { adapters?: { missions?: { branchPrefix?: string } } };
    await deleteMissionBranch({ slug: process.env.INTEGRATE_HOOK_SLUG, branchPrefix: config.adapters?.missions?.branchPrefix, token: process.env.SONAR_TOKEN });
  } else throw new Error('Usage: sonar-local.ts scan | delete-branch');
}
