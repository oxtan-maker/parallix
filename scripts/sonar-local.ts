import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// Single Sonar analysis service for local missions and GitHub verification:
// SonarQube Cloud, one project, native branch analysis. See ADR 0060.
const SONAR_URL = 'https://sonarcloud.io';
const SONAR_ORGANIZATION = 'oxtan-maker';
const SONAR_PROJECT_KEY = 'parallix';

// Query the configured Cloud quality gate for the project and require that it
// fails on every new issue. Repository policy (TASK-2525) lives in the Cloud
// project; this asserts the real configuration rather than a local mirror.
export async function assertNewIssuesFail(options: { token: string, request?: typeof fetch }) {
  const request = options.request || fetch;
  const headers = { Authorization: `Basic ${Buffer.from(`${options.token}:`).toString('base64')}` };
  const project = await request(`${SONAR_URL}/api/qualitygates/get_by_project?organization=${SONAR_ORGANIZATION}&project=${SONAR_PROJECT_KEY}`, { headers });
  const gate = await project.json() as { qualityGate?: { name?: string } };
  if (!project.ok || !gate.qualityGate?.name) { throw new Error(`SonarQube Cloud quality gate lookup failed (HTTP ${project.status}).`); }
  const response = await request(`${SONAR_URL}/api/qualitygates/show?organization=${SONAR_ORGANIZATION}&name=${encodeURIComponent(gate.qualityGate.name)}`, { headers });
  const result = await response.json() as { conditions?: Array<{ metric?: string, op?: string, error?: string }> };
  if (!response.ok || !result.conditions?.some(({ metric, op, error }) => metric === 'new_violations' && op === 'GT' && Number(error) <= 0)) {
    throw new Error('SonarQube quality gate must fail on every new issue (new_violations > 0), including High, Critical, and Blocker issues.');
  }
}

// The Sonar branch identity is the Git branch the worktree already owns; no
// derived project key, no sanitisation. GitHub runs let the scanner's own CI
// integration derive branch/pull-request metadata from the event, so the local
// branch resolution is skipped there (a pull_request checkout is a detached
// merge commit and would otherwise analyse as `HEAD`).
// Retired from the public API (SC2): the branch lookup stays private and is
// exercised only through runSonar, so no per-branch project-key resolver is
// reachable from outside the entrypoint.
function resolveSonarBranch(rootDir: string = process.cwd()): string | null {
  if (process.env.GITHUB_ACTIONS === 'true') return null;
  const git = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
  const branch = git.error || git.status !== 0 ? '' : git.stdout.trim();
  if (!branch || branch === 'HEAD') { throw new Error('Cannot resolve the Git branch for the Sonar analysis; check out a branch before scanning.'); }
  return branch;
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
  const result = (options.spawn || spawnSync)(scannerBin, [
    `-Dsonar.host.url=${SONAR_URL}`,
    `-Dsonar.organization=${SONAR_ORGANIZATION}`,
    `-Dsonar.projectKey=${SONAR_PROJECT_KEY}`,
    ...(branch ? [`-Dsonar.branch.name=${branch}`] : []),
  ], { cwd: rootDir, stdio: 'inherit', env: { ...process.env, SONAR_TOKEN: token } });
  if (result.error) { throw result.error; }
  // Fail closed: a non-zero scanner status covers analysis failure and, because
  // sonar.qualitygate.wait=true, a failed quality gate as well.
  if (result.status !== 0) { throw new Error(`SonarQube Cloud analysis or quality gate failed (exit ${result.status ?? 'signal'}).`); }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (process.argv[2] !== 'scan') { throw new Error('Usage: sonar-local.ts scan'); }
  try { runSonar(); } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
