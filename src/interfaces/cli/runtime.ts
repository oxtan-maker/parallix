#!/usr/bin/env node

/**
 * VisualBoard Parallix Coordination CLI
 * Canonical inbound CLI dispatcher.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { levenshteinDistance } from '../../application/presentation/cli-flags.js';

process.setSourceMapsEnabled(true);

// Fixed virtual-state → canonical-command invariants for alias derivation.
const STATE_COMMAND_MAP: Record<string, string> = {
  ready: 'draft',
  approved: 'integrate',
  done: 'integrate',
};

export const KNOWN_COMMANDS: string[] = [
  'mission-start',
  'verify-env',
  'verify',
  'setup',
  'setup-review',
  'draft',
  'active',
  'status',
  'checkpoint',
  'review',
  'handoff',
  'integrate',
  'resolve-conflict',
  'rebase',
  'stats',
  'aliases',
  'config',
  'diff',
  'ui',
  'web',
];

const READ_ONLY_COMMANDS = new Set(['config', 'ui', 'web']);

export type Command = (..._args: any[]) => unknown;

// Derives the command-alias table from state-map.json and fixed parallix invariants.
// Users only maintain state-map.json; aliases update automatically.
export function deriveAliases(options: unknown = {}): Record<string, string> {
  const stateMap = options && typeof options === 'object'
    ? options as Record<string, unknown>
    : {};
  const aliases = { ...STATE_COMMAND_MAP };
  for (const [virtual, actual] of Object.entries(stateMap)) {
    if (typeof actual === 'string' && actual !== virtual && STATE_COMMAND_MAP[virtual]) {
      aliases[actual] = STATE_COMMAND_MAP[virtual];
    }
  }
  return aliases;
}

export function resolveAlias(command: string, aliases: Record<string, string> = deriveAliases()): string | null {
  return Object.prototype.hasOwnProperty.call(aliases, command) ? aliases[command] : null;
}

export function printAliases(aliases: Record<string, string>, logFn = fmt.log.plain): void {
  const entries = Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    logFn('No aliases configured.');
    return;
  }
  logFn(fmt.bold('alias                         canonical'));
  logFn(fmt.bold('---                           ---'));
  for (const [alias, canonical] of entries) {
    logFn(`${alias.padEnd(30)}${canonical}`);
  }
}

export interface MainOptions {
  existsSyncFn?: (_path: string) => boolean;
  cwdFn?: () => string;
  ensureStandaloneGitRepoFn?: (_rootDir: string) => { failed?: boolean; initialized?: boolean; message?: string; branch?: string };
  commandFns?: Partial<Record<string, Command>>;
  printUsageFn?: typeof printUsage;
  exitFn?: (_code?: number) => never;
  errorFn?: typeof fmt.log.plainError;
  logFn?: typeof fmt.log.plain;
  loadAliasesFn?: typeof deriveAliases;
  isInteractiveTTYFn?: () => boolean;
  environment?: NodeJS.ProcessEnv;
  product?: { name: string; version: string };
}

/**
 * Returns whether bare `px` should open the interactive board. Both terminal
 * streams are required so pipes and redirected output retain their historical
 * usage output; CI and PARALLIX_NO_TUI=1 deliberately preserve that fallback.
 */
export function shouldLaunchDefaultUi({
  isInteractiveTTY,
  stdinIsTTY = Boolean(process.stdin.isTTY),
  stdoutIsTTY = Boolean(process.stdout.isTTY),
  environment = process.env,
}: {
  isInteractiveTTY?: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  environment?: NodeJS.ProcessEnv;
} = {}): boolean {
  const terminalIsInteractive = isInteractiveTTY ?? (stdinIsTTY && stdoutIsTTY);
  return terminalIsInteractive && !environment.CI && environment.PARALLIX_NO_TUI !== '1';
}

