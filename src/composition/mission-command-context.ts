import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { resolveWorktree } from '../adapters/git/worktree.js';
import { isMissionSlugCandidate } from '../adapters/filesystem/mission-utils.js';

const bound = new Set(['active', 'review', 'integrate', 'recover', 'rebase', 'resolve-conflict', 'verify']);

/** Restore Mission context even after an interactive console's rc changes cwd. */
export function missionCommandTarget(command: string, args: readonly string[], root: string,
  configuration: ParallixConfiguration, locate = resolveWorktree): string {
  if (!bound.has(command) || args.includes('--help')) { return root; }
  const explicit = command !== 'verify' && args[0] && !args[0].startsWith('-') ? args[0] : undefined;
  const slug = explicit ?? configuration.terminal.missionTerminal;
  if (!slug || !isMissionSlugCandidate(slug)) { return root; }
  // Command preflight owns missing-worktree and wrong-branch diagnostics.
  return locate(slug, { cwd: root }) ?? root;
}
