import * as fs from 'fs';
import * as path from 'path';
import _cp from 'child_process';
import * as fmt from '../../application/presentation/cli-format.js';
import { resolveForgejoHome } from '../forgejo/forgejo.js';
import type { ApiRequestFn, ApiRequestOptions, ApiResult, AgentPassword, CreatedToken, PromptFn, TokenResult, TokenRetryOptions, TokenWarning } from './setup-review-types.js';

const { spawnSync } = _cp;
let tokenNameCounter = 0;
export const REVIEW_TOKEN_SCOPES = ['write:user', 'write:repository', 'write:issue', 'write:organization'];
export const SETUP_OWNER_TOKEN_SCOPES = [...REVIEW_TOKEN_SCOPES, 'write:admin'];
export const PASSWORD_PROMPT_OPTIONS = { hidden: false };

export function parseRepoSlug(repo: string | undefined): { owner: string; repo: string } | null {
  if (typeof repo !== 'string') {return null;}
  const match = repo.trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

export function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }
export function normalizeBaseUrl(baseUrl: string | undefined): string | undefined { return typeof baseUrl === 'string' ? baseUrl.replace(/\/+$/, '') : baseUrl; }
export function buildTokenName(repoName: string, user: string, suffix: string = `${Date.now()}-${++tokenNameCounter}`): string { return `workflow-${repoName}-${user}-${suffix}`; }
export function passwordPrompt(user: string, options: { allowBlank?: boolean } = {}): string { return options.allowBlank ? `Password for ${user} (input visible, leave blank to skip token creation): ` : `Password for ${user} (input visible): `; }
export function tokenFilePath(user: string, forgejoHome?: string): string { return path.join(forgejoHome || resolveForgejoHome(), 'tokens', user); }
export function ensureTokenDir(forgejoHome?: string): string { const dir = path.join(forgejoHome || resolveForgejoHome(), 'tokens'); fs.mkdirSync(dir, { recursive: true }); return dir; }
export function resolveBootstrapForgejoHome(rootDir?: string, explicitForgejoHome?: string): string { return explicitForgejoHome || path.join(rootDir || process.cwd(), '.forgejo-local'); }
export function writeToken(user: string, token: string, forgejoHome?: string): string { ensureTokenDir(forgejoHome); const file = tokenFilePath(user, forgejoHome); fs.writeFileSync(file, `${token}\n`, { mode: 0o600 }); return file; }
export function isAuthFailure(result: { statusCode?: number | null }): boolean { return Boolean(result && (result.statusCode === 401 || result.statusCode === 403)); }

export function apiRequest(method: string, requestUrl: string, options: ApiRequestOptions = {}): ApiResult {
  const args = ['-s', '-X', method, '-H', 'Content-Type: application/json', '-w', '\n%{http_code}'];
  if (options.basicAuth) {args.push('-u', `${options.basicAuth.user}:${options.basicAuth.password}`);}
  if (options.token) {args.push('-H', `Authorization: token ${options.token}`);}
  if (options.body) {args.push('--data-binary', '@-');}
  args.push(requestUrl);
  const result = spawnSync('curl', args, { encoding: 'utf8', input: options.body ? JSON.stringify(options.body) : undefined });
  if (result.status !== 0 || !result.stdout) {return { ok: false, statusCode: null, data: null, error: (result.stderr || result.stdout || 'curl failed').trim() };}
  const output = result.stdout.trim();
  const lastLineIndex = output.lastIndexOf('\n');
  const statusCode = Number(lastLineIndex === -1 ? output : output.slice(lastLineIndex + 1));
  const payload = lastLineIndex === -1 ? '' : output.slice(0, lastLineIndex).trim();
  let data: unknown = null;
  if (payload) { try { data = JSON.parse(payload) as unknown; } catch { data = payload; } }
  return { ok: statusCode >= 200 && statusCode < 300, statusCode, data, error: null };
}

/** Read the PAT out of a Forgejo token-creation payload, if one is present. */
export function tokenSha1(data: unknown): string | null {
  if (!data || typeof data !== 'object') { return null; }
  const sha1 = (data as { sha1?: unknown }).sha1;
  return typeof sha1 === 'string' && sha1 ? sha1 : null;
}

export function createToken(baseUrl: string | undefined, user: string, password: string, tokenName: string, requestFn: ApiRequestFn = apiRequest, scopes: string[] = REVIEW_TOKEN_SCOPES): TokenResult {
  const result = requestFn('POST', `${normalizeBaseUrl(baseUrl)}/api/v1/users/${encodeURIComponent(user)}/tokens`, { basicAuth: { user, password }, body: { name: tokenName, scopes } });
  if (!result.ok) {return { ok: false, error: `token creation failed for ${user} (HTTP ${result.statusCode || 'n/a'})`, statusCode: result.statusCode, response: result.data };}
  const token = tokenSha1(result.data);
  return token ? { ok: true, token } : { ok: false, error: `token creation for ${user} did not return a token`, statusCode: result.statusCode, response: result.data };
}

