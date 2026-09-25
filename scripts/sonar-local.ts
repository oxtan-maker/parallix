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
  if (!result.component?.measures) { throw new Error(`SonarQube Cloud metrics lookup failed (HTTP ${response.status}).`); }
  const total = result.component.measures.reduce((count, measure) => {
    const impacts = JSON.parse(measure.value || '{}') as Record<string, number>;
    return count + (impacts.HIGH || 0) + (impacts.BLOCKER || 0);
  }, 0);
  if (total !== 0) {
    throw new Error('SonarQube Cloud mission analysis has unresolved HIGH/BLOCKER impacts.');
  }
}

// Post-scan mission assertion, run by the `scan` entrypoint after the shared
// scanner. The provider new-code gate (sonar.qualitygate.wait=true) is the
// result authority in every trusted context; this adds the repository-owned
// total-code HIGH/BLOCKER proof only where it belongs — a local mission
// candidate, before integration. GitHub publication branches
// (github-publish/<sha>), pull requests, local main, and other local branches
// are not missions: they get no branch-type lookup and no total-code metrics
// call.
export async function assertMissionTotalCode(options: { token: string, rootDir?: string, request?: typeof fetch, backoffMs?: number }): Promise<void> {
  const rootDir = options.rootDir || process.cwd();
  const context = resolveSonarContext(rootDir);
  if (context.kind !== 'local-branch' || !isMissionBranch(rootDir, context.branch)) return;
  await assertNoOpenHighOrBlockerIssues({ token: options.token, branch: context.branch, request: options.request, backoffMs: options.backoffMs });
}

export function runSonar(options: { rootDir?: string, spawn?: typeof spawnSync } = {}) {
  const rootDir = options.rootDir || process.cwd();
  // The token is environment-owned in both environments: an operator export
  // locally, a GitHub Actions secret on CI. It is never read from, or written
  // to, the repository, and never printed.
  const token = process.env.SONAR_TOKEN;
  if (!token) { throw new Error('SONAR_TOKEN is not set. Export a SonarQube Cloud token before running `npm run sonar`.'); }
  const branch = resolveSonarBranch(rootDir);
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
  ], { cwd: rootDir, stdio: 'inherit', env: { ...process.env, SONAR_TOKEN: token, SONAR_USER_HOME: scannerHome } });
  if (result.error) { throw result.error; }
  // Fail closed: a non-zero scanner status covers analysis failure and, because
  // sonar.qualitygate.wait=true, a failed quality gate as well.
  if (result.status !== 0) { throw new Error(`SonarQube Cloud analysis or quality gate failed (exit ${result.status ?? 'signal'}).`); }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (process.argv[2] !== 'scan') { throw new Error('Usage: sonar-local.ts scan'); }
  try {
    // The provider gate controls the scanner result in every trusted context;
    // the mission-only total-code proof runs after it, for local missions only.
    runSonar();
    await assertMissionTotalCode({ token: process.env.SONAR_TOKEN!, rootDir: process.cwd() });
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
