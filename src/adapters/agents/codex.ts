import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentProcessResult, AgentProcessSpawn } from './agent-process-types.js';
import { spawnAndTee, type SpawnTeeOptions } from '../process/spawn-tee.js';
import { extractCodexTelemetry } from './codex-telemetry.js';
import { codexHomeRoot, originatingCodexStateRoot } from '../config/state-homes.js';
import type { SessionMarkerPort } from '../../application/domain-ports.js';
import type { MissionId } from '../../domain/mission.js';
import type { SessionRole } from '../../domain/session.js';

interface CodexInvocationOptions {
  configuration?: ParallixConfiguration;
  prompt: string;
  worktree: string;
  interactive?: boolean;
  env?: NodeJS.ProcessEnv;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
  /** Enable Codex's native sandbox when Bubblewrap is unavailable. */
  sandbox?: boolean;
}

/**
 * A Codex launch handed to spawn-tee: argv plus the spawn options.
 *
 * `input` carries the prompt on stdin for the headless `exec` paths; the
 * interactive TUI owns stdin and therefore omits it. `CODEX_HOME` is present
 * only for the headless paths, which keep worktree-local Codex state.
 */
interface CodexInvocation {
  command: string;
  args: string[];
  options: {
    stdio: 'inherit';
    input?: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
  };
}

interface StartCodexAgentOptions extends CodexInvocationOptions {
  teeOptions?: SpawnTeeOptions;
  slug?: MissionId | null;
  role?: SessionRole | null;
  /** Checked application port for session markers (architecture migration cutover). */
  sessionMarkerPort?: SessionMarkerPort;
}

// Injectable I/O for tests. Production uses the real spawn-tee / export capture.
let _spawnAndTee: AgentProcessSpawn = spawnAndTee;
let _sessionPort: SessionMarkerPort | null = null;

// Test hooks: override the launcher's I/O without touching the public signature.
function __setSpawnAndTeeForTest(fn: AgentProcessSpawn | null) { _spawnAndTee = fn || spawnAndTee; }
/** @deprecated Test compatibility hook; file-backed sessions are no longer used. */
function __setSessionsForTest(_mod: unknown) { /* no-op */ }
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

function codexModelArgs(model: string | null) { return model ? ['-m', model] : []; }

// Headless `codex exec` and `codex exec resume` read the prompt from stdin when
// it is `-` (verified against codex-cli 0.162.1). One argv element is capped at
// 128 KiB on Linux, so a large recovery prompt passed as an argument fails the
// spawn with E2BIG before Codex runs.
const CODEX_STDIN_PROMPT = '-';

function buildCodexDraftInvocation({ configuration = DEFAULT_CONFIGURATION, prompt, worktree, interactive = hasLiveTty(), env: extraEnv = {}, resume = false, sessionId = null, model = null, sandbox = false }: CodexInvocationOptions): CodexInvocation {
  const configArgs = headlessCodexOverrides(worktree);
  const baseEnv = configuration.forwardedEnvironment;
  if (resume) {
    const args = [...configArgs, 'exec'];
    if (sandbox) {args.push('--sandbox', 'workspace-write');}
    args.push('resume');
    if (sessionId) {
      args.push(sessionId);
    } else {
      args.push('--last');
    }
    if (model) {args.push('-m', model);}
    args.push(CODEX_STDIN_PROMPT);
    return {
      command: resolveCodexCommand(),
      args,
      options: {
        stdio: 'inherit',
        input: prompt,
        cwd: worktree,
        env: { ...baseEnv, ...extraEnv, HOME: configuration.storage.homeDirectory, CODEX_HOME: codexStateRoot(worktree) }
      }
    };
  }

  const modelArgs = codexModelArgs(model);
  const env = { ...baseEnv, ...extraEnv, HOME: configuration.storage.homeDirectory };
  if (interactive) {
    // The interactive TUI owns the terminal's stdin, so only headless exec reads the prompt there.
    return {
      command: resolveCodexCommand(),
      args: [...configArgs, '--full-auto', ...modelArgs, '--cd', worktree, prompt],
      options: { stdio: 'inherit', cwd: worktree, env }
    };
  }
  return {
    command: resolveCodexCommand(),
    args: [...configArgs, 'exec', ...(sandbox ? ['--sandbox', 'workspace-write'] : []), ...modelArgs, '--cd', worktree, CODEX_STDIN_PROMPT],
    options: { stdio: 'inherit', input: prompt, cwd: worktree, env: { ...env, CODEX_HOME: codexStateRoot(worktree) } }
  };
}

