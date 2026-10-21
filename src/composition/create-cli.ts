#!/usr/bin/env node
import { missionCommandTarget } from './mission-command-context.js';
import { bindGateAdmission } from './gate-admission.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../../package.json' with { type: 'json' };
import { resolveConfiguration, resolveProcessConfiguration } from './config.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import * as fmt from '../application/presentation/cli-format.js';
import { withinCliInvocation } from './review-operator-resume.js';
import { commandInvocation } from './command-invocation.js';
import { cliInvocation, type CliInvocation } from '../adapters/process/cli-invocation.js';
import { packageRoot } from '../adapters/filesystem/package-root.js';
import { hasGitRepository, ensureStandaloneGitRepo } from '../adapters/config/product-config.js';
import { loadStateMap } from '../adapters/config/state-map.js';
import { deriveAliases, shouldLaunchDefaultUi, type MainOptions } from '../interfaces/cli/runtime.js';
import { missionTerminalRequest } from '../interfaces/cli/mission-terminal-policy.js';

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
  /** Internal forwarded invocations carry no direct operator authority. */
  operatorInvocation?: boolean;
  cliInvocation?: CliInvocation;
  log?: typeof fmt.log.plain;
  error?: typeof fmt.log.plainError;
  baseCwd?: string;
  /** Host environment to resolve configuration from; defaults to the process environment. */
  environment?: NodeJS.ProcessEnv;
}

async function runtimeOptions(rootDir: string, configuration: ParallixConfiguration, operatorInvocation = false, command = ''): Promise<Pick<MainOptions, 'commandFns' | 'ensureStandaloneGitRepoFn' | 'loadAliasesFn' | 'product' | 'runtime'>> {
  bindGateAdmission(configuration);
  const base = {
    runtime: configuration.runtime,
    ensureStandaloneGitRepoFn: ensureStandaloneGitRepo,
    loadAliasesFn: (options: { readonly rootDir?: string }) => deriveAliases(loadStateMap(options)),
    product: { name: packageJson.name, version: packageJson.version },
  };
  if (command === 'verdict' || command === 'resolve') {
    const { createReviewVerbCommands } = await import('./cli-review-verbs.js');
    return { ...base, commandFns: createReviewVerbCommands(rootDir, configuration) };
  }
  // Brief writes need the Mission authority without loading execute or presentation composition.
  if (command === 'classification' || command === 'goal' || command === 'checkpoint') {
    const { createBriefWriteCommands } = await import('./cli-brief-writes.js');
    return { ...base, commandFns: createBriefWriteCommands(rootDir, configuration, operatorInvocation) };
  }
  if (command === 'config') {
    const [{ default: config }, { createConfigCommand }] = await Promise.all([
      import('../adapters/cli/commands/config.js'), import('../interfaces/cli/config.js'),
    ]);
    const invoke = createConfigCommand((request, options) => config([...request.args], options));
    return { ...base, commandFns: { config: (args: string[], options: Record<string, unknown> = {}) => invoke(args, { ...options, configuration }) } };
  }
  if (!command && !shouldLaunchDefaultUi({ runtime: configuration.runtime })) { return { ...base, commandFns: {} }; }
  const { createRuntimeOptions } = await import('./cli-command-registry.js');
  return createRuntimeOptions(rootDir, configuration, operatorInvocation && command === 'review');
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

  for (let i = 1; i < args.length; i += 1) {
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

    if (key === 'type') {parsed.type = value;}
    else if (key === 'actor') {parsed.actor = value;}
    else if (key === 'content') {parsed.content = value;}
    else if (key === 'disposition') {parsed.disposition = value;}
    else if (key === 'timestamp') {parsed.timestamp = value;}
    else {throw new Error(`Unknown review-event option: ${arg}`);}
  }

  if (!parsed.type) {
    throw new Error('review-event requires --type');
  }

  return parsed;
}

