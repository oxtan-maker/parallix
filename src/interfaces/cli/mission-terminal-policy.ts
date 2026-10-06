import { MISSION_TERMINAL_COMMANDS } from './runtime.js';

export function missionTerminalRequest(command: string, args: readonly string[]): { slug?: string } | null {
  if (!MISSION_TERMINAL_COMMANDS.has(command) || args.includes('--help') || args.includes('--json')) { return null; }
  if (command === 'verify') { return {}; } // Its positional argument is an area.
  // These operations accept the mission in their first positional slot.
  // Never interpret an option value (such as --depends task-1) as that slot.
  const first = args[0];
  return first && !first.startsWith('-') ? { slug: first } : {};
}
