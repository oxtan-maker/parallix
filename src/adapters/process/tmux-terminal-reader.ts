/** Read-only capture of a Mission's live tmux terminal for the local web host. */
import childProcess from 'node:child_process';
import { missionSocketPath } from './tmux-host.js';

export type MissionTerminalOutput =
  | { readonly kind: 'live'; readonly output: string }
  | { readonly kind: 'unavailable'; readonly message: string };

export interface MissionTerminalReader { read(_missionId: string): MissionTerminalOutput; }
type SpawnSync = typeof childProcess.spawnSync;

/** Captures only; it never attaches, sends keys, or invokes a tmux mutation. */
export function createTmuxTerminalReader(options: { resolveMissionWorktree: (_missionId: string) => string | null; repositoryKey: (_worktree: string) => string; spawnSyncFn?: SpawnSync; env?: NodeJS.ProcessEnv }): MissionTerminalReader {
  const { resolveMissionWorktree: findWorktree, repositoryKey } = options;
  const spawnSyncFn = options.spawnSyncFn ?? childProcess.spawnSync;
  const env = options.env ?? process.env;
  return { read(missionId) {
    const worktree = findWorktree(missionId);
    if (worktree === null) { return { kind: 'unavailable', message: 'No live tmux session is available for this mission.' }; }
    const socket = missionSocketPath({ repositoryKey: repositoryKey(worktree), missionId }, env);
    const windows = spawnSyncFn('tmux', ['-S', socket, 'list-windows', '-t', `=${missionId}`, '-F', '#{window_name}\t#{@px_command_pid}'], { encoding: 'utf8', timeout: 1000 });
    if (windows.status !== 0) { return { kind: 'unavailable', message: 'No live tmux session is available for this mission.' }; }
    const entries = String(windows.stdout).split('\n').filter(Boolean).map(line => line.split('\t'));
    // The command PID is installed immediately before exec; during that tiny
    // launch race prefer an operation pane to the retained operator console.
    const live = entries.find(([, pid]) => /^[1-9][0-9]*$/.test(pid ?? ''))
      ?? entries.find(([name]) => name !== 'console')
      ?? entries[0];
    if (live === undefined || !live[0]) { return { kind: 'unavailable', message: 'No live tmux session is available for this mission.' }; }
    const capture = spawnSyncFn('tmux', ['-S', socket, 'capture-pane', '-p', '-J', '-t', `=${missionId}:${live[0]}`], { encoding: 'utf8', timeout: 1000 });
    return capture.status === 0
      ? { kind: 'live', output: String(capture.stdout) }
      : { kind: 'unavailable', message: 'No live tmux session is available for this mission.' };
  } };
}
