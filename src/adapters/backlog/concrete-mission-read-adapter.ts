import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Mission, MissionId, MissionLabel, MissionStatus } from '../../domain/mission.js';
import { agentFamily, type AgentFamily } from '../../domain/agents.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { SourceFact } from '../../application/contracts.js';
import type { MissionReadAdapter } from '../../application/projections/board-readers.js';
import { getFirstLine, findCheckpoints, findMissionDir, resolveWorktree } from '../../platform/runtime/lib/core/mission-utils.js';
import { getTaskAssignee, getTaskFrontmatterValue, getTaskLabels, getTaskStatus, getTaskStorage, resolveTaskFile } from '../../platform/runtime/lib/tools/backlog.js';
import {
  materializeBacklogMission,
  missionStatusFromBacklog,
  type BacklogMissionRecord,
  type BacklogMissionSnapshot,
  type IntegrationBaseRead,
  type MissionWorktreeRead,
} from './mission-materialization.js';

// ---------------------------------------------------------------------------
// Parse-primitive types (kept sync with backlog.ts / paths.ts signatures)
// ---------------------------------------------------------------------------

type ResolveTaskFileFn = (_slug: string, _rootDir?: string) => { ok: boolean; taskFile?: string; matches: string[]; reason?: string };
type GetTaskStatusFn = (_taskFilePath: string) => string | null;
type GetTaskAssigneeFn = (_taskFilePath: string) => string | null;
type GetTaskFrontmatterValueFn = (_taskFilePath: string, _field: string) => string | null;
type GetTaskLabelsFn = (_taskFilePath: string) => string[];
type GetTaskStorageFn = (_rootDir?: string) => { tasksDir: string; completedDir: string; archiveTasksDir: string };
type FindMissionDirFn = (_slug: string, _rootDir?: string, _options?: { missionPath?: string }) => string | null;
type FindCheckpointsFn = (_missionDir: string) => string[];
type ResolveWorktreeFn = (_slug: string, _options?: { cwd?: string; gitFn?: Function | null }) => string | null;
type GetFirstLineFn = (_filePath: string) => string;

// ---------------------------------------------------------------------------
// Defaults — use static imports (no circular deps with backlog/mission-utils)
// ---------------------------------------------------------------------------

function defaultResolveTaskFile(): ResolveTaskFileFn {
  return resolveTaskFile as ResolveTaskFileFn;
}

function defaultGetTaskStatus(): GetTaskStatusFn {
  return getTaskStatus as GetTaskStatusFn;
}

function defaultGetTaskAssignee(): GetTaskAssigneeFn {
  return getTaskAssignee as GetTaskAssigneeFn;
}

function defaultGetTaskFrontmatterValue(): GetTaskFrontmatterValueFn {
  return getTaskFrontmatterValue as GetTaskFrontmatterValueFn;
}

function defaultGetTaskLabels(): GetTaskLabelsFn {
  return getTaskLabels as GetTaskLabelsFn;
}

function defaultGetTaskStorage(): GetTaskStorageFn {
  return getTaskStorage as GetTaskStorageFn;
}

function defaultFindMissionDir(): FindMissionDirFn {
  return findMissionDir as FindMissionDirFn;
}

function defaultFindCheckpoints(): FindCheckpointsFn {
  return findCheckpoints as FindCheckpointsFn;
}

function defaultResolveWorktree(): ResolveWorktreeFn {
  return resolveWorktree as ResolveWorktreeFn;
}

function defaultGetFirstLine(): GetFirstLineFn {
  return getFirstLine as GetFirstLineFn;
}

// ---------------------------------------------------------------------------
// Concrete MissionReadAdapter
// ---------------------------------------------------------------------------

export interface ConcreteMissionReadAdapterOptions {
  readonly rootDir: string;
  readonly repositoryId: RepositoryId;
  /** Resolve task file path for a slug. */
  readonly resolveTaskFile?: ResolveTaskFileFn;
  /** Read status from a task file. */
  readonly getTaskStatus?: GetTaskStatusFn;
  /** Read assignee from a task file. */
  readonly getTaskAssignee?: GetTaskAssigneeFn;
  /** Read an arbitrary frontmatter value. */
  readonly getTaskFrontmatterValue?: GetTaskFrontmatterValueFn;
  /** Read labels from a task file. */
  readonly getTaskLabels?: GetTaskLabelsFn;
  /** Get backlog directory paths. */
  readonly getTaskStorage?: GetTaskStorageFn;
  /** Find mission directory for a slug. */
  readonly findMissionDir?: FindMissionDirFn;
  /** Find checkpoint files in a mission directory. */
  readonly findCheckpoints?: FindCheckpointsFn;
  /** Resolve mission worktree path. */
  readonly resolveWorktree?: ResolveWorktreeFn;
  /** Get first line of a file (strips markdown heading markers). */
  readonly getFirstLine?: GetFirstLineFn;
}

