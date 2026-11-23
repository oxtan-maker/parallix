import { reviewOperation } from '../domain/review-command-policy.js';
import { spawn } from 'node:child_process';
import type { WorkflowOperationRecord as WorkflowOperation } from '../application/ports/workflow-operation.js';
import type { ParallixConfiguration } from "../application/ports/configuration.js";
import { randomUUID } from 'node:crypto';
import { constants as osConstants } from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { missionId } from '../domain/mission.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import type { ExecutionActivityIntent } from '../application/recording/execution-activity-recorder.js';
import type { OpenRunCaptureInput } from '../adapters/filesystem/run-history-store.js';
import type { NativeMissionTerminalIdentity } from '../adapters/process/mission-terminal-identity.js';
import { resolveConfiguredCredentialRedactor } from '../application/recovery-evidence.js';
import type { RunSource } from '../application/run-history-types.js';
import { loadAdapterConfig, resolveCanonicalRepositoryRoot } from '../adapters/config/product-config.js';
import { terminalHostConfig } from '../adapters/config/terminal-host-config.js';
import type { TerminalHostConfig } from '../adapters/config/terminal-host-config.js';
import type { TerminalHostAvailability } from '../application/ports/terminal-host-selection.js';
import { selectTerminalHost, selectionAfterLaunchFailure } from '../application/ports/terminal-host-selection.js';
import { inferSlug, isMissionSlugCandidate, resolveWorktree } from '../adapters/filesystem/mission-utils.js';
import { missionRepositoryKey } from '../adapters/filesystem/mission-repository-key.js';
import { openRunCapture, correlateRunOperation } from '../adapters/filesystem/run-history-store.js';
import type { RunCapture } from '../adapters/filesystem/run-history-store.js';
import { missionTerminalRequest } from '../interfaces/cli/mission-terminal-policy.js';
import { missionSocketPath, prepareTmuxLaunch, probeTmux, reconcileOrphanSessions, superviseTmuxLaunch } from '../adapters/process/tmux-host.js';
import type { TmuxLaunch, TmuxLaunchExit } from '../adapters/process/tmux-host.js';
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
function openOperationCapture(worktree: string, identity: OpenRunCaptureInput['identity'], runId: string, configuration: ParallixConfiguration, tmuxSocketPath: string | null, log: (_line: string) => void, hostFallbackReason: string | null = null): RunCapture | null {
  try {
    return openRunCapture({
      worktree, identity, runId, captureKind: 'coordinator', terminalHost: tmuxSocketPath ? 'tmux' : 'pipe', hostFallbackReason, tmuxSocketPath,
      redactor: resolveConfiguredCredentialRedactor(configuration.runtime.credentialRedactor),
    });
  } catch (error) {
    log(`Mission history capture is unavailable for this operation: ${(error as Error).message}`);
    return null;
  }
}

function finishOperation(capture: RunCapture | null, result: TmuxLaunchExit, source: RunSource, omissions: string[]): void {
  try { capture?.finish({ ...result, sources: [source], omissions }); } catch { /* the record stays `running` and reads as interrupted */ }
}

function numericExit(result: TmuxLaunchExit): number {
  if (result.exitCode !== null) { return result.exitCode; }
  const number = result.signal ? osConstants.signals[result.signal] : undefined;
  return number ? 128 + number : 1;
}

interface HostMissionOptions {
  readonly interactive?: boolean;
  readonly configuration: ParallixConfiguration;
  /** Receives the reason the pipe host took over, so the pipe-executed operation's record carries it. */
  readonly onPipeFallback?: (_reason: string) => void;
  /** tmux probe seam; unit tests pass a double so they never run tmux. */
  readonly probe?: () => TerminalHostAvailability;
  /** Supervision seam; unit tests pass a double so a prepared launch never runs tmux. */
  readonly supervise?: typeof superviseTmuxLaunch;
}

/** Select the terminal host; `false` means the pipe host runs the operation, after reporting why. */
function isHosted(config: TerminalHostConfig, slug: string, socketPath: string, log: (_line: string) => void, options: HostMissionOptions): boolean {
  const configuration = options.configuration;
  const selection = selectTerminalHost({
    config,
    inherited: configuration.terminal.missionTerminal === slug || Boolean(configuration.terminal.tmux?.startsWith(`${socketPath},`)),
    interactive: options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
    probe: options.probe ?? probeTmux,
  });
  if (selection.kind === 'refused') { throw new Error(`Terminal host unavailable: ${selection.reason}`); }
  if (selection.kind === 'hosted') { return true; }
  if (selection.kind === 'pipe' && selection.reason) {
    options.onPipeFallback?.(selection.reason);
    if (selection.notify) { log(`tmux terminal host unavailable (${selection.reason}); running through the pipe host.`); }
  }
  return false;
}

