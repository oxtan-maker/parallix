import { spawnAndTee } from '../process/spawn-tee.js';
import { extractQwenTelemetry } from './qwen-telemetry.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { qwenHomeRoot as qwenStateHome } from '../config/state-homes.js';

/**
 * Maximum acceptable age (in minutes) for a qwen session's start time
 * relative to the invocation start. Sessions older than this window are
 * rejected as potentially misattributed across concurrent missions.
 */
const MAX_SESSION_AGE_MINUTES = 120;

interface QwenInvocationOptions {
  prompt: string;
  worktree: string;
  env?: Record<string, string>;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
}

interface StartQwenAgentOptions extends QwenInvocationOptions {
  teeOptions?: object;
}

function resolveQwenWorktree(worktree?: string | null) {
  return worktree || process.cwd();
}

function qwenHomeRoot(worktree: string) {
  return qwenStateHome(resolveQwenWorktree(worktree));
}

function qwenSettingsPath(worktree: string) {
  return path.join(qwenHomeRoot(worktree), 'settings.json');
}

function qwenUsageDir(worktree: string) {
  return path.join(qwenHomeRoot(worktree), 'usage');
}

function qwenProjectsDir(worktree: string) {
  return path.join(qwenHomeRoot(worktree), 'projects');
}

function userQwenDir() {
  return path.join(os.homedir(), '.qwen');
}

function userQwenSettingsPath() {
  return path.join(userQwenDir(), 'settings.json');
}

function userQwenCredentialsPath() {
  return path.join(userQwenDir(), 'oauth_creds.json');
}

/**
 * Read settings.json from user qwen dir, merge approvalMode:yolo,
 * and write to worktree-local home. Secrets are copied but live in
 * .workflow/ which is git-ignored, so no secrets leak into tracked paths.
 */
