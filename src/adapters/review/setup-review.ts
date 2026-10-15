import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import * as fs from 'fs';
import { randomBytes } from 'node:crypto';
import * as path from 'path';
import * as readline from 'readline';
import _cp from 'child_process';
import * as fmt from '../../application/presentation/cli-format.js';
import { loadWorkflowConfig, resolveReviewAdapter } from '../config/product-config.js';
import { resolveForgejoSettings, reviewRemoteUrl } from '../forgejo/forgejo.js';
import ensureWorkflowGitignore from '../filesystem/gitignore.js';
import { PASSWORD_PROMPT_OPTIONS, SETUP_OWNER_TOKEN_SCOPES, apiRequest, buildTokenName, createToken, createTokenWithRetries, normalizeBaseUrl, parseRepoSlug, passwordPrompt, resolveBootstrapForgejoHome, tokenCreateViaOwnerToken, tokenFilePath, unique, writeToken } from './setup-review-auth.js';
import { ensureForgejoUser, ensureRepo, ensureRepoCollaborator, ensureRepoCollaborators, ensureReviewRemote, PARALLIX_FORGEJO_USER, readConfiguredReviewRemote, suggestedForgejoUsers } from './setup-review-repository.js';
import { buildWorkflowConfig, evaluateReviewSetup, standardLayoutDescription, writeWorkflowConfig } from './setup-review-config.js';

import type { WorkflowConfigDraft } from './setup-review-config.js';
import type { AgentPassword, ApiRequestFn, BootstrapFacts, BootstrapTokens, CreatedToken, PromptFn, ReviewBootstrapSetup, ReviewSetupAnswers, SetupAnswerOptions, SetupLog, TokenWarning } from './setup-review-types.js';

const { spawnSync } = _cp;
type BootstrapTokenOptions = { log: SetupLog; promptFn?: PromptFn; requestFn: ApiRequestFn; maxPasswordAttempts: number };
type ReviewBootstrapOptions = Partial<BootstrapTokenOptions> & { error?: SetupLog; interactive?: boolean; forgejoHome?: string; reviewRemoteUrlFn?: (rootDir: string) => string | null };
type SetupOptions = SetupAnswerOptions & ReviewBootstrapOptions & { rootDir?: string; error?: SetupLog; exit?: (code: number) => unknown; verifyFn?: (cwd: string) => { status: number | null } | Promise<{ status: number | null }> };


export function parseYesNo(value: string | undefined, defaultValue?: boolean): boolean { if (typeof value !== 'string' || value.trim() === '') {return defaultValue ?? true;} return ['y', 'yes'].includes(value.trim().toLowerCase()) ? true : ['n', 'no'].includes(value.trim().toLowerCase()) ? false : defaultValue ?? true; }
export function defaultProductName(rootDir?: string): string { return path.basename(rootDir || process.cwd()) || 'Workflow Project'; }
export function defaultRepoSlug(rootDir?: string, ownerLogin?: string): string { return `${ownerLogin || 'human'}/${path.basename(rootDir || process.cwd()) || 'project'}`; }
export function detectPrimaryBranchDefault(rootDir?: string, options: { spawnSyncFn?: (command: string, args: readonly (string | undefined)[], options: { encoding: 'utf8' }) => { status: number | null; stdout?: string }; configuredPrimaryBranch?: string | null } = {}): string {
  const spawnSyncFn = options.spawnSyncFn || ((command, args, settings) => spawnSync(command, args as string[], settings)); const configuredPrimaryBranch = options.configuredPrimaryBranch || null;
  const listed = spawnSyncFn('git', ['-C', rootDir, 'branch', '--list', '--format=%(refname:short)', 'main', 'master'], { encoding: 'utf8' });
  const branches = listed.status === 0 ? (listed.stdout || '').split('\n').map((value: string) => value.trim()).filter(Boolean) : [];
  if (configuredPrimaryBranch && branches.includes(configuredPrimaryBranch)) {return configuredPrimaryBranch;}
  const current = spawnSyncFn('git', ['-C', rootDir, 'branch', '--show-current'], { encoding: 'utf8' }); const branch = current.status === 0 ? (current.stdout || '').trim() : '';
  return branch === 'main' || branch === 'master' ? branch : branches.includes('main') ? 'main' : branches.includes('master') ? 'master' : configuredPrimaryBranch || 'main';
}

