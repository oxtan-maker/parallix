import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as fmt from '../../application/presentation/cli-format.js';
import { resolveConfiguredCredentialRedactor } from '../../application/recovery-evidence.js';
import type { RunSource } from '../../application/run-history-types.js';
import { agentRunId, agentRunIdentity } from '../../domain/agent-run.js';
import type { AgentRunIdentity } from '../../domain/agent-run.js';
import { loadAdapterConfig } from '../config/product-config.js';
import { missionRepositoryKey } from '../filesystem/mission-repository-key.js';
import { claudeProjectDir, codexHomeRoot, qwenHomeRoot } from '../config/state-homes.js';
import { terminalHostConfig } from '../config/terminal-host-config.js';
import type { TerminalHostConfig } from '../config/terminal-host-config.js';
import { openRunCapture } from '../filesystem/run-history-store.js';
import type { RunCapture } from '../filesystem/run-history-store.js';
import type { OutputCapture, TerminalHost } from '../process/spawn-tee.js';
import { prepareTmuxLaunch, probeTmux, reconcileOrphanSessions, missionSocketPath } from '../process/tmux-host.js';
import type { TmuxProbe } from '../process/tmux-host.js';

/**
 * One agent launch's run session (TASK-2643): its identity, durable history
 * capture and optional tmux terminal host. The launch loop stays the only
 * lifecycle authority; this module only adds what the launch prints to a
 * durable, attributable record and, when configured, an attachable terminal.
 */

/** Families that launch in-process rather than through a spawned child. */
const IN_PROCESS_FAMILIES = new Set(['pi']);

export interface RunSessionInput {
  readonly worktree: string | undefined;
  readonly slug: string | null;
  /** Session-marker role when known, otherwise the launch step. */
  readonly role: string;
  readonly family: string;
  readonly attempt: number;
  readonly log: (_line: string) => void;
}

export interface RunSessionDeps {
  readonly interactive?: boolean;
  readonly now?: () => Date;
  readonly probe?: () => TmuxProbe;
  readonly config?: (_worktree: string) => TerminalHostConfig;
  readonly repositoryKey?: (_worktree: string) => string;
  readonly env?: NodeJS.ProcessEnv;
  /** tmux command seam; unit tests pass a double so they never run tmux. */
  readonly spawnSyncFn?: typeof spawnSync;
}

export interface RunSession {
  readonly runId: string;
  readonly identity: AgentRunIdentity;
  /** Options merged into the launcher's spawn-tee options. */
  readonly teeOptions: { terminalHost?: TerminalHost; capture?: OutputCapture; stdoutSink?: { write(_chunk: Buffer | string): unknown; isTTY?: boolean } };
  finish(_result: { status?: number | null; signal?: string | null; sessionId?: string | null } | null | undefined): void;
}

/** Thrown when tmux is configured with `whenUnavailable: "fail"` and cannot run. */
export class TerminalHostUnavailableError extends Error {
  code = 'TERMINAL_HOST_UNAVAILABLE';
  constructor(reason: string) {
    super(`Terminal host unavailable: ${reason}. Install tmux, or set adapters.terminal.whenUnavailable to "fallback" or adapters.terminal.host to "pipe".`);
    this.name = 'TerminalHostUnavailableError';
  }
}

/** Find a provider transcript file named for `sessionId` under `root`, depth-bounded. */
export function findTranscript(root: string, sessionId: string, depth = 5): string | null {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes(sessionId)) { return path.join(root, entry.name); }
  }
  if (depth <= 0) { return null; }
  for (const entry of entries) {
    if (!entry.isDirectory()) { continue; }
    const found = findTranscript(path.join(root, entry.name), sessionId, depth - 1);
    if (found) { return found; }
  }
  return null;
}

/** Where each family keeps its native transcript for a worktree. */
function transcriptRoot(family: string, worktree: string): string | null {
  if (family === 'claude') { return claudeProjectDir(worktree); }
  if (family === 'codex') { return path.join(codexHomeRoot(worktree), 'sessions'); }
  if (family === 'qwen') { return path.join(qwenHomeRoot(worktree), 'projects'); }
  return null;
}

function providerSources(capture: RunCapture, family: string, worktree: string, sessionId: string | null, tmux: boolean): { sources: RunSource[]; omissions: string[] } {
  const terminal = tmux ? 'stdout (pane bytes, stderr merged)' : 'stdout and stderr';
  const sources: RunSource[] = [family === 'claude'
    ? { kind: 'provider-stream', path: 'stdout', covers: `Claude stream-json events from ${terminal}: assistant text, tool calls and tool results the CLI emitted`, complete: true }
    : { kind: 'terminal-bytes', path: 'stdout', covers: `raw bytes ${family} wrote to ${terminal}, including ANSI control and alternate-screen output`, complete: true }];
  const omissions = ['Model reasoning and tool activity the provider did not print or log are not captured.'];
  const root = transcriptRoot(family, worktree);
  const file = root && sessionId ? findTranscript(root, sessionId) : null;
  const kept = file ? capture.retainProviderFile(file, path.basename(file)) : null;
  if (kept) {
    sources.push({ kind: 'provider-transcript', path: kept.path, covers: `${family} native session transcript ${sessionId}`, complete: kept.complete });
  } else {
    omissions.push(`No ${family} provider-native transcript was retained${sessionId ? ` for session ${sessionId}` : ' (no session id was reported)'}.`);
  }
  return { sources, omissions };
}

