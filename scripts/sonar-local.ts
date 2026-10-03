import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// Single Sonar analysis service for local missions and GitHub verification:
// SonarQube Cloud, one project, native branch analysis. See ADR 0060.
const SONAR_URL = 'https://sonarcloud.io';
const SONAR_ORGANIZATION = 'oxtan-maker';
const SONAR_PROJECT_KEY = 'parallix';
const SONAR_READ_ATTEMPTS = 3;
const SONAR_READ_BACKOFF_MS = 5000;

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
  // Lockfile-pinned scanner (devDependency `sonar-scanner`), never `npx --yes`.
  const scannerBin = path.join(rootDir, 'node_modules', '.bin', 'sonar-scanner');
  if (!options.spawn && !fs.existsSync(scannerBin)) { throw new Error('sonar-scanner is not installed. Run `npm ci` before running `npm run sonar`.'); }
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

async function sonarGet(request: typeof fetch, url: string, headers: Record<string, string>, backoffMs: number): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SONAR_READ_ATTEMPTS; attempt += 1) {
    try {
      const response = await request(url, { headers });
      if (response.ok || response.status < 500 || attempt === SONAR_READ_ATTEMPTS) return response;
    } catch (error) { lastError = error; }
    if (attempt < SONAR_READ_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, backoffMs * attempt));
  }
  throw lastError;
}

export async function assertShortBranch(token: string, branch: string, request: typeof fetch = fetch, backoffMs = SONAR_READ_BACKOFF_MS): Promise<void> {
  const headers = { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` };
  const response = await sonarGet(request, `${SONAR_URL}/api/project_branches/list?project=${SONAR_PROJECT_KEY}`, headers, backoffMs);
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
    } else {
      runSonar({ rootDir });
    }
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
  else if (process.argv[2] === 'delete-branch') {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'workflow.config.json'), 'utf8')) as { adapters?: { missions?: { branchPrefix?: string } } };
    await deleteMissionBranch({ slug: process.env.INTEGRATE_HOOK_SLUG, branchPrefix: config.adapters?.missions?.branchPrefix, token: process.env.SONAR_TOKEN });
  } else throw new Error('Usage: sonar-local.ts scan | delete-branch');
}
