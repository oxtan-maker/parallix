#!/usr/bin/env node
"use strict";
/**
 * VisualBoard Parallix Coordination CLI
 * ADR 0037 — Wave 1
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWN_COMMANDS = void 0;
exports.deriveAliases = deriveAliases;
exports.resolveAlias = resolveAlias;
exports.printAliases = printAliases;
exports.buildSuggestionSuffix = buildSuggestionSuffix;
exports.suggestCommand = suggestCommand;
exports.levenshteinDistance = levenshteinDistance;
exports.printUsage = printUsage;
exports.main = main;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const fmt = __importStar(require("./lib/core/fmt.js"));
const product_config_js_1 = require("./lib/core/product-config.js");
const state_map_js_1 = require("./lib/core/state-map.js");
const build_freshness_js_1 = require("./lib/core/build-freshness.js");
const package_root_js_1 = require("./lib/core/package-root.js");
process.setSourceMapsEnabled(true);
// Fixed virtual-state → canonical-command invariants for alias derivation.
const STATE_COMMAND_MAP = {
    ready: 'draft',
    approved: 'integrate',
    done: 'integrate',
};
exports.KNOWN_COMMANDS = [
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
];
const READ_ONLY_COMMANDS = new Set(['config']);
function loadStateMapForAliases(options = {}) {
    return (0, state_map_js_1.loadStateMap)(options);
}
// Derives the command-alias table from state-map.json and fixed parallix invariants.
// Users only maintain state-map.json; aliases update automatically.
function deriveAliases(options = {}) {
    const stateMap = loadStateMapForAliases(options);
    const aliases = { ...STATE_COMMAND_MAP };
    for (const [virtual, actual] of Object.entries(stateMap)) {
        if (typeof actual === 'string' && actual !== virtual && STATE_COMMAND_MAP[virtual]) {
            aliases[actual] = STATE_COMMAND_MAP[virtual];
        }
    }
    return aliases;
}
function resolveAlias(command, aliases = deriveAliases()) {
    return Object.prototype.hasOwnProperty.call(aliases, command) ? aliases[command] : null;
}
function printAliases(aliases, logFn = fmt.log.plain) {
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
async function main(args = process.argv.slice(2), options = {}) {
    const { existsSyncFn = node_fs_1.default.existsSync, cwdFn = () => process.cwd(), ensureStandaloneGitRepoFn = product_config_js_1.ensureStandaloneGitRepo, requireFn = require, printUsageFn = printUsage, exitFn = process.exit, errorFn = fmt.log.plainError, logFn = fmt.log.plain, loadAliasesFn = deriveAliases, } = options;
    const command = args[0];
    if (command === '--version' || command === '-v') {
        const pkg = requireFn(node_path_1.default.join((0, package_root_js_1.packageRoot)(__dirname), 'package.json'));
        logFn(pkg.name + '@' + pkg.version);
        exitFn(0);
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
    const libPath = node_path_1.default.join(__dirname, 'lib', 'commands', `${command}.js`);
    // Special case: verify-env is an alias for mission-start diagnostic.
    // active is now its own command (real agent-start path).
    let targetLib = libPath;
    if (command === 'verify-env') {
        targetLib = node_path_1.default.join(__dirname, 'lib', 'commands', 'mission-start.js');
    }
    if (existsSyncFn(targetLib)) {
        (0, build_freshness_js_1.assertBuildFreshness)(__dirname, exitFn, errorFn);
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
        const cmdModule = requireFn(targetLib);
        if (typeof cmdModule === 'function') {
            await cmdModule(args.slice(1), { command });
        }
        else {
            errorFn(fmt.status('FAIL', `Command module '${command}' does not export a function.`));
            exitFn(1);
        }
    }
    else {
        const aliases = loadAliasesFn({ rootDir: cwdFn() });
        const canonical = resolveAlias(command, aliases);
        if (canonical) {
            logFn(fmt.status('INFO', `Resolving alias ${command} → ${canonical}`));
            await main([canonical, ...args.slice(1)], { existsSyncFn, cwdFn, ensureStandaloneGitRepoFn, requireFn, printUsageFn, exitFn, errorFn, logFn, loadAliasesFn });
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
function buildSuggestionSuffix(command) {
    if (command === 'diff' || command === 'resolve-conflict') {
        return ' <slug>';
    }
    if (command === 'checkpoint') {
        return ' <slug> <cp-name> "<next-action>"';
    }
    return '';
}
function suggestCommand(input) {
    if (!input) {
        return null;
    }
    const normalizedInput = input.toLowerCase();
    let best = null;
    for (const candidate of exports.KNOWN_COMMANDS) {
        const distance = levenshteinDistance(normalizedInput, candidate);
        if (distance > 2) {
            continue;
        }
        if (!best || distance < best.distance) {
            best = { candidate, distance };
        }
    }
    return best ? best.candidate : null;
}
function levenshteinDistance(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = 0; i < rows; i += 1) {
        dp[i][0] = i;
    }
    for (let j = 0; j < cols; j += 1) {
        dp[0][j] = j;
    }
    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[a.length][b.length];
}
function printUsage() {
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
  handoff [<slug>] [--no-gate] [--force]  Sync, push, and transition mission to review.
  integrate [<slug>] [--dry-run] [--no-integration-gates] [--real-agent codex --real-agent-model gpt-5.6-luna]  Land a reviewed mission into the local integration checkout on main. --no-integration-gates skips integration-time staging/e2e gates; the paired real-agent flags override the Codex integration-gate runner.
  resolve-conflict [<slug>]       Detect merge conflicts in the mission worktree and emit resolution guidance.
  rebase [<slug>] [--push]          Rebase mission branch onto the primary integration branch (main) with auto-resolution of mission-specific conflicts.
  diff [<slug>]                Launch the primary local diff tool for branch-vs-main review.
  stats [<csv_file>|--csv-file <path>] [--today YYYY-MM-DD|--from YYYY-MM-DD --to YYYY-MM-DD] [--output <file>]  Print parallix weekly or range tables from <PARALLIX_HOME>/stats.csv; legacy retrospective CSVs remain supported.
  config                Print the effective configuration (built-in defaults merged with workflow.config.json). Read-only.
  aliases               Print the derived command-alias table (state-map virtual states → canonical commands).

${fmt.bold('Utility Commands:')}
  version, --version, -v  Print the package version, px path, package root, and Node version.
  shell-init [bash|zsh]   Print the shell integration snippet that cds your terminal into the next mission worktree on transitions.
  review-event <slug> --type <type> --actor <actor> --content <text> [--timestamp <stamp>] [--skip-git]  Append a review-thread event for a mission.

${fmt.bold('Notes:')}
  - <slug> is optional if it can be inferred from the current branch, directory name, or git worktree.
  - When provided, <slug> MUST be the lowercase Backlog task key (e.g., task-073).
  - Mistyped parallix subcommands print the closest supported \`px ...\` suggestion when the match is unambiguous.
  - Run \`px stats --help\` for pre-integration stats preview examples.
  - No npm dependencies — requires Node.js built-ins only.
`);
}
// Run main when executed directly (compiled to CJS, require.main === module applies)
if (typeof require !== 'undefined' && require.main === module) {
    main();
}