export async function createTokenWithRetries(setup: { baseUrl?: string; repo?: string }, user: string, initialPassword: string, options: TokenRetryOptions = {}): Promise<TokenResult> {
  const { allowBlank = false, log = fmt.log.info, promptFn, maxAttempts = 3, requestFn = apiRequest, scopes = REVIEW_TOKEN_SCOPES } = options;
  const repoInfo = parseRepoSlug(setup.repo);
  if (!repoInfo) {return { ok: false, error: `invalid review repo slug: ${setup.repo}` };}
  let password = typeof initialPassword === 'string' ? initialPassword : '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const passwordResult = await resolveTokenPassword(password, user, allowBlank, promptFn);
    if (passwordResult.result) { return passwordResult.result; }
    password = passwordResult.password;
    if (!password) {
      if (allowBlank) {return { ok: true, skipped: true };}
      if (attempt === maxAttempts) {return { ok: false, error: `Password is required for ${user}.` };}
      log(fmt.status('WARN', `Password is required for ${user}. Attempt ${attempt} of ${maxAttempts}.`));
      continue;
    }
    const tokenResult = createToken(setup.baseUrl, user, password, buildTokenName(repoInfo.repo, user), requestFn, scopes);
    if (endsTokenRetry(tokenResult, attempt, maxAttempts, promptFn)) {return tokenResult;}
    log(fmt.status('WARN', `Forgejo authentication failed for ${user}. Attempt ${attempt} of ${maxAttempts}; please try again.`));
    password = '';
  }
  return { ok: false, error: `token creation failed for ${user}` };
}

async function resolveTokenPassword(password: string, user: string, allowBlank: boolean, promptFn?: PromptFn): Promise<{ password: string; result?: TokenResult }> {
  if (password) { return { password }; }
  if (!promptFn) { return { password, result: allowBlank ? { ok: true, skipped: true } : { ok: false, error: `Password is required for ${user}.` } }; }
  return { password: await promptFn(passwordPrompt(user, { allowBlank }), PASSWORD_PROMPT_OPTIONS) };
}

function endsTokenRetry(result: TokenResult, attempt: number, maxAttempts: number, promptFn?: PromptFn): boolean {
  return result.ok || !isAuthFailure(result) || attempt === maxAttempts || !promptFn;
}

export function tokenCreateViaOwnerToken(baseUrl: string, _repoSlug: string, ownerToken: string, agentPasswords: readonly AgentPassword[], repoInfo: { owner: string; repo: string }, options: { requestFn?: ApiRequestFn; writeTokenFn?: (user: string, token: string, forgejoHome?: string) => string; buildTokenNameFn?: (repoName: string, user: string) => string; forgejoHome?: string } = {}): { ok: boolean; createdTokens: CreatedToken[]; warnings: TokenWarning[]; error?: string } {
  const { requestFn = apiRequest, writeTokenFn = writeToken, buildTokenNameFn = buildTokenName, forgejoHome: injectedForgejoHome } = options;
  const forgejoHome = typeof injectedForgejoHome === 'string' ? injectedForgejoHome : resolveForgejoHome();
  const createdTokens: CreatedToken[] = []; const warnings: TokenWarning[] = [];
  for (const agent of agentPasswords) {
    const result = requestFn('POST', `${normalizeBaseUrl(baseUrl)}/api/v1/users/${encodeURIComponent(agent.user)}/tokens`, { token: ownerToken, body: { name: buildTokenNameFn(repoInfo.repo, agent.user), scopes: REVIEW_TOKEN_SCOPES } });
    const sha1 = tokenSha1(result.data);
    if (!result.ok || !sha1) { warnings.push({ user: agent.user, error: !result.ok ? `token creation via owner token failed (HTTP ${result.statusCode || 'n/a'}); bootstrap requires a Forgejo site-admin owner with write:admin token scope. Re-run px setup-review with that owner's password to rotate the token` : 'token creation via owner token did not return a token', response: result.data }); continue; }
    createdTokens.push({ user: agent.user, path: writeTokenFn(agent.user, sha1, forgejoHome) });
  }
  if (createdTokens.length === 0) {const first = warnings[0]; return { ok: false, createdTokens, warnings, error: first ? `${first.user}: ${first.error}` : 'no requested agent token was created' };}
  return { ok: true, createdTokens, warnings };
}
