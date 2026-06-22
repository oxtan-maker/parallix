#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const fmt = require('./lib/core/fmt');
const missionStart = require('./lib/commands/mission-start');
const { createEvent } = require('./lib/review/review-events');
const workflow = require('./index');
const packageJson = require('./package.json');

function parseArgs(argv, baseCwd = process.cwd()) {
  const args = [...argv];
  if (args[0] === '--version' || args[0] === '-v') {
    return { target: path.resolve(baseCwd), command: 'version', args: [] };
  }

  const command = args.shift();
  if (!command) {
    throw new Error('Missing command');
  }

  return { target: path.resolve(baseCwd), command, args };
}

// Emits a shell function named `px` that wraps the globally installed `px`
// runner and switches the caller's terminal into the next mission worktree
// when the runtime prints a transition signal. A shell function always runs in
// the current shell, so it can `cd` the caller (an npm `bin` subprocess cannot).
// Install with:  eval "$(px shell-init bash)"   (or zsh) in your shell rc.
function shellInit(shell = 'bash') {
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
    '  _px_signal="$(grep "\\[INFO\\] Next: cd " "$_px_log" | tail -n 1 | sed "s/.*\\[INFO\\] Next: cd //")"',
    '  if [ -z "$_px_signal" ]; then',
    '    _px_signal="$(grep "\\[INFO\\] Working directory: " "$_px_log" | tail -n 1 | sed "s/.*\\[INFO\\] Working directory: //")"',
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
    '    else',
    '      echo "[px] ERROR: target directory \'$_px_target\' not found." >&2',
    '    fi',
    '  fi',
    '  return $_px_exit',
    '}',
    '',
  ].join('\n');
}

function versionInfo() {
  return {
    name: packageJson.name,
    version: packageJson.version,
    pxPath: __filename,
    packageRoot: __dirname,
    node: process.version,
  };
}

function formatVersionInfo(info = versionInfo()) {
  return [
    `${info.name} ${info.version}`,
    `px: ${info.pxPath}`,
    `package: ${info.packageRoot}`,
    `node: ${info.node}`,
  ].join('\n');
}

function parseReviewEventArgs(args) {
  const slug = args[0];
  if (!slug) {
    throw new Error('Usage: review-event <slug> --type <event-type> --actor <actor> --content <text> [--timestamp <stamp>] [--skip-git]');
  }

  const parsed = {
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

    if (key === 'type') parsed.type = value;
    else if (key === 'actor') parsed.actor = value;
    else if (key === 'content') parsed.content = value;
    else if (key === 'timestamp') parsed.timestamp = value;
    else throw new Error(`Unknown review-event option: ${arg}`);
  }

  if (!parsed.type) {
    throw new Error('review-event requires --type');
  }

  return parsed;
}

async function run(argv = process.argv.slice(2), options = {}) {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const baseCwd = options.baseCwd || process.cwd();

  let parsed;
  try {
    parsed = parseArgs(argv, baseCwd);
  } catch (err) {
    error(fmt.status('FAIL', err.message));
    return 1;
  }

  // shell-init prints a shell snippet and never touches a target repository, so
  // it runs before the target-path check.
  if (parsed.command === 'shell-init') {
    try {
      log(shellInit(parsed.args[0]));
      return 0;
    } catch (err) {
      error(fmt.status('FAIL', err.message));
      return 1;
    }
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
  process.chdir(parsed.target);

  try {
    if (parsed.command === 'review-event') {
      const eventArgs = parseReviewEventArgs(parsed.args);
      const result = createEvent(
        eventArgs.slug,
        eventArgs.type,
        {
          actor: eventArgs.actor,
          content: eventArgs.content,
          timestamp: eventArgs.timestamp,
        },
        {
          worktree: parsed.target,
          skipGit: eventArgs.skipGit,
          log,
          error,
        },
      );
      if (result.ok) {
        log(fmt.status('PASS', `Review event path: ${path.relative(parsed.target, result.path)}`));
      }
      return result.ok ? 0 : 1;
    }

    if (parsed.command === 'verify-env') {
      const result = missionStart([], { command: 'verify-env', returnResult: true, log, error });
      return result && result.pass ? 0 : 1;
    }

    let exitCode = 0;
    await workflow.main([parsed.command, ...parsed.args], {
      cwdFn: () => parsed.target,
      exitFn: code => {
        exitCode = typeof code === 'number' ? code : 0;
      },
      logFn: log,
      errorFn: error,
    });
    return exitCode;
  } catch (err) {
    error(fmt.status('FAIL', err.message));
    return 1;
  } finally {
    process.chdir(previousCwd);
  }
}

if (require.main === module) {
  run().then(code => {
    process.exitCode = code;
  });
}

module.exports = {
  formatVersionInfo,
  parseArgs,
  parseReviewEventArgs,
  run,
  shellInit,
  versionInfo,
};