/** Composition supplies the process host; workflow policy stays in the child CLI. */
export async function hostMissionCommand(command: string, args: string[], target: string, log: (_line: string) => void, cli: CliInvocation, options: HostMissionOptions): Promise<number | null> {
  // Owned workflows host their executor, while this foreground process
  // remains the signal and replay boundary.
  if (isOwnedWorkflow(command, args)) { return null; }
  const configuration = options.configuration;
  const operation = operationIdentity(command, args, target);
  if (!operation) { return null; }
  const { slug, worktree, identity, terminal, runId } = operation;
  const config = terminalHostConfig(loadAdapterConfig(worktree));
  const result = await runHostedOperation({
    config, configuration, identity: terminal, runId, cwd: worktree, command: cli.command, args: [...cli.args, command, ...args],
    ...(options.supervise ? { supervise: options.supervise } : {}),
    extraEnv: { PARALLIX_TERMINAL_RETURN_DIR: resolveCanonicalRepositoryRoot(worktree) },
    select: socketPath => isHosted(config, slug, socketPath, log, options),
    // An unsafe transcript destination is actionable even when pipe hosting takes over; a command that never started only records the reason.
    onPipeHandover: (reason, phase) => {
      if (phase === 'prepare') { log(`Mission terminal unavailable; running through the pipe host: ${reason}`); }
      options.onPipeFallback?.(reason);
    },
    onPrepared: socketPath => {
      log(`Mission terminal: px attach ${slug} (detach with Ctrl-b d).`);
      // The supervisor records every pane byte of the operation, attached or not.
      return openOperationCapture(worktree, identity, runId, configuration, socketPath, log);
    },
    finish: (capture, exit, started) => finishOperation(capture, exit, { kind: 'terminal-bytes', path: 'stdout', covers: `everything the hosted ${command} operation drew in its terminal pane: harness, preflight, gates, agent output, review preparation and review messages (stderr merged by the terminal)`, complete: true },
      started ? [] : ['The operation did not start in the terminal; it may run through the pipe host as a separate operation.']),
  });
  return result === null ? null : numericExit(result);
}

/** What differs per caller; everything else about hosting one operation in tmux is shared. */
interface HostedOperation {
  readonly config: TerminalHostConfig;
  readonly configuration: ParallixConfiguration;
  readonly identity: NativeMissionTerminalIdentity & { readonly role: string };
  readonly runId: string;
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly extraEnv?: Readonly<Record<string, string>>;
  /** Applies the shared selection policy to the resolved socket; `false` means the caller already handed the operation to the pipe host. */
  readonly select: (_socketPath: string) => boolean;
  /** The launch failed before the command started and the pipe host takes over; `prepare` failures never created a session. */
  readonly onPipeHandover: (_reason: string, _phase: 'prepare' | 'start') => void;
  /** Open the caller's capture contract for the prepared launch; capture never blocks the command. */
  readonly onPrepared: (_socketPath: string, _launch: TmuxLaunch) => RunCapture | null;
  /** Supervision seam; defaults to the native supervisor. */
  readonly supervise?: typeof superviseTmuxLaunch;
  /** Close a capture the lifecycle opened; callers whose capture is closed elsewhere omit it. */
  readonly finish?: (_capture: RunCapture | null, _exit: TmuxLaunchExit, _started: boolean) => void;
}

/**
 * Host one mission operation in tmux: resolve the socket, select the host,
 * reconcile orphans, prepare the launch, open capture, observe the immutable
 * execution identity, relay supervised output, finish and clean up. Returns
 * the operation's structured exit, or `null` when the pipe host must run it (it
 * never started here). A command that started is never replayed.
 */
async function runHostedOperation(operation: HostedOperation): Promise<TmuxLaunchExit | null> {
  const { config, configuration, identity, runId } = operation;
  const socketPath = missionSocketPath(identity, configuration);
  if (!operation.select(socketPath)) { return null; }
  reconcileOrphanSessions(identity, { allRoles: true, configuration });
  let launch: TmuxLaunch;
  try {
    launch = prepareTmuxLaunch({
      identity, runId, spawnIndex: 0, command: operation.command, args: [...operation.args], cwd: operation.cwd,
      env: { ...configuration.forwardedEnvironment, PARALLIX_MISSION_TERMINAL: identity.missionId, PARALLIX_MISSION_SOCKET: socketPath, PARALLIX_OPERATION_CAPTURE: runId, ...operation.extraEnv },
    }, { configuration });
  } catch (error) {
    const failed = selectionAfterLaunchFailure(config, (error as Error).message);
    if (failed.kind === 'refused') { throw error; }
    operation.onPipeHandover(failed.reason, 'prepare');
    return null;
  }
  const capture = operation.onPrepared(socketPath, launch);
  capture?.addTmuxSession(launch.sessionName);
  const stopObservation = observeTmuxLaunchExecution(launch, (pid, processIdentity) => capture?.observeExecution(pid, processIdentity));
  let exit: TmuxLaunchExit;
  try {
    exit = await (operation.supervise ?? superviseTmuxLaunch)(launch, { onOutput: (stream, chunk) => { try { capture?.write(stream, chunk); } catch { /* keep the command running */ } } });
  } finally { stopObservation(); }
  const started = launch.started();
  operation.finish?.(capture, exit, started);
  if (started || exit.exitCode !== 70 || exit.signal !== null) { return exit; }
  const failed = selectionAfterLaunchFailure(config, 'Terminal host failed before the command started');
  if (failed.kind === 'refused') { throw new Error(failed.reason); }
  operation.onPipeHandover(failed.reason, 'start');
  return null;
}