type PromptOutput = { write(chunk: string | Buffer, encoding?: BufferEncoding | (() => void), callback?: () => void): boolean };
type PromptInterface = { question(query: string, callback: (answer: string) => void): void; close(): void };
type PromptOptions = { hidden?: boolean; input?: NodeJS.ReadStream; output?: PromptOutput; createInterface?: (options: { input: NodeJS.ReadStream; output: PromptOutput; terminal: boolean }) => PromptInterface };

function maskPromptChunk(chunk: string | Buffer): string {
  return [...String(chunk)].map(character => character === '\b' || character === '\x7f' ? '\b \b' : character >= ' ' && character !== '\u001b' ? '*' : '').join('');
}

export async function promptLine(prompt: string, options: PromptOptions = {}): Promise<string> {
  const { hidden = false, input = process.stdin } = options;
  const output: PromptOutput = options.output ?? process.stdout;
  const createInterface = options.createInterface ?? (settings => readline.createInterface({ ...settings, output: settings.output as NodeJS.WritableStream }));
  return await new Promise(resolve => {
    const rl = createInterface({ input, output, terminal: true });
    if (!hidden) { rl.question(prompt, answer => { rl.close(); resolve(answer.trim()); }); return; }
    const originalWrite = output.write.bind(output);
    output.write = (chunk: string | Buffer, encoding?: BufferEncoding | (() => void), cb?: () => void) => {
      const masked = maskPromptChunk(chunk);
      if (masked) { return originalWrite(masked, encoding, cb); }
      const callback = typeof encoding === 'function' ? encoding : cb;
      callback?.();
      return true;
    };
    originalWrite(prompt);
    rl.question('', answer => { output.write = originalWrite; rl.close(); output.write('\n'); resolve(answer.trim()); });
  });
}

async function collectAgentCredentials(promptFn: PromptFn, users: string[]) {
  const defaultUsers = users.join(',');
  const userList = (await promptFn(`Agent Forgejo users [${defaultUsers}]: `)) || defaultUsers;
  const agentUsers = unique(userList.split(',').map(value => value.trim()).filter(Boolean));
  const agentPasswords: AgentPassword[] = [];
  for (const user of agentUsers) {
    const password = await promptFn(passwordPrompt(user, { allowBlank: true }), PASSWORD_PROMPT_OPTIONS);
    if (password) { agentPasswords.push({ user, password }); }
  }
  return { agentUsers, agentPasswords };
}

async function promptDefault(promptFn: PromptFn, label: string, value: string): Promise<string> {
  return (await promptFn(`${label} [${value}]: `)) || value;
}

export async function collectSetupAnswers(rootDir?: string, options: SetupAnswerOptions = {}) {
  const { promptFn = promptLine, log = fmt.log.info, users = suggestedForgejoUsers(), resolveForgejoSettingsFn = resolveForgejoSettings } = options;
  const review = resolveForgejoSettingsFn(rootDir);
  const ownerLogin = await promptDefault(promptFn, 'Forgejo login with repo-create access', parseRepoSlug(review.repo || '')?.owner || 'human');
  log(fmt.status('INFO', `Forgejo setup target: ${review.url || 'unset'} / ${review.repo || 'unset'}`));
  log(fmt.status('INFO', 'Forgejo review bootstrap will ask for one repo-creating login password and then optional passwords for each listed agent user.'));
  log(fmt.status('INFO', 'Leave an agent password blank to skip writing a token for that user on this machine.'));
  const ownerPassword = await promptFn(passwordPrompt(ownerLogin), PASSWORD_PROMPT_OPTIONS);
  return { baseUrl: review.url, repo: review.repo, ownerLogin, ownerPassword, ...await collectAgentCredentials(promptFn, users) };
}

type WizardConfig = { product?: { name?: string }; adapters?: { [K in keyof WorkflowConfigDraft['adapters']]?: Partial<WorkflowConfigDraft['adapters'][K]> } };