function ensureQwenHome(
  worktree: string,
  sourceSettings = userQwenSettingsPath(),
  sourceCredentials = userQwenCredentialsPath(),
) {
  const home = qwenHomeRoot(worktree);
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(qwenUsageDir(worktree), { recursive: true });

  const targetSettings = qwenSettingsPath(worktree);
  if (fs.existsSync(sourceCredentials)) {
    fs.copyFileSync(sourceCredentials, path.join(home, 'oauth_creds.json'));
  }

  if (!fs.existsSync(sourceSettings)) {
    // No user settings — write minimal settings with approval bypass
    fs.writeFileSync(targetSettings, JSON.stringify({ tools: { approvalMode: 'yolo' } }, null, 2), 'utf8');
    return;
  }

  try {
    const sourceText = fs.readFileSync(sourceSettings, 'utf8');
    const settings = JSON.parse(sourceText);
    // Ensure non-interactive tool-call approval bypass (TASK-1398 failure mode:
    // without yolo, any prompt needing a tool call blocks on interactive
    // approval outside a TTY and fails with a generic error, writing a
    // false blocklist entry on every launch).
    if (!settings.tools) {
      settings.tools = {};
    }
    settings.tools.approvalMode = 'yolo';
    fs.writeFileSync(targetSettings, JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    // If source is unreadable or malformed, write minimal yolo settings
    fs.writeFileSync(targetSettings, JSON.stringify({ tools: { approvalMode: 'yolo' } }, null, 2), 'utf8');
  }
}

/**
 * Extract session ID from disk artifacts.
 * Qwen writes chat files to <QWEN_HOME>/projects/<project-hash>/chats/<sessionId>.jsonl.
 * Session ID is the filename (UUID without extension).
 * Scans for the most recent chat file within the invocation window.
 */
function extractQwenSessionId(basePath: string, invocationStart?: string): string | null {
  const projectsDir = basePath || qwenProjectsDir(process.cwd());

  let invokeTime = NaN;
  if (invocationStart) {
    invokeTime = Date.parse(invocationStart);
  }

  try {
    const projectDirs = fs.readdirSync(projectsDir).filter((d: string) => {
      try { return fs.statSync(path.join(projectsDir, d)).isDirectory(); } catch { return false; }
    });

    let bestSessionId: string | null = null;
    let bestMtime = 0;

    for (const projectDir of projectDirs) {
      const chatsDir = path.join(projectsDir, projectDir, 'chats');
            if (!fs.existsSync(chatsDir)) { continue; }

      const chatFiles = fs.readdirSync(chatsDir).filter((f: string) => f.endsWith('.jsonl'));
      for (const file of chatFiles) {
        const filePath = path.join(chatsDir, file);
        let stat: fs.Stats;
        try { stat = fs.statSync(filePath); } catch { continue; }

        // Invocation window guard — skip files older than MAX_SESSION_AGE_MINUTES
        // before the invocation start (prevents stale session misattribution).
        if (!Number.isNaN(invokeTime)) {
          const cutoff = invokeTime - (MAX_SESSION_AGE_MINUTES * 60000);
          if (stat.mtimeMs < cutoff) {
            continue;
          }
        }

        if (stat.mtimeMs > bestMtime) {
          bestMtime = stat.mtimeMs;
          bestSessionId = file.replace(/\.jsonl$/, '');
        }
      }
    }

    return bestSessionId;
  } catch {
    return null;
  }
}

function resolveQwenCommand() {
  return 'qwen';
}

function buildQwenInvocation({ prompt, worktree, env, resume = false, sessionId = null, model = null }: QwenInvocationOptions) {
  const rootDir = resolveQwenWorktree(worktree);
  const args: string[] = ['-p', prompt, '--output-format', 'text'];

  if (resume) {
    if (sessionId) {
      args.push('-r', sessionId);
    } else {
      args.push('-c');
    }
  }

  // Only pass -m if operator explicitly configures it.
  // TASK-1351 precedent: model flag is a footgun when hardcoded.
  if (model) {
    args.push('-m', model);
  }

  return {
    command: resolveQwenCommand(),
    args,
    options: {
      stdio: 'inherit',
      cwd: rootDir,
      env: { ...process.env, ...env, QWEN_HOME: qwenHomeRoot(rootDir) }
    }
  };
}

// Qwen Code currently exits 0 for this provider rejection, even though no
// assistant turn was completed. Keep this adapter-specific so a successful
// exit from every other agent retains the shared quoted-transcript safeguard.
function isQwenQuotaExhausted(result: any) {
  if (!result || result.status !== 0 || result.signal || result.error) { return false; }
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  return /Quota exhausted:[\s\S]{0,500}\bcause:\s*insufficient_quota:\s*429\b/i.test(text);
}

/**
 * Attach the session id and disk-based telemetry to a finished launch result.
 * Mirrors codex.ts processResult: both come from artifacts in the isolated
 * home, not from stdout, and telemetry is best-effort so a parse failure never
 * breaks the launch.
 */
function processResult(result: any, rootDir: string, invocationStart: string) {
  if (!result) { return result; }
  if (isQwenQuotaExhausted(result)) { result.status = 1; }
  result.sessionId = extractQwenSessionId(qwenProjectsDir(rootDir), invocationStart);
  try {
    const telemetry = extractQwenTelemetry(qwenHomeRoot(rootDir), { sinceMs: Date.parse(invocationStart), sessionId: result.sessionId });
    if (telemetry) {
      result.telemetry = telemetry;
      if (telemetry.model) { result.model = telemetry.model; }
      if (telemetry.provider) { result.provider = telemetry.provider; }
    }
  } catch {
    // Telemetry is best-effort; never let it break the launch result.
  }
  return result;
}

/**
 * A stored session marker outlives the chat file it points at (the worktree's
 * qwen home can be wiped while the marker persists), and `qwen -r <unknown-id>`
 * fails the whole launch. Detect that and relaunch fresh instead of losing the
 * run. Mirrors isStaleSessionResult()/staleSessionHandler() in codex.ts.
 */
function isStaleQwenSessionResult(result: any) {
  if (!result || result.status === 0) { return false; }
  const text = `${result.stderr || ''}${result.stdout || ''}`;
  return /session not found|no session|invalid session/i.test(text);
}

function startQwenAgent({ prompt, worktree, env, resume = false, sessionId = null, model = null, teeOptions = {} }: StartQwenAgentOptions) {
  const rootDir = resolveQwenWorktree(worktree);
  ensureQwenHome(rootDir);
  const invocation = buildQwenInvocation({ prompt, worktree: rootDir, env, resume, sessionId, model });
  const invocationStart = new Date().toISOString();

  const spawn = (inv: any) => spawnAndTee(inv.command, inv.args, { ...inv.options, ...teeOptions } as any);

  const resultPromise = spawn(invocation).then((result: any) => {
    if (resume && sessionId && isStaleQwenSessionResult(result)) {
      const fresh = buildQwenInvocation({ prompt, worktree: rootDir, env, resume: false, sessionId: null, model });
      return spawn(fresh).then((freshResult: any) => processResult(freshResult, rootDir, invocationStart));
    }
    return processResult(result, rootDir, invocationStart);
  });

  return { invocation, resultPromise, invocationStart };
}

/**
 * Qwen sometimes exits 1 after a turn that actually completed (e.g. a
 * cleanup-path crash once the model has already responded). When telemetry
 * shows non-zero token usage, the run produced real work regardless of exit
 * code. Mirrors isSpuriousCodexExit() and isSpuriousVibeExit().
 */
function isSpuriousQwenExit(result: any) {
  if (!result || result.status !== 1 || result.signal || result.error) { return false; }
  if (isQwenQuotaExhausted({ ...result, status: 0 })) { return false; }
  const t = result.telemetry;
  return Boolean(t && ((t.totalTokens || 0) > 0 || (t.inputTokens || 0) > 0 || (t.outputTokens || 0) > 0));
}

export {
  buildQwenInvocation,
  ensureQwenHome,
  extractQwenSessionId,
  isQwenQuotaExhausted,
  isSpuriousQwenExit,
  isStaleQwenSessionResult,
  processResult,
  qwenHomeRoot,
  qwenProjectsDir,
  qwenSettingsPath,
  qwenUsageDir,
  resolveQwenCommand,
  startQwenAgent,
  userQwenDir,
  userQwenSettingsPath,
  MAX_SESSION_AGE_MINUTES
};
