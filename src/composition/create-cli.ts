#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fmt from '../application/presentation/cli-format.js';
import { packageRoot } from '../adapters/filesystem/package-root.js';
import packageJson from '../../package.json' with { type: 'json' };
import { ensureStandaloneGitRepo } from '../adapters/config/product-config.js';
import { loadStateMap } from '../adapters/config/state-map.js';
import active from '../adapters/cli/commands/active.js';
import checkpoint from '../adapters/cli/commands/checkpoint.js';
import config from '../adapters/cli/commands/config.js';
import diff from '../adapters/cli/commands/diff.js';
import { createDraftWorkflowAdapter } from '../adapters/cli/commands/draft.js';
import handoff from '../adapters/cli/commands/handoff.js';
import integrate from '../adapters/cli/commands/integrate.js';
import { DraftCommandUseCase } from '../application/draft-command-use-case.js';
import { IntegrateCommandUseCase } from '../application/integrate-command-use-case.js';
import { StatsCommandUseCase } from '../application/stats-command-use-case.js';
import { createDraftCommand } from '../interfaces/cli/draft.js';
import { createIntegrateCommand } from '../interfaces/cli/integrate.js';
import missionStart from '../adapters/cli/mission-start.js';
import mutationGate from '../adapters/verification/mutation-gate.js';
import rebase from '../adapters/cli/commands/rebase.js';
import { createRebaseCommand } from '../interfaces/cli/rebase.js';
import resolveConflict from '../adapters/cli/commands/resolve-conflict.js';
import review from '../adapters/cli/commands/review.js';
import setup from '../adapters/cli/commands/setup.js';
import setupReview from '../adapters/cli/commands/setup-review.js';
import { createStatsCommand, createStatsWorkflowAdapter } from '../adapters/cli/commands/stats.js';
import status from '../adapters/cli/commands/status.js';
import verify from '../adapters/cli/commands/verify.js';
import { deriveAliases, type Command, type MainOptions } from '../interfaces/cli/runtime.js';
import { createProductionApplicationServices } from './application-services.js';
import { bindReviewPersistence, reviewLoopBindings } from './review-persistence.js';
import { startReviewLoop } from '../adapters/review/review-loop.js';

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
  timestamp: string | null;
  skipGit: boolean;
}

interface RunOptions {
  log?: typeof fmt.log.plain;
  error?: typeof fmt.log.plainError;
  baseCwd?: string;
}

function createCommandRegistry(rootDir: string): Record<string, Command> {
  const withGraph = async (invoke: (_services: Awaited<ReturnType<typeof createProductionApplicationServices>>) => unknown) => {
    const services = await createProductionApplicationServices(rootDir);
    try { return await invoke(services); } finally { await services.operatorState.close(); }
  };
  const withMissionFactories = async (invoke: (_missionServicesFn: Function) => unknown) => {
    const opened: Awaited<ReturnType<typeof createProductionApplicationServices>>[] = [];
    const missionServicesFn = async (requestedRoot: string) => {
      const services = await createProductionApplicationServices(requestedRoot);
      opened.push(services);
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      return services.mission;
    };
    try { return await invoke(missionServicesFn); } finally {
      await Promise.all(opened.map(services => services.operatorState.close()));
    }
  };
  // `active` needs to create its ExecuteMissionService only after it has
  // installed its progress renderer. Supplying a pre-built service loses the
  // lifecycle progress events (including the actual execute-agent family).
  const withActiveService = async (args: string[], options: Record<string, unknown> = {}) => {
    const activeServices: { value: Awaited<ReturnType<typeof createProductionApplicationServices>> | null } = { value: null };
    try {
      return await active(args, {
        ...options,
        serviceFactory: async (requestedRoot: string, progress: Parameters<typeof createProductionApplicationServices>[1]) => {
          activeServices.value = await createProductionApplicationServices(requestedRoot, progress);
          return activeServices.value.executeMission;
        },
      });
    } finally {
      await activeServices.value?.operatorState.close();
    }
  };
  return {
    active: withActiveService,
    checkpoint,
    config,
    diff,
    draft: (args, options) => {
      // Create adapter with missionServicesFn injected via withMissionFactories
      return withMissionFactories(missionServicesFn => {
        const adapter = createDraftWorkflowAdapter({ missionServicesFn });
        const useCase = new DraftCommandUseCase(adapter);
        const cmd = createDraftCommand(useCase);
        return cmd(args, { ...options, missionServicesFn });
      });
    },
    handoff: (args, options) => withMissionFactories(missionServicesFn => handoff(args, { ...options, missionServicesFn })),
    integrate: createIntegrateCommand(new IntegrateCommandUseCase({
      execute: (args, options) => withMissionFactories(missionServicesFn => integrate(args, { ...options, missionServicesFn })),
    })),
    'mission-start': missionStart,
    'verify-env': missionStart,
    'mutation-gate': mutationGate,
    rebase: createRebaseCommand((args, options) => withMissionFactories(missionServicesFn => rebase(args, { ...options, missionServicesFn }))),
    'resolve-conflict': resolveConflict,
    review: (args, options) => withMissionFactories(missionServicesFn =>
      withGraph(async services => {
        if (!services.mission) { throw new Error('mission services are unavailable'); }
        const persistence = bindReviewPersistence(services.mission.store);
        return review(args, {
          ...options,
          missionServicesFn,
          requireReviewAggregate: true,
          readReviewStateFn: persistence.readReviewState,
          writeReviewStateFn: persistence.writeReviewState,
          resetReviewStateFn: persistence.resetReviewState,
          createEventFn: persistence.createEvent,
          readAllEventsFn: persistence.readAllEvents,
          backfillReviewFn: persistence.backfillReview,
          reconcileInterruptedHandoffFn: persistence.reconcileInterruptedHandoff,
          consumeReviewerArtifactsFn: persistence.consumeReviewerArtifacts,
          consumeImplementerArtifactsFn: persistence.consumeImplementerArtifacts,
          startReviewLoopFn: (slug: string, loopOptions: Record<string, unknown>) => startReviewLoop(slug, {
            ...loopOptions,
            ...reviewLoopBindings(services.mission!.store),
          } as any),
        } as any);
      })
    ),
    setup,
    'setup-review': setupReview,
    stats: createStatsCommand(new StatsCommandUseCase(createStatsWorkflowAdapter())),
    status: (args, options) => withGraph(services => status(args, {
      ...options,
      buildProjectionFn: async () => {
        const builder = services.presentationCapabilities?.boardProjection;
        if (!builder) { throw new Error('board projection is unavailable'); }
        return builder;
      },
    })),
    verify,
    ui: async (...args: any[]) => {
      const { runUiCommand } = await import('../interfaces/tui/ui-command.js');
      const services = await createProductionApplicationServices(rootDir);
      const capabilities = services.presentationCapabilities?.tui;
      if (!capabilities) { throw new Error('operator-state capabilities are unavailable'); }
      return runUiCommand(capabilities, ...args);
    },
  };
}

