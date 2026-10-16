import { spawn } from 'node:child_process';
import type { WorkflowOperation } from '../domain/workflow-operation.js';
import type { ParallixConfiguration } from "../application/ports/configuration.js";
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { missionId } from '../domain/mission.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import type { CurrentWorkPublication } from '../application/recording/current-work-recorder.js';
import type { OpenRunCaptureInput } from '../adapters/filesystem/run-history-store.js';
import type { NativeMissionTerminalIdentity } from '../adapters/process/mission-terminal-identity.js';
import { resolveConfiguredCredentialRedactor } from '../application/recovery-evidence.js';
import type { RunSource } from '../application/run-history-types.js';
import { loadAdapterConfig, resolveCanonicalRepositoryRoot } from '../adapters/config/product-config.js';
import { terminalHostConfig } from '../adapters/config/terminal-host-config.js';
import { inferSlug, isMissionSlugCandidate, resolveWorktree } from '../adapters/filesystem/mission-utils.js';
import { missionRepositoryKey } from '../adapters/filesystem/mission-repository-key.js';
import { openRunCapture, correlateRunOperation } from '../adapters/filesystem/run-history-store.js';
import type { RunCapture } from '../adapters/filesystem/run-history-store.js';
import { missionTerminalRequest } from '../interfaces/cli/mission-terminal-policy.js';
import { missionSocketPath, prepareTmuxLaunch, probeTmux, reconcileOrphanSessions, superviseTmuxLaunch } from '../adapters/process/tmux-host.js';
import type { CliInvocation } from '../adapters/process/cli-invocation.js';
import { observeTmuxLaunchExecution } from '../adapters/process/tmux-launch-execution.js';

/** The mission and identity of a mission operation command, or `null` when it is not one. */
function operationIdentity(command: string, args: string[], target: string): { slug: string; worktree: string; identity: OpenRunCaptureInput['identity']; runId: string; terminal: NativeMissionTerminalIdentity & { role: string } } | null {
  const request = missionTerminalRequest(command, args);
  if (!request || (request.slug && !isMissionSlugCandidate(request.slug))) { return null; }
  const slug = inferSlug(request.slug);
  if (!slug) { return null; }
  const worktree = resolveWorktree(slug) ?? target;
  try {
    // The canonical Mission ID is kept as is; an invalid one hosts nothing.
    return {
      slug, worktree, runId: `workflow-${randomUUID()}`,
      identity: { repositoryId: resolveCanonicalRepositoryId(worktree), missionId: missionId(slug), role: command, family: null, attempt: null },
      terminal: { repositoryKey: missionRepositoryKey(worktree), missionId: missionId(slug), role: command },
    };
  } catch { return null; }
}

/** Open the operation's retained, redacted history record; capture never blocks the command. */
function openOperationCapture(worktree: string, identity: OpenRunCaptureInput['identity'], runId: string, configuration: ParallixConfiguration, tmuxSocketPath: string | null, log: (_line: string) => void): RunCapture | null {
  try {
    return openRunCapture({
      worktree, identity, runId, captureKind: 'coordinator', terminalHost: tmuxSocketPath ? 'tmux' : 'pipe', tmuxSocketPath,
      redactor: resolveConfiguredCredentialRedactor(configuration.runtime.credentialRedactor),
    });
  } catch (error) {
    log(`Mission history capture is unavailable for this operation: ${(error as Error).message}`);
    return null;
  }
}

function finishOperation(capture: RunCapture | null, exitCode: number | null, source: RunSource, omissions: string[]): void {
  try { capture?.finish({ exitCode, signal: null, sources: [source], omissions }); } catch { /* the record stays `running` and reads as interrupted */ }
}

