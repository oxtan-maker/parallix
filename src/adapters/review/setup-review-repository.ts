import _cp from 'child_process';
import { eligibleAgentsForStep } from '../agents/agents.js';
import { apiRequest, normalizeBaseUrl, parseRepoSlug, unique } from './setup-review-auth.js';

const { spawnSync } = _cp;

export function suggestedForgejoUsers(): string[] { return unique([...eligibleAgentsForStep('active'), ...eligibleAgentsForStep('review')]); }
export function readConfiguredReviewRemote(rootDir?: string, remoteName?: string): string | null {
  const result = spawnSync('git', ['-C', rootDir || process.cwd(), 'remote', 'get-url', remoteName || 'review'], { encoding: 'utf8' });
  return result.status === 0 ? (result.stdout || '').trim() || null : null;
}

export function ensureRepo(baseUrl: string, repoSlug: string, ownerLogin: string, ownerToken: string, requestFn: Function = apiRequest) {
  const repoInfo = parseRepoSlug(repoSlug);
  if (!repoInfo) {return { ok: false, error: `invalid review repo slug: ${repoSlug}` };}
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const existing = requestFn('GET', `${normalizedBaseUrl}/api/v1/repos/${repoInfo.owner}/${repoInfo.repo}`, { token: ownerToken });
  if (existing.ok) {return { ok: true, created: false };}
  if (existing.statusCode && existing.statusCode !== 404) {return { ok: false, error: `failed to check review repo ${repoSlug} (HTTP ${existing.statusCode})`, response: existing.data };}
  const createUrl = repoInfo.owner === ownerLogin ? `${normalizedBaseUrl}/api/v1/user/repos` : `${normalizedBaseUrl}/api/v1/orgs/${encodeURIComponent(repoInfo.owner)}/repos`;
  const created = requestFn('POST', createUrl, { token: ownerToken, body: { name: repoInfo.repo, private: true, auto_init: false, default_branch: 'main' } });
  return created.ok ? { ok: true, created: true } : { ok: false, error: `failed to create review repo ${repoSlug} (HTTP ${created.statusCode || 'n/a'})`, response: created.data };
}

export function ensureRepoCollaborator(baseUrl: string, repoSlug: string, ownerToken: string, collaborator: string, permission: string = 'write', requestFn: Function = apiRequest) {
  const repoInfo = parseRepoSlug(repoSlug);
  if (!repoInfo) {return { ok: false, error: `invalid review repo slug: ${repoSlug}` };}
  if (!collaborator || collaborator === repoInfo.owner) {return { ok: true, skipped: true };}
  const result = requestFn('PUT', `${normalizeBaseUrl(baseUrl)}/api/v1/repos/${repoInfo.owner}/${repoInfo.repo}/collaborators/${encodeURIComponent(collaborator)}`, { token: ownerToken, body: { permission } });
  return result.ok ? { ok: true, created: true } : { ok: false, error: `failed to add review collaborator ${collaborator} to ${repoSlug} (HTTP ${result.statusCode || 'n/a'})`, response: result.data };
}

export function ensureRepoCollaborators(baseUrl: string, repoSlug: string, ownerToken: string, collaborators: string[] = [], permission: string = 'write', requestFn: Function = apiRequest) {
  const created = [];
  for (const collaborator of unique(collaborators.map(user => typeof user === 'string' ? user.trim() : '').filter(Boolean))) {
    const result = ensureRepoCollaborator(baseUrl, repoSlug, ownerToken, collaborator, permission, requestFn);
    if (!result.ok) {return { ok: false, created: [] };}
    if (result.created) {created.push(collaborator);}
  }
  return { ok: true, created };
}

export function ensureForgejoUser(baseUrl: string, user: string, ownerLogin: string, ownerPassword: string, password: string, requestFn: Function = apiRequest, options: any = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const existing = requestFn('GET', `${normalizedBaseUrl}/api/v1/users/${encodeURIComponent(user)}`, { basicAuth: { user: ownerLogin, password: ownerPassword } });
  if (existing.ok || existing.statusCode !== 404) {return { ok: true, created: false };}
  const created = requestFn('POST', `${normalizedBaseUrl}/api/v1/admin/users`, { basicAuth: { user: ownerLogin, password: ownerPassword }, body: { username: user, email: options.email || `${user}@example.com`, password, must_change_password: false } });
  if (created.ok) {return { ok: true, created: true };}
  const scopeHint = created.statusCode === 403 ? ` "${ownerLogin}" may not be a Forgejo site admin; create the user manually (e.g. \`forgejo admin user create --username ${user} --email ${user}@example.com --password '<password>'\`) and re-run setup-review.` : '';
  return { ok: false, error: `failed to create Forgejo user ${user} (HTTP ${created.statusCode || 'n/a'}).${scopeHint}`, response: created.data };
}

export function ensureReviewRemote(rootDir: string, remoteName: string, remoteUrl: string) {
  const current = readConfiguredReviewRemote(rootDir, remoteName);
  const result = spawnSync('git', current ? ['-C', rootDir, 'remote', 'set-url', remoteName, remoteUrl] : ['-C', rootDir, 'remote', 'add', remoteName, remoteUrl], { encoding: 'utf8' });
  if (result.status !== 0) {return { ok: false, error: (result.stderr || result.stdout || `git remote ${current ? 'set-url' : 'add'} failed`).trim() };}
  return { ok: true, created: !current, updated: Boolean(current && current !== remoteUrl) };
}
