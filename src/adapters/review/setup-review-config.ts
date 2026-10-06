import * as fs from 'fs';
import * as path from 'path';
import { resolveReviewAdapter } from '../config/product-config.js';
import { resolveForgejoSettings, reviewRemoteUrl } from '../forgejo/forgejo.js';
import { apiRequest, isAuthFailure, normalizeBaseUrl, tokenFilePath } from './setup-review-auth.js';
import { CLASSIFIER_FORGEJO_USER, readConfiguredReviewRemote, suggestedForgejoUsers } from './setup-review-repository.js';

export function standardLayoutDescription(): string { return ['standard = markdown task storage in `backlog/`', 'missions in `docs/missions/`', 'mission/* branches with auto-detected `main`/`master` primary', 'worktrees in `../<repo>-<slug>`', 'verification via `npm test` with default area `docs`'].join('; '); }
export function buildReviewAdapterConfig(answers: any) { const provider = answers.reviewProvider || 'forgejo'; return provider === 'forgejo' ? { provider, baseUrl: normalizeBaseUrl(answers.baseUrl), remote: answers.reviewRemote, repo: answers.reviewRepo } : { provider }; }
export function buildWorkflowConfig(answers: any) {
  const missions: any = { baseDir: answers.missionsBaseDir || '', branchPrefix: answers.branchPrefix || '', worktreePattern: answers.worktreePattern || '' };
  if (typeof answers.primaryBranch === 'string' && answers.primaryBranch.trim() && !['main', 'master'].includes(answers.primaryBranch.trim())) {missions.primaryBranch = answers.primaryBranch.trim();}
  return { product: { name: answers.productName || '' }, adapters: { tasks: { provider: answers.tasksProvider || '', storage: answers.tasksStorage || '' }, missions, verification: { command: answers.verificationCommand || '', defaultArea: answers.verificationDefaultArea || '' }, review: buildReviewAdapterConfig(answers), agents: {}, draft: { preDraftCommand: answers.preDraftCommand || '' } } };
}
export function writeWorkflowConfig(rootDir: string, config: any): string { const configPath = path.join(rootDir, 'workflow.config.json'); fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8'); return configPath; }
export function evaluateReviewSetup(rootDir?: string, options: any = {}) {
  const { users = suggestedForgejoUsers().filter(user => user !== CLASSIFIER_FORGEJO_USER), remoteName, remoteUrlFn = reviewRemoteUrl, getRemoteUrlFn = readConfiguredReviewRemote, tokenPathFn = tokenFilePath, requestFn = apiRequest } = options;
  const reviewAdapter = resolveReviewAdapter(rootDir);
  if (reviewAdapter.provider !== 'forgejo') {return { required: false, ok: true, issues: [], steps: [] };}
  const review = resolveForgejoSettings(rootDir);
  if (review.repo === '' || !review.url) {return { required: false, ok: true, issues: [], steps: [] };}
  const issues = []; const steps = []; const missingUsers = users.filter((user: string) => !fs.existsSync(tokenPathFn(user)));
  if (missingUsers.length) {issues.push(`missing Forgejo tokens for: ${missingUsers.join(', ')}`); steps.push('Run `px setup` and enter Forgejo passwords for the agent users you plan to run.');}
  const expectedRemote = remoteUrlFn(rootDir); const configuredRemoteName = remoteName || reviewAdapter.remote || 'review'; const currentRemote = getRemoteUrlFn(rootDir, configuredRemoteName);
  if (!currentRemote) {issues.push(`git remote "${configuredRemoteName}" is missing`); steps.push('Run `px setup` to create the review remote.');} else if (expectedRemote && currentRemote !== expectedRemote) {issues.push(`git remote "${configuredRemoteName}" points at ${currentRemote} instead of ${expectedRemote}`); steps.push('Run `px setup` to update the review remote URL.');}
  if (!missingUsers.length) { assessReviewTokens(users, review, tokenPathFn, requestFn, issues, steps); }
  return issues.length ? { required: true, ok: false, issues, steps } : { required: true, ok: true, issues: [], steps: [] };
}

function assessReviewTokens(users: string[], review: { url: string; repo: string }, tokenPathFn: (_user: string) => string, requestFn: Function, issues: string[], steps: string[]): void {
  for (const user of users) {
    const token = fs.readFileSync(tokenPathFn(user), 'utf8').trim();
    const issue = token ? reviewTokenIssue(user, token, review, requestFn) : { issue: `Forgejo token for ${user} is empty`, step: 'Run `px setup-review` to rotate the empty token file.' };
    if (issue) { issues.push(issue.issue); steps.push(issue.step); }
  }
}

function reviewTokenIssue(user: string, token: string, review: { url: string; repo: string }, requestFn: Function) {
  const probe = requestFn('GET', `${normalizeBaseUrl(review.url)}/api/v1/repos/${review.repo}`, { token });
  if (isAuthFailure(probe)) { return { issue: `Forgejo token for ${user} is invalid or expired (HTTP ${probe.statusCode})`, step: 'Run `px setup-review` and re-enter the Forgejo passwords to rotate local PATs.' }; }
  if (!probe.ok && probe.statusCode === 404) { return { issue: `Forgejo review repo ${review.repo} is missing or inaccessible for ${user}`, step: 'Run `px setup` to recreate the review repo and refresh token/remote wiring.' }; }
  if (!probe.ok && probe.statusCode === null) { return { issue: `Forgejo at ${normalizeBaseUrl(review.url)} is unreachable while validating ${user}`, step: 'Start Forgejo and rerun `px verify-env` or `px setup-review`.' }; }
  return null;
}
