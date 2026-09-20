import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolveForgejoHome } from '../src/adapters/forgejo/forgejo.js';

const SONAR_URL = 'http://127.0.0.1:9000';
const TOKEN_NAME = 'parallix-local-scanner';
// `main` keeps the dedicated, recorded identity. Every other branch/worktree
// gets `parallix-<branch>` so analyses never overwrite each other. Works on
// every SonarQube edition (community included); native `sonar.branch.name` is
// rejected because it needs a paid edition. See ADR 0060.
const MAIN_BRANCH = 'main';
const MAIN_PROJECT_KEY = 'parallix';

function sonarUrl(): string {
  return (process.env.SONAR_HOST_URL || SONAR_URL).replace(/\/$/, '');
}

export function sonarTokenPath(rootDir: string = process.cwd()): string {
  return path.join(resolveForgejoHome(rootDir), 'tokens', 'sonarqube');
}

export function readSonarToken(rootDir?: string): string | null {
  const file = sonarTokenPath(rootDir);
  try { return fs.readFileSync(file, 'utf8').trim() || null; } catch (_) { return null; }
}

function writeSonarToken(token: string, rootDir?: string): string {
  const file = sonarTokenPath(rootDir);
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

function prepareTokenHome(rootDir?: string): void {
  const directory = path.dirname(sonarTokenPath(rootDir));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const probe = path.join(directory, '.sonarqube-write-probe');
  fs.writeFileSync(probe, '', { mode: 0o600, flag: 'wx' });
  fs.unlinkSync(probe);
}

async function passwordPrompt(): Promise<string> {
  const prompt = createInterface({ input: stdin, output: stdout });
  try { return await prompt.question('Local SonarQube administrator password: '); } finally { prompt.close(); }
}

export async function setupSonar(options: { rootDir?: string, password?: string, prompt?: () => Promise<string>, request?: typeof fetch } = {}) {
  const existing = readSonarToken(options.rootDir);
  if (existing) { return { created: false, path: sonarTokenPath(options.rootDir) }; }
  prepareTokenHome(options.rootDir);
  const password = options.password ?? await (options.prompt || passwordPrompt)();
  if (!password) { throw new Error('Local SonarQube administrator password is required.'); }
  const request = options.request || fetch;
  const post = (endpoint: string) => request(`${SONAR_URL}/api/user_tokens/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ name: TOKEN_NAME }),
  });
  // The server token value is unrecoverable once the local file is gone, so replace it.
  const revoked = await post('revoke');
  if (!revoked.ok && revoked.status !== 404) { throw new Error(`SonarQube token revoke failed (HTTP ${revoked.status}).`); }
  const response = await post('generate');
  const result = await response.json() as { token?: string, errors?: Array<{ msg?: string }> };
  if (!response.ok || !result.token) { throw new Error(result.errors?.[0]?.msg || `SonarQube token setup failed (HTTP ${response.status}).`); }
  return { created: true, path: writeSonarToken(result.token, options.rootDir) };
}

export async function assertNewIssuesFail(options: { token: string, request?: typeof fetch, rootDir?: string }) {
  const request = options.request || fetch;
  const headers = { Authorization: `Basic ${Buffer.from(`${options.token}:`).toString('base64')}` };
  const project = await request(`${sonarUrl()}/api/qualitygates/get_by_project?project=${resolveSonarProjectKey(options.rootDir)}`, { headers });
  const gate = await project.json() as { qualityGate?: { name?: string } };
  if (!project.ok || !gate.qualityGate?.name) { throw new Error(`SonarQube quality gate lookup failed (HTTP ${project.status}).`); }
  const response = await request(`${sonarUrl()}/api/qualitygates/show?name=${encodeURIComponent(gate.qualityGate.name)}`, { headers });
  const result = await response.json() as { conditions?: Array<{ metric?: string, op?: string, error?: string }> };
  if (!response.ok || !result.conditions?.some(({ metric, op, error }) => metric === 'new_violations' && op === 'GT' && Number(error) <= 0)) {
    throw new Error('SonarQube quality gate must fail on every new issue (new_violations > 0), including High, Critical, and Blocker issues.');
  }
}

export async function runSonar(options: { rootDir?: string, spawn?: typeof spawnSync, request?: typeof fetch } = {}) {
  // Trusted CI runs supply SONAR_TOKEN through an environment secret; local
  // runs reuse the Forgejo-resolved token file. The scanner never prints the
  // token, and the host URL is overridden through SONAR_HOST_URL for non-local
  // servers (GitHub environment secret), so no loopback host or secret is
  // committed. Local behavior is unchanged when SONAR_TOKEN is unset.
  const rootDir = options.rootDir || process.cwd();
  const token = process.env.SONAR_TOKEN || readSonarToken(rootDir);
  if (!token) { throw new Error('No SonarQube token found. Set SONAR_TOKEN (CI) or run `npm run sonar:setup` (local).'); }
  // Resolve the local bin so the scanner launches without relying on a global install; fall back to a
  // PATH lookup (CI supplies SONAR_TOKEN and a globally available scanner).
  const localBin = path.join(rootDir, 'node_modules', '.bin', 'sonar-scanner-npm');
  const scannerBin = fs.existsSync(localBin) ? localBin : 'sonar-scanner-npm';
  const childEnv: NodeJS.ProcessEnv = { ...process.env, SONAR_TOKEN: token };
  if (!fs.existsSync(localBin)) { childEnv.PATH = `${binDir(rootDir)}${path.delimiter}${childEnv.PATH || ''}`; }
  // Pin the new-code base to the primary branch (forgejo-style fallback), not a
  // stale version tag: against the primary branch, new code = this branch's
  // changes vs main. The new-code reference is independent of the analysis
  // identity below, which is now isolated per branch so missions do not share
  // one project. See ADR 0060.
  const projectKey = resolveSonarProjectKey(rootDir);
  const result = (options.spawn || spawnSync)(scannerBin, [
    '-Dsonar.newCode.referenceBranch=main',
    `-Dsonar.projectKey=${projectKey}`,
  ], { cwd: rootDir, stdio: 'inherit', env: childEnv });
  if (result.error) { throw result.error; }
  if (result.status !== 0) { process.exitCode = result.status || 1; }
  return result;
}

function binDir(rootDir: string): string { return path.join(rootDir, 'node_modules', '.bin'); }

// Resolve the branch that owns this analysis. CI pull_request checkouts are a
// detached merge commit where git reports HEAD, so prefer the runner-supplied
// branch, then a checked-out branch, then the worktree path basename.
export function resolveSonarBranch(rootDir: string): string {
  const envBranch = (process.env.PARALLIX_SONAR_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
  if (envBranch) return envBranch;
  const git = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
  if (!git.error && git.status === 0 && git.stdout.trim() && git.stdout.trim() !== 'HEAD') {
    return git.stdout.trim();
  }
  return path.basename(rootDir);
}

// SonarQube caps `sonar.projectKey` at 400 characters. The full key is
// `parallix-<sanitized branch>-<hash>`, so the readable sanitized prefix is
// bounded so the total never exceeds the limit by construction. SC1 bound.
const SONAR_MAX_PROJECT_KEY = 400;
const MAIN_PREFIX = 'parallix-';
const KEY_SEPARATOR = '-';
const HASH_LEN = 64; // sha256 hex length
const MAX_SANITIZED_LEN =
  SONAR_MAX_PROJECT_KEY - MAIN_PREFIX.length - KEY_SEPARATOR.length - HASH_LEN;

// Sanitize a branch name into a SonarQube project-key charset
// ([a-z0-9_-], letter-start), bounded to MAX_SANITIZED_LEN. Purely cosmetic:
// this collapses distinct branches (see resolveSonarProjectKey), so it never
// stands alone as the identity. Truncating the readable prefix never causes a
// collision because the suffix hashes the full raw name.
function sanitizeProjectKey(branch: string): string {
  return (branch.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree').slice(0, MAX_SANITIZED_LEN);
}

// Short injective encoding of the raw branch identity into the SonarQube
// project-key charset (hex). A fixed-length sha256 (256 bits) is a real
// collision-resolution mechanism: two distinct branches never share a key even
// when the sanitized prefix collapses them (feature/a vs feature-a, or the
// /-heavy names that both sanitize to one prefix). Combined with the bounded
// sanitized prefix the full key stays within SonarQube's 400-character limit.
// See ADR 0060.
function encodeBranchIdentity(branch: string): string {
  return createHash('sha256').update(branch).digest('hex').slice(0, HASH_LEN);
}

// Per-worktree/per-branch analysis identity. main keeps the dedicated
// `parallix` identity; every other branch gets a distinct key so two missions
// never overwrite each other. Shared by runSonar (scan submission) and
// assertNewIssuesFail (quality-gate query) so submit and query agree.
// The readable (bounded) sanitized prefix aids debugging; the sha256 suffix of
// the full raw name guarantees a collision-free mapping (SC1), and the bounded
// prefix keeps the total key within SonarQube's 400-character projectKey limit.
// See ADR 0060.
export function resolveSonarProjectKey(rootDir: string = process.cwd()): string {
  const branch = resolveSonarBranch(rootDir);
  if (branch === MAIN_BRANCH) return MAIN_PROJECT_KEY;
  return `${MAIN_PREFIX}${sanitizeProjectKey(branch)}-${encodeBranchIdentity(branch)}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const command = process.argv[2];
  if (command === 'setup') { setupSonar().then(({ created, path: tokenPath }) => console.log(`${created ? 'Created' : 'Reusing'} local SonarQube token at ${tokenPath}`)); }
  else if (command === 'scan') { runSonar().catch((error) => { console.error(error.message); process.exitCode = 1; }); }
  else { throw new Error('Usage: sonar-local.ts <setup|scan>'); }
}
