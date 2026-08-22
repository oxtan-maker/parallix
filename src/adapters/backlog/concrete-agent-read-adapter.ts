import type { AgentAvailability, AgentBlock, AgentFamily } from '../../domain/agents.js';
import { agentFamily } from '../../domain/agents.js';
import { AgentBlockService, parseAgentBlockUntil } from '../../application/services/agent-block-service.js';
import type { AgentReadAdapter, RunningAgentSession } from '../../application/projections/board-readers.js';
import type { SessionMarkerRepository } from '../../application/ports/mission-store.js';
import { detectRunningMissionSessions, type RunningMissionSession } from '../agents/running-sessions.js';
import type { AgentBlocklistRepository } from '../../application/ports/agent-blocklist.js';
import type { LauncherProbeResult } from '../agents/launcher-availability.js';
import type { MissionId } from '../../domain/mission.js';
import {
  CURRENT_WORK_TTL_MS,
  isWorkInProgress,
  reconcileCurrentWork,
  type CurrentWorkReadAdapter,
  type ProcessLivenessProbe,
} from '../../application/projections/current-work.js';
import { getTaskAssignee, resolveTaskFile } from './backlog.js';
import { readAgentConfig, type AgentConfig } from '../agents/agent-config.js';
import { resolveAgentBlockAuthority } from '../agents/agent-block-authority.js';

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

