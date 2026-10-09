import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MissionId } from '../../domain/mission.js';
import type { SessionRole } from '../../domain/session.js';
import type { SessionMarkerPort } from '../../application/domain-ports.js';
import { buildSubagentLimitPrefix } from './subagent-limit.js';
import { type RenderSink } from './agent-stream-view.js';
import { type NoOutputWatchdog } from '../process/output-watchdog.js';

interface BuildPiInvocationOptions {
  configuration?: ParallixConfiguration;
  prompt: string;
  worktree: string;
  env?: object;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
}

interface PiTeeOptions {
  configuration?: ParallixConfiguration;
  stdoutSink?: RenderSink;
  noOutputWatchdog?: NoOutputWatchdog | null;
  onSpawn?: (_child: import('node:child_process').ChildProcess) => void;
}

interface StartPiAgentOptions {
  configuration?: ParallixConfiguration;
  prompt: string;
  worktree: string;
  env?: object;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
  teeOptions?: PiTeeOptions;
  slug?: MissionId | null;
  role?: SessionRole | null;
  maxTransientRetries?: number;
  /** Checked application port for session markers (architecture migration cutover). */
  sessionMarkerPort?: SessionMarkerPort;
}

function piCommandCandidates(configuration: ParallixConfiguration) {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate?: string | null) => {
    if (!candidate || seen.has(candidate)) { return; }
    seen.add(candidate);
    candidates.push(candidate);
  };

  pushCandidate(configuration.agents.piBin);
  if (configuration.agents.nvmBin) {
    pushCandidate(path.join(configuration.agents.nvmBin, 'pi'));
  }
  pushCandidate(path.join(path.dirname(process.execPath), 'pi'));
  pushCandidate('pi');
  pushCandidate(path.join(configuration.storage.homeDirectory || os.homedir(), '.local', 'bin', 'pi'));
  pushCandidate('/usr/local/bin/pi');
  pushCandidate('/opt/pi/bin/pi');

  return candidates;
}

function resolveExistingCommand(candidate: string, configuration: ParallixConfiguration) {
  if (!candidate) { return null; }
  if (candidate.includes(path.sep)) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) {
      return null;
    }
  }

  const dirs = configuration.agents.searchPath.split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) { continue; }
    const commandPath = path.join(dir, candidate);
    try {
      fs.accessSync(commandPath, fs.constants.X_OK);
      return candidate;
    } catch (_) { /* keep looking */ }
  }
  return null;
}

function resolvePiCommand(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION) {
  for (const candidate of piCommandCandidates(configuration)) {
    const resolved = resolveExistingCommand(candidate, configuration);
    if (resolved) { return resolved; }
  }
  return 'pi';
}

function buildPiInvocation({ configuration = DEFAULT_CONFIGURATION, prompt, worktree, env, resume = false, sessionId = null, model = null }: BuildPiInvocationOptions) {
  const args: string[] = ['--print', '--mode', 'json', '--approve'];

  if (model) {
    args.push('--model', model);
  }

  if (resume && sessionId) {
    args.push('--session-id', sessionId);
  } else if (resume) {
    args.push('--continue');
  }

  args.push(prompt);

  return {
    command: resolvePiCommand(configuration),
    args,
    options: {
      cwd: worktree,
      env: { ...configuration.forwardedEnvironment, ...env }
    }
  };
}

export { isTransientPiFailure, __setCreateAgentSessionForTest, __setSdkForTest, __setSessionsForTest } from './pi-session-runtime.js';
import { hasInjectedPiSdk, runPiSdk } from './pi-session-runtime.js';
import { startPiWorker } from './pi-worker-client.js';
let _sessionPort: SessionMarkerPort | null = null;
function __setSessionPortForTest(port: SessionMarkerPort | null) { _sessionPort = port; }
/** SDK imports now belong to the isolated child. */
export async function warmPiSdk(): Promise<void> {}

function startPiAgent(options: StartPiAgentOptions) {
  const configuration = options.configuration ?? DEFAULT_CONFIGURATION;
  const prompt = buildSubagentLimitPrefix(undefined) + options.prompt;
  const invocation = buildPiInvocation({ configuration, ...options, prompt });
  const clearStaleMarker = async () => {
    const port = options.sessionMarkerPort || _sessionPort;
    if (!port || !options.slug || !options.role) { throw new Error('Could not clear stale session marker: SessionMarkerPort is required'); }
    await port.delete(options.slug, options.role);
  };
  if (hasInjectedPiSdk()) {
    return { invocation, resultPromise: runPiSdk({ ...options, configuration, prompt, ...options.teeOptions, clearStaleMarker }) };
  }
  return { invocation, resultPromise: startPiWorker({ ...options, configuration, prompt }, invocation, clearStaleMarker) };
}

export { buildPiInvocation, resolvePiCommand, startPiAgent, __setSessionPortForTest };