/** Composition supplies the process host; workflow policy stays in the child CLI. */
export async function hostMissionCommand(command: string, args: string[], target: string, log: (_line: string) => void, cli: CliInvocation, options: { interactive?: boolean; configuration: ParallixConfiguration }): Promise<number | null> {
  const configuration = options.configuration;
  if (!(options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY))) { return null; }
  const operation = operationIdentity(command, args, target);
  if (!operation || configuration.terminal.missionTerminal === operation.slug) { return null; }
  const { slug, worktree, identity, terminal, runId } = operation;
  const config = terminalHostConfig(loadAdapterConfig(worktree));
  if (config.host === 'pipe') { return null; }
  if (!terminalHostReady(config, probeTmux(), log)) { return null; }
  reconcileOrphanSessions(terminal, { allRoles: true, configuration });
  const socketPath = missionSocketPath(terminal, configuration);
  if (configuration.terminal.tmux?.startsWith(`${socketPath},`)) {
    return null;
  }
  let launch;
  try { launch = prepareTmuxLaunch({
    identity: terminal, runId, spawnIndex: 0, command: cli.command, args: [...cli.args, command, ...args], cwd: worktree,
    env: { ...configuration.forwardedEnvironment, PARALLIX_MISSION_TERMINAL: slug, PARALLIX_MISSION_SOCKET: socketPath, PARALLIX_OPERATION_CAPTURE: runId, PARALLIX_TERMINAL_RETURN_DIR: resolveCanonicalRepositoryRoot(worktree) },
  }, { configuration }); } catch (error) {
    if (config.host === 'tmux' && config.whenUnavailable === 'fail') { throw error; }
    return null;
  }
  log(`Mission terminal: px attach ${slug} (detach with Ctrl-b d).`);
  // The supervisor records every pane byte of the operation, attached or not.
  const capture = openOperationCapture(worktree, identity, runId, configuration, socketPath, log);
  capture?.addTmuxSession(launch.sessionName);
  const stopObservation = observeTmuxLaunchExecution(launch, (pid, identity) => capture?.observeExecution(pid, identity));
  let result: number;
  try {
    result = await superviseTmuxLaunch(launch, { onOutput: (stream, chunk) => { try { capture?.write(stream, chunk); } catch { /* keep the command running */ } } });
  } finally { stopObservation(); }
  finishOperation(capture, result, { kind: 'terminal-bytes', path: 'stdout', covers: `everything the hosted ${command} operation drew in its terminal pane: harness, preflight, gates, agent output, handoff and review messages (stderr merged by the terminal)`, complete: true },
    launch.started() ? [] : ['The operation did not start in the terminal; it may run through the pipe host as a separate operation.']);
  return hostedMissionResult(launch, result, config);
}

function terminalHostReady(config: ReturnType<typeof terminalHostConfig>, probe: ReturnType<typeof probeTmux>, log: (_line: string) => void): boolean {
  if (probe.available) { return true; }
  if (config.host === 'tmux' && config.whenUnavailable === 'fail') { throw new Error(`Terminal host unavailable: ${probe.reason}`); }
  if (config.host !== 'auto') { log(`tmux terminal host unavailable (${probe.reason}); running through the pipe host.`); }
  return false;
}

function hostedMissionResult(launch: ReturnType<typeof prepareTmuxLaunch>, result: number, config: ReturnType<typeof terminalHostConfig>): number | null {
  if (!launch.started() && result === 70) {
    if (config.host === 'tmux' && config.whenUnavailable === 'fail') { throw new Error('Terminal host failed before the command started.'); }
    return null;
  }
  return result;
}

type Write = typeof process.stdout.write;

function tee(stream: NodeJS.WriteStream, name: 'stdout' | 'stderr', capture: RunCapture): () => void {
  const original = stream.write;
  stream.write = function (this: NodeJS.WriteStream, chunk: unknown, ...rest: unknown[]) {
    try { capture.write(name, typeof chunk === 'string' ? Buffer.from(chunk, typeof rest[0] === 'string' ? rest[0] as BufferEncoding : 'utf8') : Buffer.from(chunk as Uint8Array)); }
    catch { /* capture never blocks output */ }
    return (original as (..._args: unknown[]) => boolean).call(this, chunk, ...rest);
  } as Write;
  return () => { stream.write = original; };
}

/**
 * Record a mission operation that runs in this process (pipe execution, or a
 * command typed into the retained console) as one attributed history record
 * (TASK-2749). A hosted operation's supervisor already records it, so the child
 * it hosts does not record itself a second time.
 */