async function collectLayoutAnswers(promptFn: PromptFn, adapters: NonNullable<WizardConfig['adapters']>, primaryBranch: string, useDefaults: boolean) {
  const defaults = { tasksProvider: 'backlog-md', tasksStorage: 'backlog', missionsBaseDir: 'docs/missions', branchPrefix: 'mission/', primaryBranch, worktreePattern: '../<repo>-<slug>', verificationCommand: 'npm test', verificationDefaultArea: 'docs' };
  if (useDefaults) { return defaults; }
  const { tasks = {}, missions = {}, verification = {} } = adapters;
  return {
    tasksProvider: 'backlog-md',
    tasksStorage: await promptDefault(promptFn, 'Task storage path', tasks.storage || defaults.tasksStorage),
    missionsBaseDir: await promptDefault(promptFn, 'Mission base dir', missions.baseDir || defaults.missionsBaseDir),
    branchPrefix: await promptDefault(promptFn, 'Mission branch prefix', missions.branchPrefix || defaults.branchPrefix),
    primaryBranch: await promptDefault(promptFn, 'Primary branch', primaryBranch),
    worktreePattern: await promptDefault(promptFn, 'Worktree pattern', missions.worktreePattern || defaults.worktreePattern),
    verificationCommand: await promptDefault(promptFn, 'Verification command', verification.command || defaults.verificationCommand),
    verificationDefaultArea: await promptDefault(promptFn, 'Default verification area', verification.defaultArea || defaults.verificationDefaultArea),
  };
}

async function collectBootstrapAnswers(promptFn: PromptFn, log: SetupLog, ownerLogin: string, users: string[]) {
  const bootstrapReview = parseYesNo(await promptFn('Create/update the Forgejo repo, token files, and review remote now? This will ask for the repo-owner password and optional agent passwords. [Y/n]: '), true);
  if (!bootstrapReview) { return { bootstrapReview, ownerPassword: '', agentPasswords: [], agentUsers: users }; }
  log(fmt.status('INFO', 'Forgejo bootstrap is enabled. Hidden password prompts are next: first for the repo-creating login, then once per listed agent user.'));
  const ownerPassword = await promptFn(passwordPrompt(ownerLogin), PASSWORD_PROMPT_OPTIONS);
  return { bootstrapReview, ownerPassword, ...await collectAgentCredentials(promptFn, users) };
}

async function collectReviewTarget(promptFn: PromptFn, review: Partial<WorkflowConfigDraft['adapters']['review']>, rootDir?: string) {
  const ownerLogin = await promptDefault(promptFn, 'Forgejo login with repo-create access', parseRepoSlug(review.repo || '')?.owner || 'human');
  const reviewRepo = await promptDefault(promptFn, 'Forgejo review repo', review.repo || defaultRepoSlug(rootDir, ownerLogin));
  const baseUrl = normalizeBaseUrl(await promptDefault(promptFn, 'Forgejo base URL', review.baseUrl || 'http://localhost:3300'));
  const reviewRemote = await promptDefault(promptFn, 'Git review remote name', review.remote || 'review');
  return { ownerLogin, reviewRepo, baseUrl, reviewRemote };
}

function configuredWizardBranch(adapters: NonNullable<WizardConfig['adapters']>): string | null { return adapters.missions?.primaryBranch || null; }

export async function collectWizardAnswers(rootDir?: string, options: SetupAnswerOptions = {}) {
  const { promptFn = promptLine, log = fmt.log.info, users = suggestedForgejoUsers(), loadWorkflowConfigFn = loadWorkflowConfig, detectPrimaryBranchDefaultFn = detectPrimaryBranchDefault } = options;
  const existing = loadWorkflowConfigFn(rootDir);
  const config = (existing.found ? existing.config : null) as WizardConfig | null;
  const adapters = config?.adapters || {};
  const review = adapters.review || {};
  const primaryBranch = detectPrimaryBranchDefaultFn(rootDir, { configuredPrimaryBranch: configuredWizardBranch(adapters) });
  const productName = await promptDefault(promptFn, 'Product name', config?.product?.name || defaultProductName(rootDir));
  log(fmt.status('INFO', `Standard workflow layout: ${standardLayoutDescription()}`));
  const useDefaults = parseYesNo(await promptFn('Use the standard markdown task workflow layout and defaults? [Y/n]: '), true);
  const target = await collectReviewTarget(promptFn, review, rootDir);
  const defaults = await collectLayoutAnswers(promptFn, adapters, primaryBranch, useDefaults);
  const bootstrap = await collectBootstrapAnswers(promptFn, log, target.ownerLogin, users);
  return { productName, ...target, ...bootstrap, ...defaults };
}