async function main(args = process.argv.slice(2), options: MainOptions = {}) {
  const {
    cwdFn = () => process.cwd(),
    ensureStandaloneGitRepoFn = (): { failed?: boolean; initialized?: boolean; message?: string; branch?: string } => ({}),
    printUsageFn = printUsage,
    exitFn = process.exit,
    errorFn = fmt.log.plainError,
    logFn = fmt.log.plain,
    loadAliasesFn = deriveAliases,
    isInteractiveTTYFn = () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
    environment = process.env,
    product = { name: 'parallix', version: 'development' },
  } = options;

  const command = args[0];

  if (command === '--version' || command === '-v') {
    logFn(product.name + '@' + product.version);
    exitFn(0);
    return;
  }

  if (!command && shouldLaunchDefaultUi({ isInteractiveTTY: isInteractiveTTYFn(), environment })) {
    const injectedUiCommand = options.commandFns && Object.prototype.hasOwnProperty.call(options.commandFns, 'ui')
      ? options.commandFns.ui
      : undefined;
    if (typeof injectedUiCommand !== 'function') {
      throw new Error('CLI command registry is not configured');
    }
    await injectedUiCommand([], { command: 'ui' });
    return;
  }

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsageFn();
    exitFn(0);
    return;
  }

  if (command === 'aliases') {
    printAliases(loadAliasesFn({ rootDir: cwdFn() }), logFn);
    return;
  }

  // A static registry is deliberate: the canonical ESM bundle must not look
  // up first-party command modules from the filesystem at runtime. Tests can
  // provide an explicit command map without changing that production path.
  const commandFn = options.commandFns && Object.prototype.hasOwnProperty.call(options.commandFns, command)
    ? options.commandFns[command]
    : undefined;

  if (commandFn) {
    if (!READ_ONLY_COMMANDS.has(command)) {
      const initResult = ensureStandaloneGitRepoFn(cwdFn());
      if (initResult && initResult.failed) {
        errorFn(fmt.status('FAIL', `Git init: ${initResult.message}`));
        exitFn(1);
        return;
      }
      if (initResult && initResult.initialized) {
        logFn(fmt.status('INFO', `Initialized git repository for standalone parallix in ${cwdFn()} (branch ${initResult.branch || 'main'}).`));
      }
    }

    if (typeof commandFn === 'function') {
      await commandFn(args.slice(1), { command });
    } else {
      errorFn(fmt.status('FAIL', `Command module '${command}' does not export a function.`));
      exitFn(1);
    }
  } else {
    const aliases = loadAliasesFn({ rootDir: cwdFn() });
    const canonical = resolveAlias(command, aliases);
    if (canonical) {
      logFn(fmt.status('INFO', `Resolving alias ${command} → ${canonical}`));
      await main([canonical, ...args.slice(1)], { cwdFn, ensureStandaloneGitRepoFn, commandFns: options.commandFns, printUsageFn, exitFn, errorFn, logFn, loadAliasesFn, product });
      return;
    }

    errorFn(fmt.status('FAIL', `Unknown command: ${command}`));
    const suggestion = suggestCommand(command);
    if (suggestion) {
      errorFn(fmt.status('INFO', `Did you mean: px ${suggestion}${buildSuggestionSuffix(suggestion)}`));
    }
    printUsageFn();
    exitFn(1);
  }
}

export function buildSuggestionSuffix(command: string): string {
  if (command === 'diff' || command === 'resolve-conflict') {
    return ' <slug>';
  }
  if (command === 'checkpoint') {
    return ' <slug> <cp-name> "<next-action>"';
  }
  return '';
}

export function suggestCommand(input: string): string | null {
  if (!input) {return null;}
  const normalizedInput = input.toLowerCase();
  let best: { candidate: string; distance: number } | null = null;

  for (const candidate of KNOWN_COMMANDS) {
    const distance = levenshteinDistance(normalizedInput, candidate);
    if (distance > 2) {continue;}
    if (!best || distance < best.distance) {
      best = { candidate, distance };
    }
  }

  return best ? best.candidate : null;
}

