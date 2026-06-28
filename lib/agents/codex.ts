import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnAndTee } from '../core/spawn-tee.js';
import { extractCodexTelemetry } from './codex-telemetry.js';
// tools/sessions is still CJS (not converted in this wave); require keeps it
// untyped (any) without pulling a non-included .js into the typecheck program.
const sessions = require('../tools/sessions');

interface CodexInvocationOptions {
  prompt: string;
  worktree: string;
  interactive?: boolean;
  env?: {[key: string]: string};
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
}

interface StartCodexAgentOptions extends CodexInvocationOptions {
  teeOptions?: object;
  slug?: string | null;
  role?: string | null;
}

// Injectable I/O for tests. Production uses the real spawn-tee / export capture.
let _spawnAndTee: any = spawnAndTee;
let _sessions: any = sessions;

// Test hooks: override the launcher's I/O without touching the public signature.
function __setSpawnAndTeeForTest(fn: any) { _spawnAndTee = fn || spawnAndTee; }
function __setSessionsForTest(mod: any) { _sessions = mod || sessions; }

// Codex outputs "To continue this session, run codex resume <id>" at the end.
// Also captures the session ID from the "Interaction Summary" block.
const CODEX_SESSION_ID_RE = /codex\s+resume\s+([0-9a-f-]+)/i;
const CODEX_SESSION_ID_ALT_RE = /Session ID:\s*([0-9a-f-]+)/i;

function extractCodexSessionId(stdout: string) {
  if (!stdout) {return null;}
  const m = CODEX_SESSION_ID_RE.exec(stdout);
  if (m) {return m[1];}
  const m2 = CODEX_SESSION_ID_ALT_RE.exec(stdout);
  if (m2) {return m2[1];}
  return null;
}

function resolveCodexCommand() {
  return 'codex';
}

function hasLiveTty() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function buildCodexDraftInvocation({ prompt, worktree, interactive = hasLiveTty(), env = {}, resume = false, sessionId = null, model = null }: CodexInvocationOptions) {
  if (resume) {
    const args = ['exec', 'resume'];
    if (sessionId) {
      args.push(sessionId);
    } else {
      args.push('--last');
    }
    if (model) {args.push('-m', model);}
    args.push(prompt);
    return {
      command: resolveCodexCommand(),
      args,
      options: {
        stdio: 'inherit',
        cwd: worktree,
        env: { ...process.env, ...env, HOME: codexHomeRoot(worktree) }
      }
    };
  }

  const modelArgs = model ? ['-m', model] : [];
  const args = interactive
    ? ['--full-auto', ...modelArgs, '--cd', worktree, prompt]
    : ['exec', '--sandbox', 'danger-full-access', ...modelArgs, '--cd', worktree, prompt];

  const baseEnv = { ...process.env };
  if (!interactive) {
    baseEnv.HOME = codexHomeRoot(worktree);
  }

  return {
    command: resolveCodexCommand(),
    args,
    options: {
      stdio: 'inherit',
      cwd: worktree,
      env: { ...baseEnv, ...env }
    }
  };
}

