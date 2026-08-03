import type { AgentAvailability, AgentBlock, AgentFamily } from '../../domain/agents.js';
import { agentFamily } from '../../domain/agents.js';
import { AgentBlockService, parseAgentBlockUntil } from '../../application/services/agent-block-service.js';
import type { AgentReadAdapter } from '../../application/projections/board-readers.js';
import type { AgentBlocklistRepository } from '../../application/ports/agent-blocklist.js';
import type { MissionId } from '../../domain/mission.js';
import { getTaskAssignee, resolveTaskFile } from '../../platform/runtime/lib/tools/backlog.js';

// ---------------------------------------------------------------------------
// Parse-primitive types
// ---------------------------------------------------------------------------

type GetTaskAssigneeFn = (_taskFilePath: string) => string | null;
type ResolveTaskFileFn = (_slug: string, _rootDir?: string) => { ok: boolean; taskFile?: string; matches: string[]; reason?: string };

// ---------------------------------------------------------------------------
// Defaults — static imports (no circular deps)
// ---------------------------------------------------------------------------

function defaultResolveTaskFile(): ResolveTaskFileFn {
  return resolveTaskFile as ResolveTaskFileFn;
}

function defaultGetTaskAssignee(): GetTaskAssigneeFn {
  return getTaskAssignee as GetTaskAssigneeFn;
}

// ---------------------------------------------------------------------------
// Concrete AgentReadAdapter
// ---------------------------------------------------------------------------

export interface ConcreteAgentReadAdapterOptions {
  readonly rootDir: string;
  /** SQLite blocklist repository (TASK-2295 snapshot). */
  readonly blocklistRepo: AgentBlocklistRepository;
  /** Known agent families to report availability for. */
  readonly knownAgentFamilies: readonly AgentFamily[];
  /** Launcher availability probe (per agent). */
  readonly launcherAvailable?: (_family: AgentFamily) => boolean;
  /** Resolve task file for a mission slug. */
  readonly resolveTaskFile?: ResolveTaskFileFn;
  /** Read assignee from a task file. */
  readonly getTaskAssignee?: GetTaskAssigneeFn;
}

/**
 * Concrete `AgentReadAdapter` that reads agent availability and timed-block
 * countdown from the TASK-2295 operator-local SQLite snapshot (blocklist
 * repository), not by re-reading files ad hoc.
 */
export class ConcreteAgentReadAdapter implements AgentReadAdapter {
  private readonly rootDir: string;
  private readonly blocklistRepo: AgentBlocklistRepository;
  private readonly knownAgentFamilies: readonly AgentFamily[];
  private readonly launcherAvailable: (_family: AgentFamily) => boolean;
  private readonly resolveTaskFile: ResolveTaskFileFn;
  private readonly getTaskAssignee: GetTaskAssigneeFn;

  constructor(options: ConcreteAgentReadAdapterOptions) {
    this.rootDir = options.rootDir;
    this.blocklistRepo = options.blocklistRepo;
    this.knownAgentFamilies = options.knownAgentFamilies;
    this.launcherAvailable = options.launcherAvailable ?? (() => true);
    this.resolveTaskFile = options.resolveTaskFile ?? defaultResolveTaskFile();
    this.getTaskAssignee = options.getTaskAssignee ?? defaultGetTaskAssignee();
  }

  // -----------------------------------------------------------------------
  // AgentReadAdapter port
  // -----------------------------------------------------------------------

  async loadAgentAvailability(): Promise<readonly AgentAvailability[]> {
    const nowMs = Date.now();
    const states = await new AgentBlockService(this.blocklistRepo).queryAll(this.knownAgentFamilies, nowMs);
    const stateByAgent = new Map(states.map((state) => [state.agent.toLowerCase(), state]));
    const availability: AgentAvailability[] = this.knownAgentFamilies.map((family) => {
      const state = stateByAgent.get(family.toLowerCase());
      const block: AgentBlock = state?.blocked
        ? (state.until
          ? { kind: 'until', untilMs: parseAgentBlockUntil(state.until), reason: state.reason }
          : { kind: 'indefinite', reason: state?.reason ?? null })
        : { kind: 'none' };
      return {
        family,
        launcherAvailable: this.launcherAvailable(family),
        block,
      };
    });

    return availability;
  }

  async loadAssignedAgent(_missionId: MissionId): Promise<AgentFamily | null> {
    const result = this.resolveTaskFile(_missionId, this.rootDir);
    if (!result.ok || !result.taskFile) {
      return null;
    }

    const rawAssignee = this.getTaskAssignee(result.taskFile);
    if (!rawAssignee) {
      return null;
    }

    try {
      return agentFamily(rawAssignee);
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

}