export { levenshteinDistance };

export function printUsage(): void {
  fmt.log.plain(`
Usage: px <command> [args]

${fmt.bold('Core Commands:')}
  mission-start [<slug>] Implementer's startup preflight.
  verify-env            Diagnostic preflight: prints a USABLE / NOT USABLE verdict with remediation.
  verify [<area>]       Run the configured repository verification gate.
  setup                 Interactive setup wizard: writes config, bootstraps Forgejo, and verifies the install.
  setup-review          Legacy Forgejo-only bootstrap for tokens, repo creation, and git review remote.
  draft [<slug>] [--agent <family>]  Mission setup automation; use --agent to select the draft implementer family.
  active [<slug>] [--implementer <family>]  Run preflight and launch the execute agent; use --implementer to select its family.
  status [<slug>]       Unified mission and repository overview.
  checkpoint [<slug>] <cp> "<next>"  Verify, commit, and push checkpoint.
  review [<slug>] [--verify|--submit|--push [--force]|--comment "<msg>"|--comment-file <path>|--submit-review <outcome> [--message "<msg>"|--message-file <path>]|--start|--continue] [--implementer <a>] [--reviewer <a>] [--focus <f>] [--max-attempts <n>] [--dry-run] [--reset] [--no-gate]
  handoff [<slug>] [--no-gate] [--no-recover] [--force]  Sync, push, and transition mission to review.
  integrate [<slug>] [--dry-run] [--no-integration-gates] [--real-agent codex --real-agent-model gpt-5.6-luna]  Land a reviewed mission into the local integration checkout on main. --no-integration-gates skips integration-time staging/e2e gates; the paired real-agent flags override the Codex integration-gate runner.
  resolve-conflict [<slug>]       Detect merge conflicts in the mission worktree and emit resolution guidance.
  rebase [<slug>] [--push]          Rebase mission branch onto the primary integration branch (main) with auto-resolution of mission-specific conflicts.
  diff [<slug>]                Launch the primary local diff tool for branch-vs-main review.
  stats [<csv_file>|--csv-file <path>] [--today YYYY-MM-DD|--from YYYY-MM-DD --to YYYY-MM-DD] [--output <file>]  Print parallix weekly or range tables from the measurement database (<PARALLIX_HOME>/parallix.db); a named CSV is read-only legacy analysis.
  config                Print the effective configuration (built-in defaults merged with workflow.config.json). Read-only.
  ui                    Render the static Ink TUI board shell. Read-only; press q or Ctrl+C to exit.
  web [--host 127.0.0.1|::1] [--port <n>]  Serve the loopback-only local board shell. Read-only.
  aliases               Print the derived command-alias table (state-map virtual states → canonical commands).

${fmt.bold('Utility Commands:')}
  version, --version, -v  Print the package version, px path, package root, and Node version.
  shell-init [bash|zsh]   Print the shell integration snippet that cds your terminal into the next mission worktree on transitions.
  review-event <slug> --type <type> --actor <actor> --content <text> [--timestamp <stamp>] [--skip-git]  Append a review-thread event for a mission.

${fmt.bold('Notes:')}
  - <slug> is optional if it can be inferred from the current branch, directory name, or git worktree.
  - When provided, <slug> MUST be the lowercase Backlog task key (e.g., architecture migration).
  - Mistyped parallix subcommands print the closest supported \`px ...\` suggestion when the match is unambiguous.
  - Run \`px stats --help\` for pre-integration stats preview examples.
  - In an interactive terminal, running \`px\` with no command opens the board; \`px ui\` remains available explicitly.
  - Set \`PARALLIX_NO_TUI=1\` to keep the previous no-command usage help behavior in an interactive terminal.
  - No npm dependencies — requires Node.js built-ins only.
`);
}

export { main };
