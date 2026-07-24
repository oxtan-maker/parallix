import type { AgentAvailability, AgentBlock, AgentFamily } from '../../domain/agents.js';
import { agentFamily } from '../../domain/agents.js';
import type { AgentReadAdapter } from '../../application/projections/board-readers.js';
import type { AgentBlockEntry, AgentBlocklistRepository } from '../sqlite/ports.js';
import type { MissionId } from '../../domain/mission.js';

// ---------------------------------------------------------------------------
// Parse-primitive types
// ---------------------------------------------------------------------------

type GetTaskAssigneeFn = (_taskFilePath: string) => string | null;
type ResolveTaskFileFn = (_slug: string, _rootDir?: string) => { ok: boolean; taskFile?: string; matches: string[]; reason?: string };

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultResolveTaskFile(): ResolveTaskFileFn {
  const { resolveTaskFile } = require('../../platform/runtime/lib/tools/backlog.js');
  return resolveTaskFile as ResolveTaskFileFn;
}

function defaultGetTaskAssignee(): GetTaskAssigneeFn {
  const { getTaskAssignee } = require('../../platform/runtime/lib/tools/backlog.js');
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
    const blocks = await this.blocklistRepo.findAll();
    const blockMap = new Map<string, AgentBlockEntry>();
    for (const entry of blocks) {
      blockMap.set(entry.agent.toLowerCase(), entry);
    }

    const nowMs = Date.now();
    const availability: AgentAvailability[] = this.knownAgentFamilies.map((family) => {
      const blockEntry = blockMap.get(family.toLowerCase());
      const block: AgentBlock = this.blockFromEntry(blockEntry, nowMs);
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

  private blockFromEntry(entry: AgentBlockEntry | undefined, nowMs: number): AgentBlock {
    if (!entry || !entry.blocked) {
      return { kind: 'none' };
    }

    if (entry.until) {
      const untilMs = new Date(entry.until).getTime();
      if (Number.isFinite(untilMs) && untilMs > nowMs) {
        return { kind: 'until', untilMs, reason: entry.reason || null };
      }
      // Expired timed block → treat as indefinite if still marked blocked
      return { kind: 'indefinite', reason: entry.reason || null };
    }

    return { kind: 'indefinite', reason: entry.reason || null };
  }
}
