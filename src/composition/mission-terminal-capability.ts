import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { MissionTerminalCapability } from '../application/ports/mission-terminal.js';
import { createRecordedOutputRenderer } from '../adapters/agents/recorded-output-renderer.js';
import { createMissionTerminalResources } from '../adapters/cli/commands/mission-terminal-resources.js';

/**
 * The published mission terminal capability for one repository (TASK-2749).
 * The web host, the CLI and board actions resolve a Mission's terminal and
 * retained history through this one binding; none derives native handles.
 */
export function createMissionTerminalCapability(rootDir: string, configuration: ParallixConfiguration): MissionTerminalCapability {
  return createMissionTerminalResources(rootDir, { configuration, renderer: createRecordedOutputRenderer() });
}