function startCodexDraftAgent({ prompt, worktree, env = {}, resume = false, sessionId = null, model = null, teeOptions = {}, slug = null, role = null }: StartCodexAgentOptions) {
  // The launcher always tees through spawnAndTee for limit-hit detection, which
  // forces child stdio to ['inherit', 'pipe', 'pipe']. Codex's `--full-auto`
  // interactive UI requires a TTY on stdout, so we always use the headless
  // `exec` path here regardless of whether the parent has a TTY.
  ensureCodexHome(worktree);

  function isStaleSessionResult(result: any) {
    if (!result) {return false;}
    const stderr = result.stderr || '';
    const stdout = result.stdout || '';
    return (stderr.includes('Session not found') || stdout.includes('Session not found'));
  }

  function processResult(result: any) {
    if (result && result.stdout) {
      result.sessionId = extractCodexSessionId(result.stdout) || undefined;
    }
    if (result) {
      // Real usage telemetry comes from the codex rollout JSONL written under the
      // worktree-scoped codex-home, not the stdout stream (see codex-telemetry.js).
      try {
        const telemetry = extractCodexTelemetry(codexHomeRoot(worktree), { sinceMs: Date.now() });
        if (telemetry) {
          result.telemetry = telemetry;
          if (telemetry.model) {result.model = telemetry.model;}
          if (telemetry.provider) {result.provider = telemetry.provider;}
        }
      } catch (_) {
        // Telemetry is best-effort; never let it break the launch result.
      }
    }
    return result;
  }

  function staleSessionHandler(invocation: any) {
    return _spawnAndTee(invocation.command, invocation.args, { ...invocation.options, ...teeOptions })
      .then((result: any) => {
        if (isStaleSessionResult(result) && worktree && resume) {
          try {
            _sessions.clearSession(worktree, slug, role);
          } catch (_) { /* best-effort */ }
          const freshInv = buildCodexDraftInvocation({ prompt, worktree, interactive: false, env, resume: false, sessionId: null, model });
          return _spawnAndTee(freshInv.command, freshInv.args, { ...freshInv.options, ...teeOptions });
        }
        return result;
      })
      .then(processResult);
  }

  const invocation = buildCodexDraftInvocation({ prompt, worktree, interactive: false, env, resume, sessionId, model });
  const resultPromise = staleSessionHandler(invocation);

  return { invocation, resultPromise };
}

function codexHomeRoot(worktree: string) {
  return path.join(worktree, '.workflow', 'codex-home');
}

function codexConfigPath(worktree: string) {
  return path.join(codexHomeRoot(worktree), '.codex', 'config.toml');
}

function codexAuthPath(worktree: string) {
  return path.join(codexHomeRoot(worktree), '.codex', 'auth.json');
}

function userCodexAuthPath() {
  return path.join(os.homedir(), '.codex', 'auth.json');
}

function tomlString(value: any) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Graphify's Codex skill requires multi_agent = true for spawn_agent subagent
// dispatch (skill-codex.md line 233). Without this, the copied Graphify skill
// cannot launch semantic extraction subagents and parallel graph building fails.
function headlessCodexConfig(worktree: string) {
  const worktreeParent = path.dirname(path.resolve(worktree));
  return [
    'sandbox_mode = "danger-full-access"',
    '',
    '[features]',
    'multi_agent = true',
    '',
    `[projects.${tomlString(worktreeParent)}]`,
    'trust_level = "trusted"',
    'approval_policy = "never"',
    '',
    `[projects.${tomlString(path.resolve(worktree))}]`,
    'trust_level = "trusted"',
    'approval_policy = "never"',
    ''
  ].join('\n');
}

function ensureCodexHome(worktree: string) {
  fs.mkdirSync(codexHomeRoot(worktree), { recursive: true });
  fs.mkdirSync(path.dirname(codexConfigPath(worktree)), { recursive: true });
  fs.writeFileSync(codexConfigPath(worktree), headlessCodexConfig(worktree), 'utf8');

  const sourceAuthPath = userCodexAuthPath();
  if (fs.existsSync(sourceAuthPath)) {
    fs.copyFileSync(sourceAuthPath, codexAuthPath(worktree));
  }

  // Seed the globally-installed Graphify skill into the isolated worktree HOME,
  // the same way auth.json is carried over from the operator's real home. Codex
  // runs with HOME=codexHomeRoot, so it looks for skills under
  // <home>/.agents/skills; without this copy the one-time global install at
  // ~/.agents/skills is invisible to codex. This is a plain filesystem copy of
  // an existing install, not a `graphify install` invocation, and skips cleanly
  // when the skill is absent.
  const sourceSkillPath = path.join(os.homedir(), '.agents', 'skills', 'graphify');
  if (fs.existsSync(sourceSkillPath)) {
    fs.cpSync(
      sourceSkillPath,
      path.join(codexHomeRoot(worktree), '.agents', 'skills', 'graphify'),
      { recursive: true }
    );
  }
}

export {
  codexAuthPath,
  buildCodexDraftInvocation,
  codexConfigPath,
  codexHomeRoot,
  ensureCodexHome,
  extractCodexSessionId,
  extractCodexTelemetry,
  headlessCodexConfig,
  resolveCodexCommand,
  startCodexDraftAgent,
  __setSpawnAndTeeForTest,
  __setSessionsForTest
};