export function buildNonInteractiveAnswers(rootDir: string, options: SetupAnswerOptions = {}) {
  const log = options.log || fmt.log.plain; const configuration: ParallixConfiguration = options.configuration ?? DEFAULT_CONFIGURATION; const productName = configuration.setup.productName || defaultProductName(rootDir); const reviewProvider = configuration.setup.reviewProvider || 'none'; const answers: ReviewSetupAnswers = { productName, reviewProvider, tasksProvider: 'backlog-md', tasksStorage: 'backlog', missionsBaseDir: 'docs/missions', branchPrefix: 'mission/', primaryBranch: detectPrimaryBranchDefault(rootDir), worktreePattern: '../<repo>-<slug>', verificationCommand: 'npm test', verificationDefaultArea: 'docs', bootstrapReview: false };
  if (reviewProvider === 'forgejo') {const ownerLogin = configuration.setup.ownerLogin || 'human'; const baseUrl = normalizeBaseUrl(configuration.setup.forgejoUrl || 'http://localhost:3300'); const reviewRepo = configuration.setup.forgejoRepo || defaultRepoSlug(rootDir, ownerLogin); const agentUsers = configuration.setup.agentUsers ? configuration.setup.agentUsers.split(',').map(user => user.trim()).filter(Boolean) : suggestedForgejoUsers(); const ownerPassword = configuration.setup.ownerPassword || ''; Object.assign(answers, { ownerLogin, baseUrl, reviewRepo, reviewRemote: configuration.setup.reviewRemote || 'review', bootstrapReview: Boolean(ownerPassword), ownerPassword, agentPasswords: configuration.setup.agentPassword ? agentUsers.map(user => ({ user, password: configuration.setup.agentPassword || '' })) : [], agentUsers }); log(fmt.status('INFO', `Non-interactive setup: product=${productName}, repo=${reviewRepo}, url=${baseUrl}`));} else {log(fmt.status('INFO', `Non-interactive setup: product=${productName}, review=none (no Forgejo)`));}
  return answers;
}

/**
 * One agent's Forgejo user + token. A failure is collected as a warning rather
 * than aborting: a single agent without a token must not stop the operator from
 * finishing the review surface for every other agent.
 */
async function bootstrapAgentToken(setup: ReviewBootstrapSetup, baseUrl: string, agent: AgentPassword, forgejoHome: string, options: BootstrapTokenOptions): Promise<{ warning?: TokenWarning; createdToken?: CreatedToken }> {
  const { log, promptFn, requestFn, maxPasswordAttempts } = options;
  if (agent.password) {
    const user = ensureForgejoUser(baseUrl, agent.user, setup.ownerLogin, setup.ownerPassword ?? '', agent.password, requestFn);
    if (!user.ok) { return { warning: { user: agent.user, error: user.error ?? 'Forgejo user creation failed', response: user.response } }; }
    if (user.created) { log(fmt.status('PASS', `Created Forgejo user ${agent.user}.`)); }
  }
  const token = await createTokenWithRetries({ ...setup, baseUrl }, agent.user, agent.password, { allowBlank: true, log, promptFn, maxAttempts: maxPasswordAttempts, requestFn });
  if (!token.ok) { return { warning: { user: agent.user, error: token.error, response: token.response } }; }
  if (token.skipped) { return {}; }
  return { createdToken: { user: agent.user, path: writeToken(agent.user, token.token, forgejoHome) } };
}

/** Mint the owner token, then one token per configured agent, prompting as needed. */
async function bootstrapInteractiveTokens(setup: ReviewBootstrapSetup, baseUrl: string, forgejoHome: string, options: BootstrapTokenOptions): Promise<BootstrapTokens> {
  const { log, promptFn, requestFn, maxPasswordAttempts } = options;
  const owner = await createTokenWithRetries({ ...setup, baseUrl }, setup.ownerLogin, setup.ownerPassword ?? '', { allowBlank: false, log, promptFn, maxAttempts: maxPasswordAttempts, requestFn, scopes: SETUP_OWNER_TOKEN_SCOPES });
  if (!owner.ok) { return owner; }
  if (owner.skipped) { return { ok: false, error: `Password is required for ${setup.ownerLogin}.` }; }
  const ownerToken = owner.token;
  const createdTokens: CreatedToken[] = [{ user: setup.ownerLogin, path: writeToken(setup.ownerLogin, ownerToken, forgejoHome) }];
  const warnings: TokenWarning[] = [];
  for (const agent of setup.agentPasswords ?? []) {
    const result = await bootstrapAgentToken(setup, baseUrl, agent, forgejoHome, options);
    if (result.warning) { warnings.push(result.warning); }
    if (result.createdToken) { createdTokens.push(result.createdToken); }
  }
  return { ok: true, ownerToken, createdTokens, warnings };
}

