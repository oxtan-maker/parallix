import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { Command } from '../interfaces/cli/runtime.js';
import { createClassificationCommand, createGoalCommand, createCheckpointCommand } from '../interfaces/cli/mission-writes.js';
import { inferSlug } from '../adapters/filesystem/mission-paths.js';
import { createMissionApplicationServices } from './mission-services.js';

/** Brief writes share one Mission-only composition across every CLI entrypoint. */
export function createBriefWriteCommands(rootDir: string, configuration: ParallixConfiguration, operatorInvocation = false): Record<string, Command> {
  const invoke = async (command: 'classification' | 'goal' | 'checkpoint', args: string[]) => {
    const mission = await createMissionApplicationServices(rootDir, { configuration });
    try {
      if (command === 'checkpoint') {
        return await createCheckpointCommand(mission.checkpoints, explicit => inferSlug(explicit), rootDir, operatorInvocation)(args);
      }
      const create = command === 'classification' ? createClassificationCommand : createGoalCommand;
      return await create({ ...mission, resolveSlug: explicit => inferSlug(explicit) })(args);
    }
    finally { await mission.store.drain?.(); }
  };
  return {
    classification: args => invoke('classification', args),
    goal: args => invoke('goal', args),
    checkpoint: args => invoke('checkpoint', args),
  };
}