/** An agent family from untrusted text, or null when it is not one. */
function parseAgentFamily(value: string | null): AgentFamily | null {
  if (value === null) { return null; }
  try {
    return agentFamily(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Concrete AgentReadAdapter
// ---------------------------------------------------------------------------

export interface ConcreteAgentReadAdapterOptions {
  readonly rootDir: string;
  /** SQLite blocklist repository (architecture migration snapshot). */
  readonly blocklistRepo: AgentBlocklistRepository;
  /** Known agent families to report availability for. */
  readonly knownAgentFamilies: readonly AgentFamily[];
  /** Effective config, including local block overrides. */
  readonly readAgentConfig?: () => AgentConfig | null;
  /**
   * Launcher availability probe (per agent). Production passes a cached probe
   * (`createLauncherProbe`); tests may pass a stub. When omitted the adapter
   * reports launcher state as unknown-but-present, which is only safe in tests
   * — a board that never probes claims families are available when their CLI
   * is not installed.
   */
  readonly launcherAvailable?: (_family: AgentFamily) => LauncherProbeResult;
  /** Resolve task file for a mission slug. */
  readonly resolveTaskFile?: ResolveTaskFileFn;
  /** Read assignee from a task file. */
  readonly getTaskAssignee?: GetTaskAssigneeFn;
  /**
   * Session markers, used only to attribute a running mission to the family
   * that launched it. Omitted (or absent rows) means the running session
   * cannot be attributed, which is reported as unknown rather than as zero.
   */
  readonly sessionMarkers?: SessionMarkerRepository | null;
  /** Reconciled current-work authority, which names the family running a mission. */
  readonly currentWork?: CurrentWorkReadAdapter | null;
  /** Bounded liveness evidence used while reconciling current-work. */
  readonly isProcessAlive?: ProcessLivenessProbe;
  /** Running-session detection seam; defaults to the live process scan. */
  readonly detectRunningSessions?: () => readonly RunningMissionSession[] | null;
}

/**
 * Concrete `AgentReadAdapter` that reads agent availability and timed-block
 * countdown from the architecture migration operator-local SQLite snapshot (blocklist
 * repository), not by re-reading files ad hoc.
 */
export class ConcreteAgentReadAdapter implements AgentReadAdapter {
  private readonly rootDir: string;
  private readonly blocklistRepo: AgentBlocklistRepository;
  private readonly knownAgentFamilies: readonly AgentFamily[];
  private readonly readAgentConfig: () => AgentConfig | null;
  private readonly launcherAvailable: (_family: AgentFamily) => LauncherProbeResult;
  private readonly resolveTaskFile: ResolveTaskFileFn;
  private readonly getTaskAssignee: GetTaskAssigneeFn;
  private readonly sessionMarkers: SessionMarkerRepository | null;
  private readonly currentWork: CurrentWorkReadAdapter | null;
  private readonly isProcessAlive: ProcessLivenessProbe | undefined;
  private readonly detectRunningSessions: () => readonly RunningMissionSession[] | null;

  constructor(options: ConcreteAgentReadAdapterOptions) {
    this.rootDir = options.rootDir;
    this.blocklistRepo = options.blocklistRepo;
    this.knownAgentFamilies = options.knownAgentFamilies;
    this.readAgentConfig = options.readAgentConfig ?? (() => readAgentConfig());
    this.launcherAvailable = options.launcherAvailable ?? (() => ({ available: true, detail: null }));
    this.resolveTaskFile = options.resolveTaskFile ?? defaultResolveTaskFile();
    this.getTaskAssignee = options.getTaskAssignee ?? defaultGetTaskAssignee();
    this.sessionMarkers = options.sessionMarkers ?? null;
    this.currentWork = options.currentWork ?? null;
    this.isProcessAlive = options.isProcessAlive;
    this.detectRunningSessions = options.detectRunningSessions
      ?? (() => detectRunningMissionSessions({ rootDir: options.rootDir }));
  }

  // -----------------------------------------------------------------------
  // AgentReadAdapter port
  // -----------------------------------------------------------------------

  async loadAgentAvailability(): Promise<readonly AgentAvailability[]> {
    const nowMs = Date.now();
    const states = await new AgentBlockService(this.blocklistRepo).queryAll(this.knownAgentFamilies, nowMs);
    const stateByAgent = new Map(states.map((state) => [state.agent.toLowerCase(), state]));
    const config = this.readAgentConfig();
    const availability: AgentAvailability[] = this.knownAgentFamilies.map((family) => {
      const runtimeState = stateByAgent.get(family.toLowerCase());
      const state = runtimeState && resolveAgentBlockAuthority(family, runtimeState, config, nowMs);
      const block: AgentBlock = state?.blocked
        ? (state.until
          ? { kind: 'until', untilMs: parseAgentBlockUntil(state.until), reason: state.reason }
          : { kind: 'indefinite', reason: state?.reason ?? null })
        : { kind: 'none' };
      const launcher = this.launcherAvailable(family);
      return {
        family,
        launcherAvailable: launcher.available,
        launcherDetail: launcher.detail,
        block,
      };
    });

    return availability;
  }

  /**
   * Missions with a live agent-launching `px` process, attributed to the family
   * running them.
   *
   * Attribution uses only evidence about *this* process:
   *
   *  1. reconciled current work for the mission, when it names a family;
   *  2. a session marker for that (mission, role) written after the process
   *     started — proof that this run launched that family. A marker older
   *     than the process describes a previous run and is ignored, because the
   *     launcher writes the marker after a launch exits, so the stored family
   *     lags by one launch and can name a family that already fell back;
   *  3. otherwise the family pinned on the command line
   *     (`--agent`/`--implementer`/`--reviewer`), which is what a fresh
   *     `px draft <slug> --agent <family>` has before any marker exists.
   *
   * The mission assignee is deliberately not used as a fallback: it says who
   * owns the mission, not who is running.
   *
   * Returns `null` when liveness cannot be determined, so the board renders
   * unknown rather than a fabricated zero.
   */
  async loadRunningSessions(): Promise<readonly RunningAgentSession[] | null> {
    const running = this.detectRunningSessions();
    if (running === null) { return null; }
    if (running.length === 0) { return []; }

    const currentWork = this.currentWork
      ? reconcileCurrentWork(await this.currentWork.loadCurrentWork(), {
        nowMs: Date.now(),
        ttlMs: CURRENT_WORK_TTL_MS,
        isProcessAlive: this.isProcessAlive,
      })
      : new Map();
    const markers = this.sessionMarkers ? await this.sessionMarkers.findAll() : [];
    const byMissionRole = new Map(markers.map((marker) => [`${marker.missionId}:${marker.role}`, marker]));
    return running.map((session) => {
      const marker = session.role === null
        ? undefined
        : byMissionRole.get(`${session.missionId}:${session.role}`);
      const launchedInThisProcess = marker !== undefined
        && Date.parse(marker.lastLaunched) >= session.startedAtMs;
      const work = currentWork.get(session.missionId)?.currentWork;
      return {
        missionId: session.missionId,
        family: (isWorkInProgress(work) ? parseAgentFamily(work.agent) : null)
          ?? (launchedInThisProcess ? marker.agent : null)
          ?? parseAgentFamily(session.pinnedAgent),
      };
    });
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