/**
 * Concrete `MissionReadAdapter` that reads from the live backlog Markdown
 * files and mission worktrees, then materialises domain `Mission` objects
 * through `materializeBacklogMission()`.
 *
 * This is the single materialization path: every domain `Mission` on the board
 * comes from this adapter (or a test double implementing the same port).
 */
export class ConcreteMissionReadAdapter implements MissionReadAdapter {
  private readonly rootDir: string;
  private readonly repositoryId: RepositoryId;
  private readonly resolveTaskFile: ResolveTaskFileFn;
  private readonly getTaskStatus: GetTaskStatusFn;
  private readonly getTaskAssignee: GetTaskAssigneeFn;
  private readonly getTaskFrontmatterValue: GetTaskFrontmatterValueFn;
  private readonly getTaskLabels: GetTaskLabelsFn;
  private readonly getTaskStorage: GetTaskStorageFn;
  private readonly findMissionDir: FindMissionDirFn;
  private readonly findCheckpoints: FindCheckpointsFn;
  private readonly resolveWorktree: ResolveWorktreeFn;
  private readonly getFirstLine: GetFirstLineFn;

  /** Cached source facts from the last loadAllMissions call. */
  private _sourceFacts: SourceFact<string>[] = [];

  constructor(options: ConcreteMissionReadAdapterOptions) {
    this.rootDir = options.rootDir;
    this.repositoryId = options.repositoryId;
    this.resolveTaskFile = options.resolveTaskFile ?? defaultResolveTaskFile();
    this.getTaskStatus = options.getTaskStatus ?? defaultGetTaskStatus();
    this.getTaskAssignee = options.getTaskAssignee ?? defaultGetTaskAssignee();
    this.getTaskFrontmatterValue = options.getTaskFrontmatterValue ?? defaultGetTaskFrontmatterValue();
    this.getTaskLabels = options.getTaskLabels ?? defaultGetTaskLabels();
    this.getTaskStorage = options.getTaskStorage ?? defaultGetTaskStorage();
    this.findMissionDir = options.findMissionDir ?? defaultFindMissionDir();
    this.findCheckpoints = options.findCheckpoints ?? defaultFindCheckpoints();
    this.resolveWorktree = options.resolveWorktree ?? defaultResolveWorktree();
    this.getFirstLine = options.getFirstLine ?? defaultGetFirstLine();
  }

  // -----------------------------------------------------------------------
  // MissionReadAdapter port
  // -----------------------------------------------------------------------

  async loadAllMissions(): Promise<readonly Mission[]> {
    const { tasksDir, completedDir, archiveTasksDir } = this.getTaskStorage(this.rootDir);
    const storeDirs = [
      { dir: tasksDir, priority: 0 },
      { dir: completedDir, priority: 1 },
      { dir: archiveTasksDir, priority: 2 },
    ];

    // Scan all task files, keyed by frontmatter id for dedup
    const taskMap = new Map<string, { taskFile: string; storeDir: string; priority: number }>();
    for (const { dir, priority } of storeDirs) {
      const files = this.readMdFiles(dir);
      for (const file of files) {
        const id = this.extractTaskId(file);
        if (!id) {
          continue;
        }
        const normalized = id.toLowerCase();
        const existing = taskMap.get(normalized);
        // Prefer lower priority number (tasks > completed > archive)
        if (!existing || priority < existing.priority) {
          taskMap.set(normalized, { taskFile: file, storeDir: dir, priority });
        }
      }
    }

    const missions: Mission[] = [];
    const facts: SourceFact<string>[] = [];

    for (const [normalizedId, { taskFile }] of taskMap) {
      const result = this.materializeOne(taskFile, normalizedId);
      if (result.kind === 'found') {
        missions.push(result.mission);
        facts.push({
          source: 'task-markdown',
          status: 'fresh',
          value: taskFile,
        });
      } else {
        facts.push({
          source: 'task-markdown',
          status: 'unavailable',
          value: result.reason,
        });
      }
    }

    missions.sort((a, b) => a.id.localeCompare(b.id));
    this._sourceFacts = facts;
    return missions;
  }

  async loadMission(id: MissionId): Promise<Mission | null> {
    const result = this.resolveTaskFile(id, this.rootDir);
    if (!result.ok || !result.taskFile) {
      return null;
    }

    const normalizedId = id.toLowerCase();
    const materialized = this.materializeOne(result.taskFile, normalizedId);
    if (materialized.kind !== 'found') {
      return null;
    }
    return materialized.mission;
  }