/**
 * Open the run session for one launch. Returns `null` when the launch has no
 * Mission worktree (nothing to attribute history to). Capture failures are
 * reported and never block the launch; a configured tmux host that cannot run
 * falls back to `pipe` or refuses, as configured, but never launches broken.
 */
export function openRunSession(input: RunSessionInput, deps: RunSessionDeps = {}): RunSession | null {
  if (!input.worktree || !input.slug) { return null; }
  const worktree = input.worktree;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const identity = agentRunIdentity({
    repositoryKey: (deps.repositoryKey ?? missionRepositoryKey)(worktree),
    missionId: input.slug,
    role: input.role,
    family: input.family,
    attempt: input.attempt,
    startedAtMs: now().getTime(),
  });
  const runId = agentRunId(identity);
  const config = (deps.config ?? ((root: string) => terminalHostConfig(loadAdapterConfig(root))))(worktree);
  let fallbackReason: string | null = null;
  let useTmux = false;
  const inheritedTerminal = env.PARALLIX_MISSION_TERMINAL === input.slug && Boolean(env.PARALLIX_MISSION_SOCKET);
  if (inheritedTerminal) { useTmux = true; }
  else if (config.host !== 'pipe' && (deps.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY))) {
    const probe = Buffer.byteLength(missionSocketPath(identity, env)) > 100
      ? { available: false, version: null, reason: 'Mission terminal socket path exceeds the portable Unix socket limit' }
      : IN_PROCESS_FAMILIES.has(input.family)
      ? { available: false, version: null, reason: `${input.family} needs an outer mission command terminal` }
      : (deps.probe ?? (() => probeTmux()))();
    if (probe.available) {
      useTmux = true;
    } else if (config.host === 'tmux' && config.whenUnavailable === 'fail') {
      throw new TerminalHostUnavailableError(probe.reason ?? 'tmux is not available');
    } else {
      fallbackReason = probe.reason;
      if (config.host !== 'auto') { input.log(fmt.status('WARN', `tmux terminal host unavailable (${probe.reason}); launching ${fmt.agent(input.family)} through the pipe host.`)); }
    }
  }
  if (useTmux && !inheritedTerminal) {
    const killed = reconcileOrphanSessions(identity, { env, allRoles: true, ...(deps.spawnSyncFn ? { spawnSyncFn: deps.spawnSyncFn } : {}) });
    if (killed.length > 0) { input.log(fmt.status('INFO', `Stopped unsupervised tmux session(s) from an earlier launch: ${killed.join(', ')}.`)); }
  }
  let capture: RunCapture | null = null;
  try {
    capture = openRunCapture({
      worktree, identity, runId,
      terminalHost: useTmux ? 'tmux' : 'pipe',
      hostFallbackReason: fallbackReason,
      tmuxSocketPath: inheritedTerminal ? env.PARALLIX_MISSION_SOCKET! : useTmux ? missionSocketPath(identity, env) : null,
      redactor: resolveConfiguredCredentialRedactor(),
      now,
    });
  } catch (err) {
    input.log(fmt.status('WARN', `Run history capture is unavailable for this launch: ${(err as Error).message}`));
  }
  if (inheritedTerminal) { capture?.addTmuxSession(input.slug); }
  let spawnIndex = 0;
  const terminalHost: TerminalHost | undefined = useTmux && !inheritedTerminal ? {
    host: (launch, context) => {
      const hosted = prepareTmuxLaunch({ identity, spawnIndex: spawnIndex++, command: launch.command, args: launch.args, cwd: context.cwd, env: context.env }, { env, ...(deps.spawnSyncFn ? { spawnSyncFn: deps.spawnSyncFn } : {}) });
      capture?.addTmuxSession(hosted.sessionName);
      input.log(fmt.status('INFO', `Agent terminal: attach with ${fmt.command(`px attach ${input.slug}`)} (detach with Ctrl-b d).`));
      return hosted;
    },
  } : undefined;
  const sink = capture;
  const outputCapture: OutputCapture | undefined = sink ? { write: (stream, chunk) => sink.write(stream, chunk) } : undefined;
  // In-process launchers render to a sink instead of a child's pipes: capture what they render.
  const stdoutSink = sink && IN_PROCESS_FAMILIES.has(input.family)
    ? { isTTY: process.stdout.isTTY, write: (chunk: Buffer | string) => { sink.write('stdout', Buffer.from(chunk)); return process.stdout.write(chunk); } }
    : undefined;
  return {
    runId,
    identity,
    teeOptions: { ...(terminalHost ? { terminalHost } : {}), ...(outputCapture ? { capture: outputCapture } : {}), ...(stdoutSink ? { stdoutSink } : {}) },
    finish: (result) => {
      if (!capture) { return; }
      try {
        const sessionId = result?.sessionId ?? null;
        const provider = providerSources(capture, input.family, worktree, sessionId, useTmux && !inheritedTerminal);
        if (IN_PROCESS_FAMILIES.has(input.family)) {
          provider.sources[0] = { kind: 'terminal-bytes', path: 'stdout', covers: `text the in-process ${input.family} session rendered`, complete: true };
        }
        capture.finish({ exitCode: result?.status ?? null, signal: result?.signal ?? null, providerSessionId: sessionId, ...provider });
      } catch (err) {
        input.log(fmt.status('WARN', `Could not finalize run history ${runId}: ${(err as Error).message}`));
      }
    },
  };
}