function isOwnedWorkflow(command: string, args: readonly string[]): boolean {
  return command === 'draft' || command === 'integrate'
    || command === 'review' && ['enter', 'submit'].includes(reviewOperation(args));
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
export async function captureMissionCommand(command: string, args: string[], target: string, configuration: ParallixConfiguration, run: () => Promise<number>, hostFallbackReason: string | null = null): Promise<number> {
  if (configuration.terminal.operationCapture) { return run(); }
  const operation = operationIdentity(command, args, target);
  if (!operation) { return run(); }
  const capture = openOperationCapture(operation.worktree, operation.identity, operation.runId, configuration, null, () => {}, hostFallbackReason);
  if (!capture) { return run(); }
  const restore = [tee(process.stdout, 'stdout', capture), tee(process.stderr, 'stderr', capture)];
  let exitCode: number | null = null;
  try {
    exitCode = await captures.run({ capture, missionId: operation.identity.missionId }, run);
    return exitCode;
  } finally {
    restore.forEach(undo => undo());
    finishOperation(capture, { exitCode, signal: null }, { kind: 'terminal-bytes', path: 'stdout', covers: `what the ${command} operation printed through this process (stdout and stderr kept apart)`, complete: false },
      ['Output a child process wrote straight to the terminal (for example a gate run with inherited stdio) bypasses this process and is not captured in pipe execution.']);
  }
}

const captures = new AsyncLocalStorage<{ capture: RunCapture; missionId: string }>();

/** Composition connects existing CurrentWork publication to the retained coordinator capture. */
export function correlateMissionCapture(checkout: string, configuration: ParallixConfiguration, work: ExecutionActivityIntent): void {
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
  capture: RunCapture, configuration: ParallixConfiguration, probe?: () => TerminalHostAvailability, supervise?: typeof superviseTmuxLaunch): Promise<WorkflowExecutorExit> {
  const args = [...cli.args, '--workflow-execute', operation.id, root];
  const hosted = await hostWorkflowTerminal(cli, args, operation, root, runId, capture, configuration, probe, supervise);
  if (hosted) { return hosted; }
  capture.setTerminalHost?.('pipe', null);
  const child = spawn(cli.command, args, { cwd: root, env: { ...configuration.forwardedEnvironment, PARALLIX_OPERATION_CAPTURE: runId }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => capture.write('stdout', chunk));
  // One coordinator transcript preserves the observed order of both pipes.
  child.stderr.on('data', chunk => capture.write('stdout', chunk));
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode, signal) => resolve({ exitCode, signal })); });
}

interface WorkflowExecutorExit { readonly exitCode: number | null; readonly signal: string | null; }

async function hostWorkflowTerminal(cli: CliInvocation, args: readonly string[], operation: WorkflowOperation, root: string,
  runId: string, capture: RunCapture, configuration: ParallixConfiguration, probe: () => TerminalHostAvailability = probeTmux, supervise?: typeof superviseTmuxLaunch): Promise<WorkflowExecutorExit | null> {
  const policy = terminalHostConfig(loadAdapterConfig(root));
  const exit = await runHostedOperation({
    config: policy, configuration, runId, cwd: root, command: cli.command, args, ...(supervise ? { supervise } : {}),
    identity: { repositoryKey: missionRepositoryKey(root), missionId: operation.missionId, role: operation.command.split(':')[0] },
    select: () => {
      // The executor is hosted for the retained mission console whether or not a caller TTY exists; attaching stays the operator's TTY-conditional choice.
      const selection = selectTerminalHost({ config: policy, inherited: false, interactive: true, probe });
      if (selection.kind === 'refused') { throw new Error(`Terminal host unavailable: ${selection.reason}`); }
      if (selection.kind === 'hosted') { return true; }
      pipeFallback(capture, selection.kind === 'pipe' ? selection.reason : null);
      return false;
    },
    onPipeHandover: reason => pipeFallback(capture, reason),
    // The supervisor that opened this capture finishes it, including after a pipe handover.
    onPrepared: socketPath => { capture.setTerminalHost?.('tmux', socketPath); return capture; },
  });
  return exit;
}

/** The pipe host takes over; a reason it was not the terminal host is recorded once in the coordinator transcript. */
function pipeFallback(capture: RunCapture, reason: string | null): void {
  if (reason) { capture.write('stdout', Buffer.from(`Terminal host unavailable (${reason}); running through the pipe host.\n`)); }
}
