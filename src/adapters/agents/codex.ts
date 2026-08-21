import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnAndTee } from '../process/spawn-tee.js';
import { extractCodexTelemetry } from './codex-telemetry.js';
import { codexHomeRoot } from '../config/state-homes.js';
import type { SessionMarkerPort } from '../../application/domain-ports.js';
import type { MissionId } from '../../domain/mission.js';
import type { SessionRole } from '../../domain/session.js';

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
  slug?: MissionId | null;
  role?: SessionRole | null;
  /** Checked application port for session markers (architecture migration cutover). */
  sessionMarkerPort?: SessionMarkerPort;
}

// Injectable I/O for tests. Production uses the real spawn-tee / export capture.
let _spawnAndTee: any = spawnAndTee;
let _sessionPort: SessionMarkerPort | null = null;

// Test hooks: override the launcher's I/O without touching the public signature.
function __setSpawnAndTeeForTest(fn: any) { _spawnAndTee = fn || spawnAndTee; }
/** @deprecated Test compatibility hook; file-backed sessions are no longer used. */
function __setSessionsForTest(_mod: any) { /* no-op */ }
function __setSessionPortForTest(port: SessionMarkerPort | null) { _sessionPort = port; }

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
  const configArgs = headlessCodexOverrides(worktree);
  const baseEnv = { ...process.env };
  if (resume) {
    const args = [...configArgs, 'exec', 'resume'];
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
        env: { ...baseEnv, ...env, ...({ HOME: baseEnv.HOME } as NodeJS.ProcessEnv), CODEX_HOME: codexStateRoot(worktree) }
      }
    };
  }

  const modelArgs = model ? ['-m', model] : [];
  const args = interactive
    ? [...configArgs, '--full-auto', ...modelArgs, '--cd', worktree, prompt]
    : [...configArgs, 'exec', '--sandbox', 'danger-full-access', ...modelArgs, '--cd', worktree, prompt];

  return {
    command: resolveCodexCommand(),
    args,
    options: {
      stdio: 'inherit',
      cwd: worktree,
      env: { ...baseEnv, ...env, ...({ HOME: baseEnv.HOME } as NodeJS.ProcessEnv), ...(!interactive ? { CODEX_HOME: codexStateRoot(worktree) } : {}) }
    }
  };
}

function startCodexDraftAgent({ prompt, worktree, env = {}, resume = false, sessionId = null, model = null, teeOptions = {}, slug = null, role = null, sessionMarkerPort }: StartCodexAgentOptions) {
  // The launcher always tees through spawnAndTee for limit-hit detection, which
  // forces child stdio to ['inherit', 'pipe', 'pipe']. Codex's `--full-auto`
  // interactive UI requires a TTY on stdout, so we always use the headless
  // `exec` path here regardless of whether the parent has a TTY.
  ensureCodexHome(worktree, env);

  const invocationStartMs = Date.now();

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
      // Real usage telemetry comes from the rollout JSONL in the isolated
      // worktree state root, not stdout.
      try {
        const telemetry = extractCodexTelemetry(codexHomeRoot(worktree), { sinceMs: invocationStartMs });
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
      .then(async (result: any) => {
        if (isStaleSessionResult(result) && worktree && resume) {
          try {
            const port = sessionMarkerPort || _sessionPort;
            if (!port || !slug || !role) {
              throw new Error('Could not clear stale session marker: SessionMarkerPort is required');
            }
            await port.delete(slug, role);
          } catch (error) { throw error; }
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


function codexStateRoot(worktree: string) {
  return path.join(codexHomeRoot(worktree), '.codex');
}

function codexConfigPath(worktree: string) {
  return path.join(codexHomeRoot(worktree), '.codex', 'config.toml');
}

function codexAuthPath(worktree: string) {
  return path.join(codexHomeRoot(worktree), '.codex', 'auth.json');
}

function tomlString(value: any) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function originatingCodexStateRoot(env: {[key: string]: string} = {}) {
  return env.CODEX_HOME || process.env.CODEX_HOME || path.join(process.env.HOME || os.homedir(), '.codex');
}

function replaceWithLink(source: string, target: string) {
  if (path.resolve(source) === path.resolve(target)) {return;}
  try {
    fs.unlinkSync(target);
  } catch (error: any) {
    if (error && error.code !== 'ENOENT') {throw error;}
  }
  if (!fs.existsSync(source)) {return;}
  fs.symlinkSync(source, target);
}

function headlessCodexOverrides(worktree: string) {
  const worktreeParent = path.dirname(path.resolve(worktree));
  return [
    '--config', 'features.multi_agent=true',
    '--config', 'approval_policy="never"',
    '--config', `projects.${tomlString(worktreeParent)}.trust_level="trusted"`,
    '--config', `projects.${tomlString(path.resolve(worktree))}.trust_level="trusted"`,
  ];
}

function ensureCodexHome(worktree: string, env: {[key: string]: string} = {}) {
  const stateRoot = codexStateRoot(worktree);
  fs.mkdirSync(stateRoot, { recursive: true });
  const sourceStateRoot = originatingCodexStateRoot(env);

  // Retain the operator's configuration and file-based auth without copying
  // their contents into the mission. Sessions, logs, and cache remain under
  // the worktree-local CODEX_HOME, preserving mission isolation.
  replaceWithLink(path.join(sourceStateRoot, 'config.toml'), codexConfigPath(worktree));
  replaceWithLink(path.join(sourceStateRoot, 'auth.json'), codexAuthPath(worktree));

  // Preserve the existing mission-local Graphify skill seed. Unlike config and
  // auth, this is installed instruction content rather than operator state or
  // credentials, so it remains a copy within the isolated mission workspace.
  const sourceSkillPath = path.join(os.homedir(), '.agents', 'skills', 'graphify');
  if (fs.existsSync(sourceSkillPath)) {
    fs.cpSync(sourceSkillPath, path.join(codexHomeRoot(worktree), '.agents', 'skills', 'graphify'), { recursive: true });
  }
}

// Codex sometimes exits 1 after a turn that actually completed (e.g. a
// cleanup-path crash once the model has already responded). The rollout
// JSONL under codexHomeRoot is written directly by the Codex CLI as it
// processes the turn, so a non-zero-usage token_count event there is
// trustworthy evidence the run produced real work, independent of the
// final exit code. Mirrors isSpuriousOpencodeExit() in opencode.ts.
function isSpuriousCodexExit(result: any) {
  if (!result || result.status !== 1 || result.signal || result.error) {return false;}
  const t = result.telemetry;
  return Boolean(t && ((t.totalTokens || 0) > 0 || (t.inputTokens || 0) > 0 || (t.outputTokens || 0) > 0));
}

export {
  codexAuthPath,
  buildCodexDraftInvocation,
  codexConfigPath,
  codexHomeRoot,
  codexStateRoot,
  ensureCodexHome,
  extractCodexSessionId,
  extractCodexTelemetry,
  isSpuriousCodexExit,
  resolveCodexCommand,
  startCodexDraftAgent,
  __setSpawnAndTeeForTest,
  __setSessionsForTest,
  __setSessionPortForTest
};
