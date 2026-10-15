import fs from 'node:fs';
import path from 'node:path';

/**
 * Mission-terminal native-handle boundary (TASK-2749).
 *
 * Mission terminals are resolved through the application's mission terminal
 * capability. Only the tmux adapter derives socket paths, session names and
 * tmux commands; launch reaches it through its own process seams, and one
 * capability binding wires it to the application. Every other module — web,
 * CLI, application, domain and browser code — passes canonical Mission IDs.
 */

/** Modules allowed to import the tmux terminal modules, beyond the tmux adapter itself. */
export const MISSION_TERMINAL_HANDLE_OWNERS: readonly string[] = [
  // Launch: whole-command hosting and agent-run hosting own their host process.
  'src/composition/mission-terminal.ts',
  'src/adapters/agents/run-session.ts',
  // The one binding of the tmux host port to the application capability.
  'src/adapters/cli/commands/mission-terminal-resources.ts',
];

const TMUX_ADAPTER = 'src/adapters/process/';
const TMUX_MODULE = /from\s+['"][^'"]*\/(?:tmux-host|tmux-mission-terminal)\.js['"]/;
const TMUX_SPAWN = /\bspawn(?:Sync)?(?:Fn)?\s*\(\s*['"]tmux['"]|\bexecFile(?:Sync)?\s*\(\s*['"]tmux['"]/;
const NATIVE_CALL = /\b(?:missionSocketPath|tmuxSessionName|tmuxMissionName|missionTerminalCapturePath|tmuxAttachArgs)\s*\(/;

function productionFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') { walk(full); } }
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) { files.push(full); }
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'web', 'src'));
  return files;
}

/** Every module that derives or reaches a native mission-terminal handle outside its owners. */
export function findMissionTerminalHandleViolations(repoRoot = process.cwd()): string[] {
  const root = path.resolve(repoRoot);
  const violations: string[] = [];
  for (const file of productionFiles(root)) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    if (relative.startsWith(TMUX_ADAPTER)) { continue; }
    const source = fs.readFileSync(file, 'utf8');
    const owner = MISSION_TERMINAL_HANDLE_OWNERS.includes(relative);
    if (relative.startsWith('src/domain/') && /\brepositoryKey\s*[?:]/.test(source)) {
      violations.push(`${relative}: declares a native repository storage key; use the existing RepositoryId`);
    }
    if (!owner && TMUX_MODULE.test(source)) { violations.push(`${relative}: imports the tmux terminal adapter; resolve the Mission through the mission terminal capability`); }
    if (!owner && NATIVE_CALL.test(source)) { violations.push(`${relative}: derives a native mission-terminal handle; pass the canonical Mission ID to the capability`); }
    if (TMUX_SPAWN.test(source)) { violations.push(`${relative}: runs tmux directly; only src/adapters/process/ may`); }
  }
  return violations;
}