export async function captureMissionCommand(command: string, args: string[], target: string, configuration: ParallixConfiguration, run: () => Promise<number>): Promise<number> {
  if (configuration.terminal.operationCapture) { return run(); }
  const operation = operationIdentity(command, args, target);
  if (!operation) { return run(); }
  const capture = openOperationCapture(operation.worktree, operation.identity, operation.runId, configuration, null, () => {});
  if (!capture) { return run(); }
  const restore = [tee(process.stdout, 'stdout', capture), tee(process.stderr, 'stderr', capture)];
  let exitCode: number | null = null;
  try {
    exitCode = await captures.run({ capture, missionId: operation.identity.missionId }, run);
    return exitCode;
  } finally {
    restore.forEach(undo => undo());
    finishOperation(capture, exitCode, { kind: 'terminal-bytes', path: 'stdout', covers: `what the ${command} operation printed through this process (stdout and stderr kept apart)`, complete: false },
      ['Output a child process wrote straight to the terminal (for example a gate run with inherited stdio) bypasses this process and is not captured in pipe execution.']);
  }
}

const captures = new AsyncLocalStorage<{ capture: RunCapture; missionId: string }>();

/** Composition connects existing CurrentWork publication to the retained coordinator capture. */
export function correlateMissionCapture(checkout: string, configuration: ParallixConfiguration, work: CurrentWorkPublication): void {
  const capture = captures.getStore();
  if (capture) {
    if (capture.missionId === work.missionId) { capture.capture.correlateOperation(work.operationId); }
  }
  else if (configuration.terminal.operationCapture) {
    correlateRunOperation(checkout, work.missionId, configuration.terminal.operationCapture, work.operationId);
  }
}

/** Headless hosting uses the same native resolver and capture machinery as CLI. */
export async function hostWorkflowExecutor(cli: CliInvocation, operation: WorkflowOperation, root: string, runId: string,
  capture: RunCapture, configuration: ParallixConfiguration): Promise<WorkflowExecutorExit> {
  const args = [...cli.args, '--workflow-execute', operation.id, root];
  const hosted = await hostWorkflowTerminal(cli, args, operation, root, runId, capture, configuration);
  if (hosted) { return hosted; }
  capture.setTerminalHost?.('pipe', null);
  const child = spawn(cli.command, args, { cwd: root, env: { ...configuration.forwardedEnvironment }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => capture.write('stdout', chunk));
  child.stderr.on('data', chunk => capture.write('stderr', chunk));
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode, signal) => resolve({ exitCode, signal })); });
}

interface WorkflowExecutorExit { readonly exitCode: number | null; readonly signal: string | null; }

async function hostWorkflowTerminal(cli: CliInvocation, args: readonly string[], operation: WorkflowOperation, root: string,
  runId: string, capture: RunCapture, configuration: ParallixConfiguration): Promise<WorkflowExecutorExit | null> {
  const policy = terminalHostConfig(loadAdapterConfig(root));
  if (policy.host === 'pipe') { return null; }
  const required = policy.host === 'tmux' && policy.whenUnavailable === 'fail';
  const probe = probeTmux();
  if (!probe.available) {
    if (required) { throw new Error(`Terminal host unavailable: ${probe.reason}`); }
    return null;
  }
  const identity = { repositoryKey: missionRepositoryKey(root), missionId: operation.missionId, role: operation.command.split(':')[0] };
  const socket = missionSocketPath(identity, configuration);
  let launch;
  try {
    launch = prepareTmuxLaunch({ identity, runId, spawnIndex: 0, command: cli.command, args, cwd: root,
      env: { ...configuration.forwardedEnvironment, PARALLIX_MISSION_TERMINAL: operation.missionId, PARALLIX_MISSION_SOCKET: socket, PARALLIX_OPERATION_CAPTURE: runId } }, { configuration });
  } catch (error) { if (required) { throw error; } return null; }
  capture.setTerminalHost?.('tmux', socket);
  capture.addTmuxSession(launch.sessionName);
  const exitCode = await superviseTmuxLaunch(launch, { onOutput: (stream, chunk) => capture.write(stream, chunk) });
  if (launch.started() || exitCode !== 70) { return { exitCode, signal: null }; }
  if (required) { throw new Error('Terminal host failed before the workflow started'); }
  return null;
}
