import { missionId } from '../../domain/mission.js';
import type { MissionId } from '../../domain/mission.js';
import type { AgentRunIdentity } from '../../domain/agent-run.js';

/** Native terminal addressing; never a domain repository identity. */
export interface NativeMissionTerminalIdentity {
  readonly repositoryKey: string;
  readonly missionId: MissionId;
}
export type NativeTerminalRun = NativeMissionTerminalIdentity & Pick<AgentRunIdentity, 'role' | 'family' | 'attempt' | 'startedAtMs'>;
export function missionTerminalIdentity(input: { readonly repositoryKey: string; readonly missionId: string }): NativeMissionTerminalIdentity {
  if (typeof input.repositoryKey !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.repositoryKey)) { throw new Error('Invalid repository key'); }
  return { repositoryKey: input.repositoryKey, missionId: missionId(input.missionId) };
}