/** Read the owner token a non-interactive run bootstraps every agent token from. */
function readBootstrapOwnerToken(setup: ReviewBootstrapSetup, forgejoHome: string) {
  const file = path.join(forgejoHome, 'tokens', setup.ownerLogin);
  const ownerToken = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
  return ownerToken
    ? { ok: true as const, ownerToken }
    : { ok: false as const, error: `No owner token found for ${setup.ownerLogin} at ${file}. A token file for an existing user (typically human) is required to bootstrap new agent tokens.` };
}

/** Report what the bootstrap created, granted, wrote and skipped. */
function logBootstrapOutcome(setup: ReviewBootstrapSetup, log: SetupLog, facts: BootstrapFacts): void {
  if (facts.grantedCollaborators.length) { log(fmt.status('PASS', `Granted access on ${setup.repo} to ${facts.grantedCollaborators.join(', ')}`)); }
  log(fmt.status('PASS', `Forgejo repo ${setup.repo} ${facts.repoCreated ? 'created' : 'already exists'}.`));
  for (const token of facts.createdTokens) { log(fmt.status('PASS', `Wrote Forgejo token for ${token.user} to ${token.path}`)); }
  for (const warning of facts.warnings) {
    log(fmt.status('WARN', `Skipping Forgejo token for ${warning.user}: ${warning.error}`));
    if (warning.response) { log(fmt.status('INFO', `Forgejo response for ${warning.user}: ${JSON.stringify(warning.response)}`)); }
  }
  log(fmt.status('PASS', `Review remote "${facts.remoteName}" now points at ${facts.remoteUrl}`));
}

function ensureBootstrapAccounts(setup: ReviewBootstrapSetup, baseUrl: string, collaborators: string[], ownerToken: string, requestFn: ApiRequestFn, log: SetupLog) {
    for (const user of collaborators) {
      const account = ensureForgejoUser(baseUrl, user, setup.ownerLogin, '', randomBytes(32).toString('base64url'), requestFn, { ownerToken });
      if (!account.ok) { return account; }
      if (account.created) { log(fmt.status('PASS', `Created Forgejo user ${user}.`)); }
    }
  return { ok: true };
}

function grantBootstrapCollaborators(setup: ReviewBootstrapSetup, baseUrl: string, ownerToken: string, collaborators: string[], requestFn: ApiRequestFn): { ok: false; error?: string; response?: unknown } | { ok: true; created: string[] } {
  const collaboratorResult = ensureRepoCollaborators(baseUrl, setup.repo ?? '', ownerToken, collaborators.filter((user) => user !== PARALLIX_FORGEJO_USER), 'write', requestFn);
  if (!collaboratorResult.ok) { return { ...collaboratorResult, ok: false }; }
  if (collaborators.includes(PARALLIX_FORGEJO_USER)) {
    const parallix = ensureRepoCollaborator(baseUrl, setup.repo ?? '', ownerToken, PARALLIX_FORGEJO_USER, 'admin', requestFn);
    if (!parallix.ok) { return { ...parallix, ok: false }; }
    if (parallix.created) { collaboratorResult.created.push(`${PARALLIX_FORGEJO_USER} (admin)`); }
  }

  return { ...collaboratorResult, ok: true };
}

function finishBootstrap(rootDir: string, setup: ReviewBootstrapSetup, log: SetupLog, facts: Omit<BootstrapFacts, 'remoteName' | 'remoteUrl'>, reviewRemoteUrlFn: (rootDir: string) => string | null) {
  const remoteUrl = reviewRemoteUrlFn(rootDir);
  const remoteName = resolveReviewAdapter(rootDir).remote || 'review';
  const remote = remoteUrl ? ensureReviewRemote(rootDir, remoteName, remoteUrl) : { ok: true };
  if (!remote.ok) { return remote; }
  logBootstrapOutcome(setup, log, { ...facts, remoteName, remoteUrl });
  return { ok: true };
}

