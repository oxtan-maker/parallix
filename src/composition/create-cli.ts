#!/usr/bin/env node
import { withinCliInvocation } from './review-operator-resume.js';
import { createCliServiceScope, type CliCommandContext } from './cli-service-scope.js';
import { createAuthoringCommands } from './cli-authoring-commands.js';
import { createLegacyCommands } from './cli-legacy-commands.js';
import { createReadCommands } from './cli-read-commands.js';
import { createLifecycleCommands } from './cli-lifecycle-commands.js';
import { createLeadSupervisorPort, leadRecoveryWorkspace } from './lead-supervisor.js';
import { commandInvocation } from './command-invocation.js';

import { resolveConfiguration, resolveProcessConfiguration } from './config.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';

import fs from 'node:fs';
import { captureMissionCommand, hostMissionCommand } from './mission-terminal.js';
import { cliInvocation, type CliInvocation } from '../adapters/process/cli-invocation.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fmt from '../application/presentation/cli-format.js';

import { packageRoot } from '../adapters/filesystem/package-root.js';
import packageJson from '../../package.json' with { type: 'json' };
import { ensureStandaloneGitRepo, hasGitRepository } from '../adapters/config/product-config.js';
import { loadStateMap } from '../adapters/config/state-map.js';
import activeWorkflow from '../adapters/cli/commands/active.js';
import { createActiveCommand } from '../interfaces/cli/active.js';

import { ensureFirstRunAgentConfig } from '../adapters/agents/first-run-config.js';

import configWorkflow from '../adapters/cli/commands/config.js';
import { createConfigCommand } from '../interfaces/cli/config.js';
import diffWorkflow from '../adapters/cli/commands/diff.js';
import { createDiffCommand } from '../interfaces/cli/diff.js';

import { createLeadCommand } from '../interfaces/cli/lead.js';

import { currentWorkPublication } from '../application/recording/current-work-recorder.js';

import { FRESH_SESSION_MARKER_PORT } from '../application/recovery-supervisor.js';
import type { SupervisorPort } from '../application/recovery-supervisor.js';

import { missionId } from '../domain/mission.js';

import * as agents from '../adapters/agents/agents.js';
import { recordStageStatsSafe, stageLaunchSinceMs } from '../adapters/review/review-agent-fallback.js';
import { resolveAgentModel } from '../adapters/config/product-config.js';

import startupPreflight from '../adapters/cli/startup-preflight.js';

import resolveConflictWorkflow from '../adapters/cli/commands/resolve-conflict.js';
import { createResolveConflictCommand } from '../interfaces/cli/resolve-conflict.js';

import { setupWizard } from '../adapters/review/setup-review.js';
import { createSetupCommand } from '../interfaces/cli/setup.js';
import setupReview from '../adapters/cli/commands/setup-review.js';

import verifyWorkflow from '../adapters/verification/verification.js';
import { createVerifyCommand } from '../interfaces/cli/verify.js';

import { deriveAliases, type Command, type MainOptions } from '../interfaces/cli/runtime.js';
import { createProductionApplicationServices } from './application-services.js';

import { bindReviewPersistence } from './review-persistence.js';

function resolveRuntimePath(): string {
  return fileURLToPath(import.meta.url);
}

const runtimePath = resolveRuntimePath();
const runtimeDir = path.dirname(runtimePath);
const packageDir = packageRoot(runtimeDir);

process.setSourceMapsEnabled(true);

interface ParsedArgs {
  target: string;
  command: string;
  args: string[];
}

interface VersionInfo {
  name: string;
  version: string;
  pxPath: string;
  packageRoot: string;
  node: string;
}

interface ReviewEventParsed {
  slug: string;
  type: string | null;
  actor: string | null;
  content: string;
  disposition: string | null;
  timestamp: string | null;
  skipGit: boolean;
}

interface RunOptions {
  operatorInvocation?: boolean;
  cliInvocation?: CliInvocation;
  log?: typeof fmt.log.plain;
  error?: typeof fmt.log.plainError;
  baseCwd?: string;
  /** Host environment to resolve configuration from; defaults to the process environment. */
  environment?: NodeJS.ProcessEnv;
}

