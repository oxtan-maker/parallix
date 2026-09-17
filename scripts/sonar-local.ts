import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolveForgejoHome } from '../src/adapters/forgejo/forgejo.js';

const SONAR_URL = 'http://127.0.0.1:9000';
const TOKEN_NAME = 'parallix-local-scanner';

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

export function runSonar(options: { rootDir?: string, spawn?: typeof spawnSync } = {}) {
  const token = readSonarToken(options.rootDir);
  if (!token) { throw new Error('No local SonarQube token found. Run `npm run sonar:setup` first.'); }
  const result = (options.spawn || spawnSync)('sonar-scanner-npm', [], { stdio: 'inherit', env: { ...process.env, SONAR_TOKEN: token } });
  if (result.error) { throw result.error; }
  if (result.status !== 0) { process.exitCode = result.status || 1; }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const command = process.argv[2];
  if (command === 'setup') { setupSonar().then(({ created, path: tokenPath }) => console.log(`${created ? 'Created' : 'Reusing'} local SonarQube token at ${tokenPath}`)); }
  else if (command === 'scan') { runSonar(); }
  else { throw new Error('Usage: sonar-local.ts <setup|scan>'); }
}