function bootstrapCollaborators(setup: ReviewBootstrapSetup) { return unique([...(setup.agentUsers || []), ...(setup.agentPasswords || []).map(agent => agent.user)].filter(Boolean)); }

type BootstrapSurface = { setup: ReviewBootstrapSetup; baseUrl: string; forgejoHome: string; collaborators: string[]; ownerToken: string; createdTokens: CreatedToken[]; warnings: TokenWarning[]; interactive: boolean; requestFn: ApiRequestFn; log: SetupLog; repoInfo: { owner: string; repo: string } };

function provisionBootstrapSurface(context: BootstrapSurface): { ok: false; error?: string; response?: unknown } | { ok: true; repoCreated?: boolean; grantedCollaborators: string[] } {
  const { setup, baseUrl, forgejoHome, collaborators, ownerToken, createdTokens, warnings, interactive, requestFn, log, repoInfo } = context;
  if (!interactive) {
    const accounts = ensureBootstrapAccounts(setup, baseUrl, collaborators, ownerToken, requestFn, log);
    if (!accounts.ok) { return { ...accounts, ok: false }; }
  }

  const repo = ensureRepo(baseUrl, setup.repo ?? '', setup.ownerLogin, ownerToken, requestFn);
  if (!repo.ok) { return { ...repo, ok: false }; }
  const collaboratorResult = grantBootstrapCollaborators(setup, baseUrl, ownerToken, collaborators, requestFn);
  if (!collaboratorResult.ok) { return collaboratorResult; }

  if (!interactive) {
    const tokens = tokenCreateViaOwnerToken(baseUrl, setup.repo ?? '', ownerToken, setup.agentPasswords ?? [], repoInfo, { requestFn, writeTokenFn: writeToken, forgejoHome });
    if (!tokens.ok) { return { ...tokens, ok: false }; }
    createdTokens.push(...tokens.createdTokens);
    warnings.push(...tokens.warnings);
  }

  return { ok: true as const, repoCreated: repo.created, grantedCollaborators: collaboratorResult.created };
}

function bootstrapOptions(options: ReviewBootstrapOptions) {
  const { log = fmt.log.info, promptFn, requestFn = apiRequest, maxPasswordAttempts = 3, interactive = true, reviewRemoteUrlFn = reviewRemoteUrl } = options;
  return { log, promptFn, requestFn, maxPasswordAttempts, interactive, reviewRemoteUrlFn };
}

export async function bootstrapReviewSurface(rootDir: string, setup: ReviewBootstrapSetup, options: ReviewBootstrapOptions = {}) {
  const { log, promptFn, requestFn, maxPasswordAttempts, interactive, reviewRemoteUrlFn } = bootstrapOptions(options);
  const forgejoHome = resolveBootstrapForgejoHome(rootDir, options.forgejoHome);
  const repoInfo = parseRepoSlug(setup.repo);
  const baseUrl = normalizeBaseUrl(setup.baseUrl);
  if (!baseUrl || !repoInfo) { return { ok: false, error: 'workflow.config.json must define adapters.review.baseUrl and adapters.review.repo before setup can run.' }; }

  const collaborators = bootstrapCollaborators(setup);
  const tokenOptions = { log, promptFn, requestFn, maxPasswordAttempts };
  const bootstrapped: BootstrapTokens = interactive
    ? await bootstrapInteractiveTokens(setup, baseUrl, forgejoHome, tokenOptions)
    : readBootstrapOwnerToken(setup, forgejoHome);
  if (!bootstrapped.ok) { return bootstrapped; }
  const ownerToken = bootstrapped.ownerToken;
  const createdTokens: CreatedToken[] = bootstrapped.createdTokens ?? [];
  const warnings: TokenWarning[] = bootstrapped.warnings ?? [];

  const surface = provisionBootstrapSurface({ setup, baseUrl, forgejoHome, collaborators, ownerToken, createdTokens, warnings, interactive, requestFn, log, repoInfo });
  if (!surface.ok) { return surface; }

  const finished = finishBootstrap(rootDir, setup, log, { repoCreated: surface.repoCreated, grantedCollaborators: surface.grantedCollaborators, createdTokens, warnings }, reviewRemoteUrlFn);
  if (!finished.ok) { return finished; }

  return interactive ? { ok: true, warnings } : { ok: true, warnings, createdTokens };
}