function createCommandRegistry(rootDir: string, configuration: ParallixConfiguration, operatorReview = false): Record<string, Command> {
  const scope = createCliServiceScope(rootDir, configuration);
  const { withGraph } = scope;
  const active = createActiveCommand((request, options) => activeWorkflow([...request.args], options));
  const config = createConfigCommand((request, options) => configWorkflow([...request.args], options));
  const diff = createDiffCommand((request, options) => diffWorkflow([...request.args], options));
  const resolveConflict = createResolveConflictCommand((request, options) => resolveConflictWorkflow([...request.args], options));
  const setup = createSetupCommand((request, options) => setupWizard([...request.args], options));
  const verify = createVerifyCommand((request, options) => verifyWorkflow([...request.args], options));
  const context: CliCommandContext = { rootDir, configuration, packageDir, scope, active, operatorReview, commands: () => registry };
  const configuredCommands: Record<string, Command> = {
    config,
    diff,
    'verify-env': startupPreflight,
    'resolve-conflict': resolveConflict,
    setup,
    'setup-review': setupReview,
    verify,
    ...createAuthoringCommands(context), ...createLegacyCommands(context), ...createReadCommands(context), ...createLifecycleCommands(context),
  };
  const registry: Record<string, Command> = Object.fromEntries(["active", "recover", "config", "goal", "repro", "classification", "scope", "gate", "criterion", "mission", "depends", "nel", "checkpoint", "assign", "verdict", "resolve", "revoke-review", "revoke", "unassign", "diff", "history", "attach", "draft", "integrate", "cancel", "import-legacy", "migrate-legacy-adhoc-ids", "audit-legacy", "verify-env", "rebase", "resolve-conflict", "review", "setup", "setup-review", "stats", "github-publish-status", "status", "verify", "web", "ui"].map(name => [name, configuredCommands[name]]));
  registry.lead = (args: string[]) => withGraph(async services => {
    const forwards = new Set<Promise<unknown>>();
    const currentWork = services.currentWork;
    const launchRecovery: SupervisorPort['launchRecovery'] = async (request) => {
      fmt.log.info(`[lead] Starting fresh recovery agent for ${fmt.slug(request.missionId)} with a general diagnostic prompt`);
      let publication: ReturnType<typeof currentWorkPublication> = null;
      try {
        const { worktree, prompt } = leadRecoveryWorkspace(request);
        fmt.log.info(`[lead] Recovery prompt for ${fmt.slug(request.missionId)}:\n---\n${prompt}\n---`);
        const assigned = await services.mission?.store.load(missionId(request.missionId));
        const assignedAgent = assigned?.kind === 'found' ? assigned.mission.assignee ?? undefined : undefined;
        publication = currentWorkPublication({
          slug: request.missionId,
          operationId: `recovery-${Date.now()}`,
          phase: 'recovery',
          summary: `recovery agent working ${request.missionId} after ${request.attemptedOperation}`,
        });
        if (publication) { await currentWork.running(publication); }
        const launched = await agents.startAgent('execute', {
          configuration,
          prompt,
          worktree,
          agent: assignedAgent,
          slug: request.missionId,
          role: 'implementer',
          // Without this the launcher would resume the implementer session
          // that got stuck. Recovery is a new context by definition.
          sessionMarkerPort: FRESH_SESSION_MARKER_PORT,
        });
        const agent = launched?.agent;
        // A recovery agent spends tokens like any other launch. Recording it
        // on the mission's execute stage is what keeps the mission's usage
        // from under-reporting the work the supervisor caused.
        if (agent) {
          await recordStageStatsSafe('active', {
            stage: 'recovery',
            slug: request.missionId,
            rootDir: worktree,
            worktree,
            implementer: agent,
            result: launched?.result,
            sinceMs: stageLaunchSinceMs(launched?.result),
            model: resolveAgentModel(agent, worktree),
          });
        }
        fmt.log.info(`[lead] Recovery agent ${agent ?? 'with no reported family'} finished for ${fmt.slug(request.missionId)}; rechecking the board`);
        return `${agent ?? 'agent with no reported family'} ran in ${worktree}`;
      } catch (error) {
        fmt.log.fail(`[lead] Recovery agent for ${fmt.slug(request.missionId)} failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      } finally {
        if (publication) { await currentWork.ended(publication); }
      }
    };
    try { return await createLeadCommand(createLeadSupervisorPort(services, forwards, { rootDir, scope, active, registry, runPublicCli: run, launchRecovery }))(args); }
    finally { await Promise.allSettled(forwards); }
  });
  return registry;
}

/**
 * Bind the review verbs to the existing recorders. Composition owns the adapter
 * imports so the interface module stays free of them.
 */

/** Mission write services, or a clear error when the operator DB is unavailable. */

function createRuntimeOptions(rootDir: string, configuration: ParallixConfiguration, operatorReview = false): Pick<MainOptions, 'commandFns' | 'ensureStandaloneGitRepoFn' | 'loadAliasesFn' | 'product' | 'runtime'> {
  return {
    commandFns: Object.fromEntries(Object.entries(createCommandRegistry(rootDir, configuration, operatorReview)).map(([name, command]) => [name, (args: string[], options: Record<string, unknown> = {}) => command(args, { ...options, configuration })])),
    runtime: configuration.runtime,
    ensureStandaloneGitRepoFn: ensureStandaloneGitRepo,
    loadAliasesFn: options => deriveAliases(loadStateMap(options)),
    product: { name: packageJson.name, version: packageJson.version },
  };
}

export function parseArgs(argv: string[], baseCwd = process.cwd()): ParsedArgs {
  const args = [...argv];
  if (args[0] === '--version' || args[0] === '-v') {
    return { target: path.resolve(baseCwd), command: 'version', args: [] };
  }

  const command = args.shift();
  // No command provided: return empty string so the caller can print usage.
  // This satisfies architecture invariant's "non-TTY bare px prints help" requirement.
  if (!command) {
    return { target: path.resolve(baseCwd), command: '', args: [] };
  }

  return { target: path.resolve(baseCwd), command, args };
}

// Emits a shell function named `px` that wraps the globally installed `px`
// runner and switches the caller's terminal into the next mission worktree
// when the runtime prints a transition signal. A shell function always runs in
// the current shell, so it can `cd` the caller (an npm `bin` subprocess cannot).
// Install with:  eval "$(px shell-init bash)"   (or zsh) in your shell rc.
export function shellInit(shell = 'bash'): string {
  const normalized = String(shell || 'bash').toLowerCase();
  if (normalized !== 'bash' && normalized !== 'zsh') {
    throw new Error(`Unsupported shell for shell-init: ${shell} (supported: bash, zsh)`);
  }
  // zsh exposes pipe statuses via the lowercase 1-indexed `pipestatus` array;
  // bash uses the uppercase 0-indexed `PIPESTATUS`.
  const exitCapture = normalized === 'zsh'
    ? '_px_exit=${pipestatus[1]}'
    : '_px_exit=${PIPESTATUS[0]}';

  return [
    '# px shell integration. Add to your shell rc:',
    `#   eval "$(px shell-init ${normalized})"`,
    '# Defines a `px` shell function that runs the globally installed `px` and',
    '# changes your terminal into the next mission worktree on transitions.',
    'px() {',
    '  local _px_log _px_exit _px_signal _px_target _px_current',
    '  _px_log="$(mktemp)" || return 1',
    '  command px "$@" 2>&1 | tee "$_px_log"',
    `  ${exitCapture}`,
    '  _px_signal="$(grep "\\\\[INFO\\\\] Next: cd " "$_px_log" | tail -n 1 | sed "s/.*\\\\[INFO\\\\] Next: cd //")"',
    '  if [ -z "$_px_signal" ]; then',
    '    _px_signal="$(grep "\\\\[INFO\\\\] Working directory: " "$_px_log" | tail -n 1 | sed "s/.*\\\\[INFO\\\\] Working directory: //")"',
    '  fi',
    '  rm -f "$_px_log"',
    '  if [ -n "$_px_signal" ]; then',
    '    _px_target="${_px_signal#"${_px_signal%%[![:space:]]*}"}"',
    '    _px_target="${_px_target%"${_px_target##*[![:space:]]}"}"',
    '    if [ -d "$_px_target" ]; then',
    '      _px_current="$(pwd -P 2>/dev/null)"',
    '      if [ "$_px_current" != "$(cd "$_px_target" && pwd -P)" ]; then',
    '        cd "$_px_target" && echo "[px] Switched terminal context to: $(pwd)"',
    '      fi',
    '    fi',
    '  fi',
    '  return $_px_exit',
    '}',
    '',
  ].join('\n');
}

export function versionInfo(): VersionInfo {
  return {
    name: packageJson.name,
    version: packageJson.version,
    pxPath: runtimePath,
    packageRoot: packageDir,
    node: process.version,
  };
}

export function formatVersionInfo(info: VersionInfo = versionInfo()): string {
  return [
    `${info.name} ${info.version}`,
    `px: ${info.pxPath}`,
    `package: ${info.packageRoot}`,
    `node: ${info.node}`,
  ].join('\n');
}

export function parseReviewEventArgs(args: string[]): ReviewEventParsed {
  const slug = args[0];
  if (!slug) {
    throw new Error('Usage: review-event <slug> --type <event-type> --actor <actor> --content <text> [--disposition <disposition>] [--timestamp <stamp>] [--skip-git]');
  }

  const parsed: ReviewEventParsed = {
    slug,
    type: null,
    actor: null,
    content: '',
    disposition: null,
    timestamp: null,
    skipGit: false,
  };

  for (let i = 1;i < args.length;i += 1) {
    const arg = args[i];
    if (arg === '--skip-git') {
      parsed.skipGit = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected review-event argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = args[i + 1];
    if (!value) {
      throw new Error(`${arg} requires a value`);
    }
    i += 1;

    if (key === 'type') { parsed.type = value; }
    else if (key === 'actor') { parsed.actor = value; }
    else if (key === 'content') { parsed.content = value; }
    else if (key === 'disposition') { parsed.disposition = value; }
    else if (key === 'timestamp') { parsed.timestamp = value; }
    else { throw new Error(`Unknown review-event option: ${arg}`); }
  }

  if (!parsed.type) {
    throw new Error('review-event requires --type');
  }

  return parsed;
}

async function runBareCommand(parsed: ParsedArgs, configuration: ParallixConfiguration, log: typeof fmt.log.plain, error: typeof fmt.log.plainError): Promise<number> {
  const { main } = await import('../interfaces/cli/runtime.js');
  return commandInvocation(exitFn => main([], {
    ...createRuntimeOptions(parsed.target, configuration),
    cwdFn: () => parsed.target,
    exitFn,
    logFn: log,
    errorFn: error,
  }));
}

async function runReviewEventCommand(parsed: ParsedArgs, configuration: ParallixConfiguration, log: typeof fmt.log.plain, error: typeof fmt.log.plainError): Promise<number> {
  const eventArgs = parseReviewEventArgs(parsed.args);
  const services = await createProductionApplicationServices(parsed.target, undefined, { configuration });
  try {
    if (!services.mission) { throw new Error('mission services are unavailable'); }
    const result = await bindReviewPersistence(services.mission.store, services.mission.lifecycle).createEvent(
      eventArgs.slug,
      eventArgs.type || '',
      { actor: eventArgs.actor || '', content: eventArgs.content, disposition: eventArgs.disposition || undefined, timestamp: eventArgs.timestamp || undefined },
      { worktree: parsed.target, skipGit: eventArgs.skipGit, log, error },
    );
    if (result.ok && result.path) { log(fmt.status('PASS', `Review event path: ${path.relative(parsed.target, result.path)}`)); }
    return result.ok ? 0 : 1;
  } finally {
    await services.operatorState.close();
  }
}

function ensureWorkflowAgentConfig(command: string, target: string, configuration: ParallixConfiguration) {
  if (!['draft', 'active', 'review'].includes(command) || !hasGitRepository(target)) { return; }
  try { ensureFirstRunAgentConfig({ rootDir: target, worktree: target, configuration }); } catch { /* Best-effort first-run detection. */ }
}

async function runTargetCommand(parsed: ParsedArgs, configuration: ParallixConfiguration, log: typeof fmt.log.plain, error: typeof fmt.log.plainError, cli?: CliInvocation, operatorInvocation = true): Promise<number> {
  const previousCwd = process.cwd();
  try {
    const [startupPreflightModule, workflow] = await Promise.all([
      import('../adapters/cli/startup-preflight.js'),
      import('../interfaces/cli/runtime.js'),
    ]);
    process.chdir(parsed.target);
    const hosted = cli ? await hostMissionCommand(parsed.command, parsed.args, parsed.target, log, cli, { configuration }) : null;
    if (hosted !== null) { return hosted; }
    if (parsed.command === 'review-event') { return await runReviewEventCommand(parsed, configuration, log, error); }
    if (parsed.command === 'verify-env') {
      return startupPreflightModule.default([], { command: 'verify-env', returnResult: true, log, error })?.pass ? 0 : 1;
    }
    ensureWorkflowAgentConfig(parsed.command || '', parsed.target, configuration);
    const invoke = () => commandInvocation(exitFn => workflow.main([parsed.command, ...parsed.args], {
      ...createRuntimeOptions(parsed.target, configuration, operatorInvocation && parsed.command === 'review'),
      cwdFn: () => parsed.target,
      exitFn,
      logFn: log,
      errorFn: error,
    }));
    // A mission operation run in this process is retained as mission history too.
    return await (hasGitRepository(parsed.target) ? captureMissionCommand(parsed.command || '', parsed.args, parsed.target, configuration, invoke) : invoke());
  } catch (err) {
    error(fmt.status('FAIL', (err as Error).message));
    return 1;
  } finally {
    // Integration can remove the worktree from which this CLI was invoked.
    // Its landing workflow already selects the surviving base checkout.
    if (fs.existsSync(previousCwd)) { process.chdir(previousCwd); }
  }
}

export function run(argv = process.argv.slice(2), options: RunOptions = {}): Promise<number> {
  return withinCliInvocation(options.operatorInvocation !== false, direct => runInvocation(argv, { ...options, operatorInvocation: direct }));
}

async function runInvocation(argv: string[], options: RunOptions): Promise<number> {
  const configuration = options.environment ? resolveConfiguration(options.environment) : resolveProcessConfiguration();
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const baseCwd = options.baseCwd || process.cwd();

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv, baseCwd);
  } catch (err) {
    error(fmt.status('FAIL', (err as Error).message));
    return 1;
  }

  // shell-init prints a shell snippet and never touches a target repository, so
  // it runs before the target-path check.
  if (parsed.command === 'shell-init') {
    try {
      log(shellInit(parsed.args[0]));
      return 0;
    } catch (err) {
      error(fmt.status('FAIL', (err as Error).message));
      return 1;
    }
  }

  // Delegate bare invocation to the dispatcher. It keeps historical usage
  // output for non-TTY/CI/opt-out paths and selects the same lazy `ui` entry
  // point as explicit `px ui` for an interactive terminal.
  if (!parsed.command) {
    return await runBareCommand(parsed, configuration, log, error);
  }

  if (!fs.existsSync(parsed.target) || !fs.statSync(parsed.target).isDirectory()) {
    error(fmt.status('FAIL', `Target repository path not found: ${parsed.target}`));
    return 1;
  }

  if (parsed.command === 'version') {
    log(formatVersionInfo());
    return 0;
  }

  return await runTargetCommand(parsed, configuration, log, error, options.cliInvocation, options.operatorInvocation);
}

const _arg1 = typeof process.argv[1] === 'string' && process.argv[1] ? process.argv[1] : undefined;
// The ESM source entry imports this compatibility module.  Only the legacy
// root source file is directly executable; the canonical entry owns startup.
const _esmMain = _arg1 && _arg1.endsWith('/px.ts') && !_arg1.endsWith('/src/entry/px.ts');
if (_esmMain) {
  run(process.argv.slice(2), { cliInvocation: cliInvocation(_arg1) }).then(code => {
    if (code !== 0) { process.exit(code); }
    process.exitCode ||= code;
  }, error => {
    console.error(error);
    process.exit(1);
  });
}
