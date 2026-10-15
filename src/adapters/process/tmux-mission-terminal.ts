/**
 * tmux implementation of the application's mission terminal host port (TASK-2749).
 *
 * The only module that turns a logical mission-terminal identity into tmux
 * handles for reading, attaching and closing: the socket, the encoded session
 * name and window targets never leave it. Probes are bounded by a timeout, and
 * a probe that cannot decide says so instead of reporting absence. Capture is
 * read-only: it never attaches, sends keys or mutates the server.
 */
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { processStartIdentity, probeProcessLiveness } from './process-liveness.js';
import { isRunHistoryId } from '../../application/run-history-types.js';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import type { MissionTerminalHostPort, MissionTerminalSessionsResult } from '../../application/ports/mission-terminal.js';
import type { MissionTerminalScope } from '../../application/ports/mission-terminal.js';
import { closeMissionTerminal, missionSocketPath, retireMissionTerminal, stopEmptyServer, tmuxAttachArgs, tmuxSessionName } from './tmux-host.js';

type SpawnSync = typeof childProcess.spawnSync;

/** Read probes run while an operator or browser waits; keep them short. */
const PROBE_TIMEOUT_MS = 1000;

type Failure = { readonly ok: false; readonly reason: 'host-missing' | 'failed' | 'timeout'; readonly detail: string };

function failure(result: ReturnType<SpawnSync>): Failure | 'no-server' {
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') { return { ok: false, reason: 'host-missing', detail: 'tmux is not installed or not on PATH; the terminal state is unknown' }; }
  if (code === 'ETIMEDOUT' || result.signal === 'SIGTERM') { return { ok: false, reason: 'timeout', detail: `tmux did not answer within ${PROBE_TIMEOUT_MS} ms` }; }
  const stderr = String(result.stderr ?? '');
  // A socket file without a server is definitive absence, not a failure.
  if (/no server running|error connecting|server exited|No such file or directory/i.test(stderr)) { return 'no-server'; }
  return { ok: false, reason: 'failed', detail: `tmux failed (${result.error ? result.error.message : `exit ${result.status}`})` };
}

function positivePid(value: string | undefined): boolean {
  return /^[1-9][0-9]*$/.test(value ?? '');
}

export function createTmuxMissionTerminalHost(options: { readonly configuration: ParallixConfiguration; readonly spawnSyncFn?: SpawnSync; readonly repositoryKey: string; readonly executionAlive?: (_pid: number) => boolean | null }): MissionTerminalHostPort {
  const spawnSyncFn = options.spawnSyncFn ?? childProcess.spawnSync;
  const socketOf = (identity: MissionTerminalScope) => missionSocketPath({ repositoryKey: options.repositoryKey, missionId: identity.missionId }, options.configuration);
  const run = (args: string[]) => spawnSyncFn('tmux', args, { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  return {
    sessions(identity): MissionTerminalSessionsResult {
      const socket = socketOf(identity);
      if (!fs.existsSync(socket)) { return { ok: true, sessions: null }; }
      const listed = run(['-S', socket, 'list-sessions', '-F', '#{session_name}']);
      if (listed.error || listed.status !== 0) {
        const failed = failure(listed);
        return failed === 'no-server' ? { ok: true, sessions: null } : failed;
      }
      const names = String(listed.stdout).split('\n').filter(Boolean);
      const native = tmuxSessionName(identity);
      const owned = names.includes(native) ? native : null;
      const others = names.filter(name => name !== native);
      if (owned === null) { return { ok: true, sessions: { owned, others, operations: [] } }; }
      const windows = run(['-S', socket, 'list-windows', '-t', `=${owned}`, '-F', '#{window_name}\t#{@px_host_pid}\t#{@px_command_pid}\t#{@px_run_id}']);
      if (windows.error || windows.status !== 0) {
        const failed = failure(windows);
        return failed === 'no-server' ? { ok: true, sessions: null } : failed;
      }
      const operations = String(windows.stdout).split('\n').filter(Boolean).map(line => line.split('\t'))
        // Finished windows clear both PIDs while their output relay drains.
        .filter(([name, host, command]) => name !== 'console' && (positivePid(host) || positivePid(command)))
        .map(([name, , command, runId]) => ({ name, started: positivePid(command), runId: runId && isRunHistoryId(runId) ? runId : null,
          ...(runId && isRunHistoryId(runId) ? { execution: positivePid(command) ? (options.executionAlive ?? (pid => probeProcessLiveness(pid, processStartIdentity(pid))))(Number(command)) : false } : {}) }));
      return { ok: true, sessions: { owned, others, operations } };
    },
    capture(identity, session, window) {
      const target = `=${session}:${window ?? 'console'}`;
      const captured = run(['-S', socketOf(identity), 'capture-pane', '-p', '-J', '-t', target]);
      if (!captured.error && captured.status === 0) { return { ok: true, output: String(captured.stdout) }; }
      const failed = failure(captured);
      return failed === 'no-server' ? { ok: false, reason: 'failed', detail: 'the mission terminal closed during capture' }
        : { ok: false, reason: failed.reason === 'timeout' ? 'timeout' : 'failed', detail: failed.detail };
    },
    attach(identity, session, readOnly) {
      const attached = spawnSyncFn('tmux', tmuxAttachArgs(socketOf(identity), session, readOnly), { stdio: 'inherit' });
      return attached.status ?? 1;
    },
    close(identity, session) {
      closeMissionTerminal(socketOf(identity), session, spawnSyncFn);
    },
    retire(identity, session) {
      const socket = socketOf(identity);
      if (!fs.existsSync(socket)) { return; }
      if (session === null) { stopEmptyServer(socket, spawnSyncFn); return; }
      retireMissionTerminal(socket, session, spawnSyncFn);
    },
  };
}
