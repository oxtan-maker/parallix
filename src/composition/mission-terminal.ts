import { agentRunIdentity } from '../domain/agent-run.js';
import { loadAdapterConfig, resolveCanonicalRepositoryRoot } from '../adapters/config/product-config.js';
import { terminalHostConfig } from '../adapters/config/terminal-host-config.js';
import { inferSlug, isMissionSlugCandidate, resolveWorktree } from '../adapters/filesystem/mission-utils.js';
import { missionRepositoryKey } from '../adapters/filesystem/mission-repository-key.js';
import { missionTerminalRequest } from '../interfaces/cli/mission-terminal-policy.js';
import { missionSocketPath, prepareTmuxLaunch, probeTmux, reconcileOrphanSessions, superviseTmuxLaunch } from '../adapters/process/tmux-host.js';
import type { CliInvocation } from '../adapters/process/cli-invocation.js';

/** Composition supplies the process host; workflow policy stays in the child CLI. */
export async function hostMissionCommand(command: string, args: string[], target: string, log: (_line: string) => void, cli: CliInvocation, options: { interactive?: boolean } = {}): Promise<number | null> {
  if (!(options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY))) { return null; }
  const request = missionTerminalRequest(command, args);
  if (!request || (request.slug && !isMissionSlugCandidate(request.slug))) { return null; }
  const slug = inferSlug(request.slug);
  if (!slug || process.env.PARALLIX_MISSION_TERMINAL === slug) { return null; }
  const worktree = resolveWorktree(slug) ?? target;
  const config = terminalHostConfig(loadAdapterConfig(worktree));
  if (config.host === 'pipe') { return null; }
  const probe = probeTmux();
  if (!probe.available) {
    if (config.host === 'tmux' && config.whenUnavailable === 'fail') { throw new Error(`Terminal host unavailable: ${probe.reason}`); }
    if (config.host !== 'auto') { log(`tmux terminal host unavailable (${probe.reason}); running through the pipe host.`); }
    return null;
  }
  const identity = agentRunIdentity({
    repositoryKey: missionRepositoryKey(worktree),
    missionId: slug, role: command, family: 'parallix', attempt: 1, startedAtMs: Date.now(),
  });
  reconcileOrphanSessions(identity, { allRoles: true });
  const socketPath = missionSocketPath(identity);
  if (process.env.TMUX?.startsWith(`${socketPath},`)) {
    process.env.PARALLIX_MISSION_TERMINAL = slug;
    process.env.PARALLIX_MISSION_SOCKET = socketPath;
    return null;
  }
  let launch;
  try { launch = prepareTmuxLaunch({
    identity, spawnIndex: 0, command: cli.command, args: [...cli.args, command, ...args], cwd: worktree,
    env: { ...process.env, PARALLIX_MISSION_TERMINAL: slug, PARALLIX_MISSION_SOCKET: socketPath, PARALLIX_TERMINAL_RETURN_DIR: resolveCanonicalRepositoryRoot(worktree) },
  }); } catch (error) {
    if (config.host === 'tmux' && config.whenUnavailable === 'fail') { throw error; }
    return null;
  }
  log(`Mission terminal: px attach ${slug} (detach with Ctrl-b d).`);
  const result = await superviseTmuxLaunch(launch);
  if (!launch.started() && result === 70) {
    if (config.host === 'tmux' && config.whenUnavailable === 'fail') { throw new Error('Terminal host failed before the command started.'); }
    return null;
  }
  return result;
}
