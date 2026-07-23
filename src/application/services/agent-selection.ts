import { selectAgent, type AgentSelectionSnapshot, type SelectionRequest } from '../../domain/agents.js';
import type { AgentFamily } from '../../domain/agents.js';
import type { AgentSelectionSnapshotPort } from '../ports/domain.js';

/** Async materialization happens once; every selection after prepare() is synchronous. */
export class PreparedAgentSelection {
  private readonly selectionSnapshot: AgentSelectionSnapshot;

  private constructor(snapshot: AgentSelectionSnapshot) {
    this.selectionSnapshot = snapshot;
  }

  static async prepare(port: AgentSelectionSnapshotPort): Promise<PreparedAgentSelection> {
    return new PreparedAgentSelection(await port.load());
  }

  select(step: string, request: SelectionRequest = {}): AgentFamily {
    return selectAgent(this.selectionSnapshot, step, request);
  }
}