  getSourceFacts(): readonly SourceFact<string>[] {
    return this._sourceFacts;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Read all .md files from a directory. Returns empty array if dir missing. */
  private readMdFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs.readdirSync(dir)
      .filter((f: string) => f.endsWith('.md'))
      .map((f: string) => path.join(dir, f));
  }

  /** Extract task id from frontmatter, falling back to filename prefix. */
  private extractTaskId(taskFile: string): string | null {
    // Try frontmatter first
    const id = this.getTaskFrontmatterValue(taskFile, 'id');
    if (id) {
      return id;
    }

    // Fallback: filename prefix (task-NNN or task-NNN.suffix)
    const basename = path.basename(taskFile, '.md');
    const match = basename.match(/^(task-\d+(?:\.\d+)?)/i);
    return match ? match[1].toUpperCase() : null;
  }

  /** Determine if the task file lives in the completed or archive store. */
  private isInCompletedStore(taskFile: string): boolean {
    const { completedDir, archiveTasksDir } = this.getTaskStorage(this.rootDir);
    return taskFile.startsWith(completedDir + path.sep)
      || taskFile.startsWith(archiveTasksDir + path.sep);
  }

  /** Build a BacklogMissionRecord from a task file. */
  private buildRecord(taskFile: string, _missionDir: string | null, id: MissionId): BacklogMissionRecord {
    const rawStatus = this.getTaskStatus(taskFile) || '';
    const status = missionStatusFromBacklog(rawStatus) || 'backlog';

    const rawAssignee = this.getTaskAssignee(taskFile);
    const assignee: AgentFamily | null = rawAssignee
      ? (() => { try { return agentFamily(rawAssignee); } catch { return null; } })()
      : null;

    const title = this.getTaskFrontmatterValue(taskFile, 'title')
      || this.getTaskFrontmatterValue(taskFile, 'Title')
      || path.basename(taskFile, '.md');

    const rawLabels = this.getTaskLabels(taskFile);
    const labels: MissionLabel[] = rawLabels.map((l: string) => l as MissionLabel);

    const checkpoints = _missionDir
      ? this.findCheckpoints(_missionDir).map((cp) => {
          const rawFilename = path.basename(cp);
          // Use getFirstLine primitive for legacy output contract (strips markdown heading markers)
          let firstLine = '';
          try {
            firstLine = this.getFirstLine(cp);
          } catch {
            firstLine = '';
          }
          return {
            missionId: id,
            name: path.basename(cp, '.md'),
            rawFilename,
            firstLine,
            goalCheck: [],
            nextActionText: '',
          };
        })
      : [];

    return {
      id,
      repositoryId: this.repositoryId,
      title,
      labels,
      assignee,
      checkpoints,
      review: null, // populated by ReviewReadAdapter
      netEngineeringLines: null,
      status: status as MissionStatus,
      rawStatus,
    };
  }

  /** Build MissionWorktreeRead for a slug. */
  private buildWorktreeRead(slug: string): MissionWorktreeRead {
    const worktreePath = this.resolveWorktree(slug, { cwd: this.rootDir });
    if (!worktreePath) {
      return { kind: 'absent' };
    }

    // Try to resolve the task file inside the worktree
    const result = this.resolveTaskFile(slug, worktreePath);
    if (result.ok && result.taskFile) {
      const record = this.buildRecord(result.taskFile, null, slug as MissionId);
      return { kind: 'found', mission: record };
    }

    return { kind: 'absent' };
  }

  /** Build IntegrationBaseRead from the canonical task file. */
  private buildIntegrationBaseRead(taskFile: string, slug: string): IntegrationBaseRead {
    try {
      const missionDir = this.findMissionDir(slug, this.rootDir);
      const record = this.buildRecord(taskFile, missionDir, slug as MissionId);
      const completionRecorded = this.isInCompletedStore(taskFile);
      return { kind: 'found', mission: record, completionRecorded };
    } catch {
      return { kind: 'missing' };
    }
  }

  /** Full materialize pipeline for one task file. */
  private materializeOne(taskFile: string, slug: string) {
    const integrationBase = this.buildIntegrationBaseRead(taskFile, slug);
    const missionWorktree = this.buildWorktreeRead(slug);

    // closedAt: only relevant for completed (done) tasks.
    // Use frontmatter "closedAt" or fall back to a synthetic value for completed tasks.
    const rawClosedAt = this.getTaskFrontmatterValue(taskFile, 'closedAt');

    const snapshot: BacklogMissionSnapshot = {
      integrationBase,
      missionWorktree,
      closedAt: rawClosedAt || null,
    };

    return materializeBacklogMission(snapshot);
  }
}