export async function setupReview(_args: string[], options: SetupOptions = {}) { const rootDir = options.rootDir || process.cwd(); const log = options.log || fmt.log.plain; const error = options.error || fmt.log.plainError; const exit = options.exit || process.exit; const result = await bootstrapReviewSurface(rootDir, await collectSetupAnswers(rootDir, { promptFn: options.promptFn || promptLine, log }), { ...options, forgejoHome: resolveBootstrapForgejoHome(rootDir, options.forgejoHome) }); if (!result.ok) {error(fmt.status('FAIL', ('error' in result ? result.error : '') || '')); if (('response' in result ? result.response : undefined)) {error(fmt.status('INFO', `Forgejo response: ${JSON.stringify(('response' in result ? result.response : undefined))}`));} exit(1);} }
export async function runVerifyEnv(rootDir: string, options: Pick<SetupOptions, 'verifyFn'> = {}) { return (options.verifyFn || ((cwd: string) => spawnSync('node', ['workflow', 'verify-env'], { cwd, stdio: 'inherit', encoding: 'utf8' })))(rootDir); }
function reportGitignore(rootDir: string, log: SetupLog) {
  const gitignore = ensureWorkflowGitignore(rootDir, { logFn: log });
  if (gitignore.created) { log(fmt.status('PASS', `Created .gitignore with ${gitignore.appended} workflow entries in ${fmt.path(rootDir)}`)); }
  else if (gitignore.appended > 0) { log(fmt.status('PASS', `Appended ${gitignore.appended} workflow entries to .gitignore in ${fmt.path(rootDir)}`)); }
  else if (gitignore.skipped) { log(fmt.status('INFO', `.gitignore in ${fmt.path(rootDir)}: ${gitignore.reason === 'symlink' ? 'symbolic link (skipped)' : 'not a git repo (skipped)'}`)); }
  else { log(fmt.status('PASS', `.gitignore in ${fmt.path(rootDir)} already contains all workflow entries`)); }
}

function nonInteractiveSetup(args: string[], options: SetupOptions) { return args?.includes('--non-interactive') || (options.configuration?.setup.nonInteractive ?? DEFAULT_CONFIGURATION.setup.nonInteractive) === '1'; }

export async function setupWizard(args: string[], options: SetupOptions = {}) {
  const rootDir = options.rootDir || process.cwd();
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const answers: ReviewSetupAnswers = nonInteractiveSetup(args, options)
    ? buildNonInteractiveAnswers(rootDir, { log, configuration: options.configuration })
    : await collectWizardAnswers(rootDir, { ...options, promptFn: options.promptFn || promptLine, log });
  log(fmt.status('PASS', `Wrote ${writeWorkflowConfig(rootDir, buildWorkflowConfig(answers))}`));
  reportGitignore(rootDir, log);
  if (answers.bootstrapReview) {
    const result = await bootstrapReviewSurface(rootDir, { baseUrl: answers.baseUrl, repo: answers.reviewRepo, ownerLogin: answers.ownerLogin ?? 'human', ownerPassword: answers.ownerPassword, agentPasswords: answers.agentPasswords, agentUsers: answers.agentUsers }, { ...options, forgejoHome: resolveBootstrapForgejoHome(rootDir, options.forgejoHome) });
    if (!result.ok) { error(fmt.status('FAIL', ('error' in result ? result.error : '') || '')); exit(1); return; }
  } else { log(fmt.status('INFO', 'Skipped Forgejo bootstrap. You can run `px setup-review` later if needed.')); }
  const verified = await runVerifyEnv(rootDir, options);
  if (verified?.status) { exit(verified.status); }
}


export { apiRequest, buildTokenName, buildWorkflowConfig, createToken, ensureForgejoUser, ensureRepo, ensureReviewRemote, evaluateReviewSetup, parseRepoSlug, readConfiguredReviewRemote, resolveBootstrapForgejoHome, standardLayoutDescription, tokenFilePath, writeToken, writeWorkflowConfig };