function createRuntimeOptions(rootDir: string): Pick<MainOptions, 'commandFns' | 'ensureStandaloneGitRepoFn' | 'loadAliasesFn' | 'product'> {
  return {
    commandFns: createCommandRegistry(rootDir),
    ensureStandaloneGitRepoFn: ensureStandaloneGitRepo,
    loadAliasesFn: options => deriveAliases(loadStateMap(options as any)),
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
    throw new Error('Usage: review-event <slug> --type <event-type> --actor <actor> --content <text> [--timestamp <stamp>] [--skip-git]');
  }

  const parsed: ReviewEventParsed = {
    slug,
    type: null,
    actor: null,
    content: '',
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
    else if (key === 'timestamp') {parsed.timestamp = value;}
    else {throw new Error(`Unknown review-event option: ${arg}`);}
  }

  if (!parsed.type) {
    throw new Error('review-event requires --type');
  }

  return parsed;
}

export async function run(argv = process.argv.slice(2), options: RunOptions = {}): Promise<number> {
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
    const { main } = await import('../interfaces/cli/runtime.js');
    let exitCode = 0;
    await main([], {
      ...createRuntimeOptions(parsed.target),
      cwdFn: () => parsed.target,
      exitFn: ((code?: number) => { exitCode = typeof code === 'number' ? code : 0; }) as (_code?: number) => never,
      logFn: log,
      errorFn: error,
    });
    return exitCode;
  }

  if (!fs.existsSync(parsed.target) || !fs.statSync(parsed.target).isDirectory()) {
    error(fmt.status('FAIL', `Target repository path not found: ${parsed.target}`));
    return 1;
  }

  if (parsed.command === 'version') {
    log(formatVersionInfo());
    return 0;
  }

  const previousCwd = process.cwd();
  try {
    const [missionStartModule, workflow] = await Promise.all([
      import('../adapters/cli/mission-start.js'),
      import('../interfaces/cli/runtime.js'),
    ]);
    const missionStart = missionStartModule.default;
    process.chdir(parsed.target);

    if (parsed.command === 'review-event') {
      const eventArgs = parseReviewEventArgs(parsed.args);
      const services = await createProductionApplicationServices(parsed.target);
      try {
        if (!services.mission) { throw new Error('mission services are unavailable'); }
        const result = await bindReviewPersistence(services.mission.store).createEvent(
          eventArgs.slug,
          eventArgs.type || '',
          {
            actor: eventArgs.actor || '',
            content: eventArgs.content,
            timestamp: eventArgs.timestamp || undefined,
          },
          {
            worktree: parsed.target,
            skipGit: eventArgs.skipGit,
            log,
            error,
          },
        );
        if (result.ok && result.path) {
          log(fmt.status('PASS', `Review event path: ${path.relative(parsed.target, result.path)}`));
        }
        return result.ok ? 0 : 1;
      } finally {
        await services.operatorState.close();
      }
    }

    if (parsed.command === 'verify-env') {
      const result = missionStart([], { command: 'verify-env', returnResult: true, log, error });
      return result && (result as { pass?: boolean }).pass ? 0 : 1;
    }

    let exitCode = 0;
    await workflow.main([parsed.command, ...parsed.args], {
      ...createRuntimeOptions(parsed.target),
      cwdFn: () => parsed.target,
      exitFn: ((code?: number) => { exitCode = typeof code === 'number' ? code : 0; }) as (_code?: number) => never,
      logFn: log,
      errorFn: error,
    });
    return exitCode;
  } catch (err) {
    error(fmt.status('FAIL', (err as Error).message));
    return 1;
  } finally {
    process.chdir(previousCwd);
  }
}

const _arg1 = typeof process.argv[1] === 'string' && process.argv[1] ? process.argv[1] : undefined;
// The ESM source entry imports this compatibility module.  Only the legacy
// root source file is directly executable; the canonical entry owns startup.
const _esmMain = _arg1 && _arg1.endsWith('/px.ts') && !_arg1.endsWith('/src/entry/px.ts');
if (_esmMain) {
  run().then(code => { process.exitCode = code; });
}