function startCodexDraftAgent({ configuration = DEFAULT_CONFIGURATION, prompt, worktree, env = {}, resume = false, sessionId = null, model = null, sandbox = false, teeOptions = {}, slug = null, role = null, sessionMarkerPort }: StartCodexAgentOptions) {
  // The launcher always tees through spawnAndTee for limit-hit detection, which
  // forces child stdio to ['inherit', 'pipe', 'pipe']. Codex's `--full-auto`
  // interactive UI requires a TTY on stdout, so we always use the headless
  // `exec` path here regardless of whether the parent has a TTY.
  ensureCodexHome(worktree, configuration);

  const invocationStartMs = Date.now();

  function isStaleSessionResult(result: AgentProcessResult) {
    // Adapter-owned parsing of Codex CLI diagnostics; never exposed as a workflow signal.
    if (!result) {return false;}
    const stderr = result.stderr || '';
    const stdout = result.stdout || '';
    // codex-cli 0.162 reports an unknown session as "no rollout found for thread id".
    return [stderr, stdout].some(text => text.includes('Session not found') || text.includes('no rollout found for thread id'));
  }

  function processResult(result: AgentProcessResult) {
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

  function staleSessionHandler(invocation: ReturnType<typeof buildCodexDraftInvocation>) {
    return _spawnAndTee(invocation.command, invocation.args, { ...invocation.options, ...teeOptions, configuration })
      .then(async (result: AgentProcessResult) => {
        if (isStaleSessionResult(result) && worktree && resume) {
          try {
            const port = sessionMarkerPort || _sessionPort;
            if (!port || !slug || !role) {
              throw new Error('Could not clear stale session marker: SessionMarkerPort is required');
            }
            await port.delete(slug, role);
          } catch (error) { throw error; }
          const freshInv = buildCodexDraftInvocation({ configuration, prompt, worktree, interactive: false, env, resume: false, sessionId: null, model, sandbox });
          return _spawnAndTee(freshInv.command, freshInv.args, { ...freshInv.options, ...teeOptions, configuration });
        }
        return result;
      })
      .then(processResult);
  }

  const invocation = buildCodexDraftInvocation({ configuration, prompt, worktree, interactive: false, env, resume, sessionId, model, sandbox });
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

function tomlString(value: unknown) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function replaceWithLink(source: string, target: string) {
  if (path.resolve(source) === path.resolve(target)) {return;}
  try {
    fs.unlinkSync(target);
  } catch (error: unknown) {
    if (error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {throw error;}
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

function ensureCodexHome(worktree: string, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION) {
  const stateRoot = codexStateRoot(worktree);
  fs.mkdirSync(stateRoot, { recursive: true });
  const sourceStateRoot = originatingCodexStateRoot(configuration);

  // Retain the operator's configuration and file-based auth without copying
  // their contents into the mission. Sessions, logs, and cache remain under
  // the worktree-local CODEX_HOME, preserving mission isolation.
  replaceWithLink(path.join(sourceStateRoot, 'config.toml'), codexConfigPath(worktree));
  replaceWithLink(path.join(sourceStateRoot, 'auth.json'), codexAuthPath(worktree));

  // Preserve the existing mission-local Graphify skill seed. Unlike config and
  // auth, this is installed instruction content rather than operator state or
  // credentials, so it remains a copy within the isolated mission workspace.
  const sourceSkillPath = path.join(configuration.storage.homeDirectory || os.homedir(), '.agents', 'skills', 'graphify');
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
function isSpuriousCodexExit(result: AgentProcessResult) {
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
