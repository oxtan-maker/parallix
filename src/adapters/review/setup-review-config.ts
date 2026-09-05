import * as fs from 'fs';
import * as path from 'path';
import { resolveReviewAdapter } from '../config/product-config.js';
import { resolveForgejoSettings, reviewRemoteUrl } from '../forgejo/forgejo.js';
import { apiRequest, isAuthFailure, normalizeBaseUrl, tokenFilePath } from './setup-review-auth.js';
import { readConfiguredReviewRemote, suggestedForgejoUsers } from './setup-review-repository.js';

export function standardLayoutDescription(): string { return ['standard = markdown task storage in `backlog/`', 'missions in `docs/missions/`', 'mission/* branches with auto-detected `main`/`master` primary', 'worktrees in `../<repo>-<slug>`', 'verification via `npm test` with default area `docs`'].join('; '); }
export function buildReviewAdapterConfig(answers: any) { const provider = answers.reviewProvider || 'forgejo'; return provider === 'forgejo' ? { provider, baseUrl: normalizeBaseUrl(answers.baseUrl), remote: answers.reviewRemote, repo: answers.reviewRepo } : { provider }; }
export function buildWorkflowConfig(answers: any) {
  const missions: any = { baseDir: answers.missionsBaseDir || '', branchPrefix: answers.branchPrefix || '', worktreePattern: answers.worktreePattern || '' };
  if (typeof answers.primaryBranch === 'string' && answers.primaryBranch.trim() && !['main', 'master'].includes(answers.primaryBranch.trim())) {missions.primaryBranch = answers.primaryBranch.trim();}
  return { product: { name: answers.productName || '' }, adapters: { tasks: { provider: answers.tasksProvider || '', storage: answers.tasksStorage || '' }, missions, verification: { command: answers.verificationCommand || '', defaultArea: answers.verificationDefaultArea || '' }, review: buildReviewAdapterConfig(answers), agents: {} } };
}
export function writeWorkflowConfig(rootDir: string, config: any): string { const configPath = path.join(rootDir, 'workflow.config.json'); fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8'); return configPath; }
export function evaluateReviewSetup(rootDir?: string, options: any = {}) {
  const { users = suggestedForgejoUsers(), remoteName, remoteUrlFn = reviewRemoteUrl, getRemoteUrlFn = readConfiguredReviewRemote, tokenPathFn = tokenFilePath, requestFn = apiRequest } = options;
  const reviewAdapter = resolveReviewAdapter(rootDir);
  if (reviewAdapter.provider !== 'forgejo') {return { required: false, ok: true, issues: [], steps: [] };}
  const review = resolveForgejoSettings(rootDir);
  if (review.repo === '' || !review.url) {return { required: false, ok: true, issues: [], steps: [] };}
  const issues = []; const steps = []; const missingUsers = users.filter((user: string) => !fs.existsSync(tokenPathFn(user)));
  if (missingUsers.length) {issues.push(`missing Forgejo tokens for: ${missingUsers.join(', ')}`); steps.push('Run `px setup` and enter Forgejo passwords for the agent users you plan to run.');}
  const expectedRemote = remoteUrlFn(rootDir); const configuredRemoteName = remoteName || reviewAdapter.remote || 'review'; const currentRemote = getRemoteUrlFn(rootDir, configuredRemoteName);
  if (!currentRemote) {issues.push(`git remote "${configuredRemoteName}" is missing`); steps.push('Run `px setup` to create the review remote.');} else if (expectedRemote && currentRemote !== expectedRemote) {issues.push(`git remote "${configuredRemoteName}" points at ${currentRemote} instead of ${expectedRemote}`); steps.push('Run `px setup` to update the review remote URL.');}
  if (!missingUsers.length) { for (const user of users) {
    const token = fs.readFileSync(tokenPathFn(user), 'utf8').trim();
    if (!token) {issues.push(`Forgejo token for ${user} is empty`); steps.push('Run `px setup-review` to rotate the empty token file.'); continue;}
    const probe = requestFn('GET', `${normalizeBaseUrl(review.url)}/api/v1/repos/${review.repo}`, { token });
    if (isAuthFailure(probe)) {issues.push(`Forgejo token for ${user} is invalid or expired (HTTP ${probe.statusCode})`); steps.push('Run `px setup-review` and re-enter the Forgejo passwords to rotate local PATs.');}
    else if (!probe.ok && probe.statusCode === 404) {issues.push(`Forgejo review repo ${review.repo} is missing or inaccessible for ${user}`); steps.push('Run `px setup` to recreate the review repo and refresh token/remote wiring.');}
    else if (!probe.ok && probe.statusCode === null) {issues.push(`Forgejo at ${normalizeBaseUrl(review.url)} is unreachable while validating ${user}`); steps.push('Start Forgejo and rerun `px verify-env` or `px setup-review`.');}
  } }
  return issues.length ? { required: true, ok: false, issues, steps } : { required: true, ok: true, issues: [], steps: [] };
}