async function runBareCommand(parsed: ParsedArgs, configuration: ParallixConfiguration, log: typeof fmt.log.plain, error: typeof fmt.log.plainError): Promise<number> {
  const { main } = await import('../interfaces/cli/runtime.js');
  const options = await runtimeOptions(parsed.target, configuration, false, parsed.command);
  return commandInvocation(exitFn => main([], {
    ...options,
    cwdFn: () => parsed.target,
    exitFn,
    logFn: log,
    errorFn: error,
  }));
}

async function runReviewEventCommand(parsed: ParsedArgs, configuration: ParallixConfiguration, log: typeof fmt.log.plain, error: typeof fmt.log.plainError): Promise<number> {
  const eventArgs = parseReviewEventArgs(parsed.args);
  const [{ createMissionApplicationServices }, { bindReviewPersistence }] = await Promise.all([import('./mission-services.js'), import('./review-persistence.js')]);
  const mission = await createMissionApplicationServices(parsed.target, { configuration });
  try {
    const result = await bindReviewPersistence(mission.store, mission.lifecycle).createEvent(
      eventArgs.slug,
      eventArgs.type || '',
      { actor: eventArgs.actor || '', content: eventArgs.content, disposition: eventArgs.disposition || undefined, timestamp: eventArgs.timestamp || undefined },
      { worktree: parsed.target, skipGit: eventArgs.skipGit, log, error },
    );
    if (result.ok && result.path) { log(fmt.status('PASS', `Review event path: ${path.relative(parsed.target, result.path)}`)); }
    return result.ok ? 0 : 1;
  } finally {
    await mission.store.drain?.();
  }
}

async function ensureWorkflowAgentConfig(command: string, target: string, configuration: ParallixConfiguration) {
  if (!['draft', 'active', 'review'].includes(command) || !hasGitRepository(target)) { return; }
  const { ensureFirstRunAgentConfig } = await import('../adapters/agents/first-run-config.js');
  try { ensureFirstRunAgentConfig({ rootDir: target, worktree: target, configuration }); } catch { /* Best-effort first-run detection. */ }
}

async function hostTargetCommand(parsed: ParsedArgs, configuration: ParallixConfiguration, log: typeof fmt.log.plain, cli?: CliInvocation) {
  const terminal = missionTerminalRequest(parsed.command, parsed.args) ? await import('./mission-terminal.js') : null;
  const hosted = cli && terminal ? await terminal.hostMissionCommand(parsed.command, parsed.args, parsed.target, log, cli, { configuration }) : null;
  return { terminal, hosted };
}

async function runTargetCommand(parsed: ParsedArgs, configuration: ParallixConfiguration, log: typeof fmt.log.plain, error: typeof fmt.log.plainError, cli?: CliInvocation, operatorInvocation = true): Promise<number> {
  const previousCwd = process.cwd();
  try {
    const workflow = await import('../interfaces/cli/runtime.js');
    process.chdir(parsed.target);
    parsed = { ...parsed, target: missionCommandTarget(parsed.command, parsed.args, parsed.target, configuration) };
    process.chdir(parsed.target);
    const { terminal, hosted } = await hostTargetCommand(parsed, configuration, log, cli);
    if (hosted !== null) { return hosted; }
    if (parsed.command === 'review-event') { return await runReviewEventCommand(parsed, configuration, log, error); }
    if (parsed.command === 'verify-env') {
      const startupPreflightModule = await import('../adapters/cli/startup-preflight.js');
      return startupPreflightModule.default([], { command: 'verify-env', returnResult: true, log, error })?.pass ? 0 : 1;
    }
    await ensureWorkflowAgentConfig(parsed.command || '', parsed.target, configuration);
    const options = await runtimeOptions(parsed.target, configuration, operatorInvocation, parsed.command);
    const invoke = () => commandInvocation(exitFn => workflow.main([parsed.command, ...parsed.args], {
      ...options,
      cwdFn: () => parsed.target,
      exitFn,
      logFn: log,
      errorFn: error,
    }));
    // A mission operation run in this process is retained as mission history too.
    return await (terminal && hasGitRepository(parsed.target) ? terminal.captureMissionCommand(parsed.command || '', parsed.args, parsed.target, configuration, invoke) : invoke());
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
