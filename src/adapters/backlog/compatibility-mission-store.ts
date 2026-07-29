/**
 * The selected compatibility Mission authority.
 *
 * Until the TASK-2322.07 cutover, Parallix's durable Mission state lives where
 * it already lives: the Backlog task Markdown file (lifecycle, assignee, title,
 * labels), the mission directory's `CP-N.md` documents (checkpoint evidence),
 * and `nel-record.json` (change size). This adapter is the *only* place that
 * knows those locations; the application use cases see a `MissionStore`.
 *
 * Authority rules this adapter keeps (ADR 0053, "Cutover"):
 *  - It never reads or writes SQLite. There is no fallback, read-through, or
 *    reconciliation between this store and the SQLite adapter.
 *  - It refuses inserts. Creating the compatibility task record stays with the
 *    existing `px draft` command, so intake cannot become a second task writer.
 *  - A write requires the exact revision the caller read; the revision is the
 *    observed modification stamp of the documents that back the aggregate, which
 *    makes a concurrent agent edit a refused conflict rather than a silent
 *    overwrite.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  MissionLoadResult,
  MissionNelRecordReceipt,
  MissionNelRecorder,
  MissionTransitionStore,
  MissionVersion,
} from '../../application/domain-ports.js';
import { missionVersion, MissionStaleVersion } from '../../application/domain-ports.js';
import type { LaneTransitionEvent } from '../../domain/board-event.js';
import type { CheckpointData } from '../../domain/checkpoint.js';
import { externalTaskRef } from '../../domain/external-task.js';
import type { Mission, MissionId, MissionStatus } from '../../domain/mission.js';
import type { MissionNelRecord } from '../../domain/net-engineering-lines.js';
import type { RepositoryId } from '../../domain/repository.js';
import { getTaskFrontmatterValue, resolveTaskFile, transitionTask } from '../../platform/runtime/lib/tools/backlog.js';
import { findCheckpoints, findMissionDir } from '../../platform/runtime/lib/core/mission-utils.js';
import { writeFileAtomic, writeJson } from '../../platform/runtime/lib/core/storage.js';
import { ConcreteMissionReadAdapter } from './concrete-mission-read-adapter.js';
import { parseCheckpointDocument, renderCheckpointDocument } from './checkpoint-document.js';

/** The compatibility document names this adapter owns. */
export const NEL_RECORD_FILENAME = 'nel-record.json';

/**
 * Persisted vocabulary written for each domain status.
 *
 * `integration` is written as `ready-for-integration`, the spelling the existing
 * state map treats as the persisted form of the virtual `approved` state.
 */
const PERSISTED_STATUS: Readonly<Record<MissionStatus, string>> = {
  backlog: 'backlog',
  refined: 'refined',
  active: 'active',
  review: 'review',
  integration: 'ready-for-integration',
  done: 'done',
};

type ResolveTaskFileFn = (_slug: string, _rootDir?: string) => {
  ok: boolean;
  taskFile?: string;
  matches: string[];
  reason?: string;
};
type TransitionTaskFn = (
  _slug: string,
  _newStatus: string,
  _options: { implementer?: string | null; rootDir?: string; log?: (_message: string) => void },
) => Promise<boolean>;

export interface CompatibilityMissionStoreOptions {
  readonly rootDir: string;
  readonly repositoryId: RepositoryId;
  /** Read side; defaults to the single Backlog materialization adapter. */
  readonly reader?: { loadMission(_id: MissionId): Promise<Mission | null> };
  readonly resolveTaskFile?: ResolveTaskFileFn;
  readonly transitionTask?: TransitionTaskFn;
  readonly getTaskFrontmatterValue?: (_taskFile: string, _field: string) => string | null;
  readonly findMissionDir?: (_slug: string, _rootDir?: string) => string | null;
  readonly findCheckpoints?: (_missionDir: string) => string[];
  readonly readText?: (_filePath: string) => string;
  readonly writeText?: (_filePath: string, _content: string) => void;
  readonly writeDocumentJson?: (_filePath: string, _data: unknown) => void;
  readonly stampOf?: (_filePath: string) => number;
  readonly log?: (_message: string) => void;
}

export class CompatibilityMissionStore implements MissionTransitionStore, MissionNelRecorder {
  private readonly rootDir: string;
  private readonly repositoryId: RepositoryId;
  private readonly reader: { loadMission(_id: MissionId): Promise<Mission | null> };
  private readonly resolveTask: ResolveTaskFileFn;
  private readonly transition: TransitionTaskFn;
  private readonly frontmatter: (_taskFile: string, _field: string) => string | null;
  private readonly missionDirOf: (_slug: string, _rootDir?: string) => string | null;
  private readonly checkpointsOf: (_missionDir: string) => string[];
  private readonly readText: (_filePath: string) => string;
  private readonly writeText: (_filePath: string, _content: string) => void;
  private readonly writeJsonDocument: (_filePath: string, _data: unknown) => void;
  private readonly stampOf: (_filePath: string) => number;
  private readonly log: (_message: string) => void;

  constructor(options: CompatibilityMissionStoreOptions) {
    this.rootDir = options.rootDir;
    this.repositoryId = options.repositoryId;
    this.reader = options.reader
      ?? new ConcreteMissionReadAdapter({ rootDir: options.rootDir, repositoryId: options.repositoryId });
    this.resolveTask = options.resolveTaskFile ?? (resolveTaskFile as ResolveTaskFileFn);
    this.transition = options.transitionTask ?? (transitionTask as unknown as TransitionTaskFn);
    this.frontmatter = options.getTaskFrontmatterValue
      ?? (getTaskFrontmatterValue as (_taskFile: string, _field: string) => string | null);
    this.missionDirOf = options.findMissionDir
      ?? (findMissionDir as (_slug: string, _rootDir?: string) => string | null);
    this.checkpointsOf = options.findCheckpoints ?? findCheckpoints;
    this.readText = options.readText ?? ((filePath) => fs.readFileSync(filePath, 'utf8'));
    this.writeText = options.writeText ?? ((filePath, content) => writeFileAtomic(filePath, content));
    this.writeJsonDocument = options.writeDocumentJson
      ?? ((filePath, data) => { writeJson(filePath, data); });
    this.stampOf = options.stampOf ?? defaultStamp;
    this.log = options.log ?? (() => {});
  }

  // -----------------------------------------------------------------------
  // MissionStore
  // -----------------------------------------------------------------------

  async load(id: MissionId): Promise<MissionLoadResult> {
    const taskFile = this.taskFileFor(id);
    if (taskFile === null) {
      return { kind: 'missing' };
    }

    let mission: Mission | null;
    try {
      mission = await this.reader.loadMission(id);
    } catch (error) {
      return {
        kind: 'unavailable',
        reason: error instanceof Error && error.message
          ? error.message
          : `mission ${id} could not be materialized`,
      };
    }
    if (mission === null) {
      return { kind: 'unavailable', reason: `mission ${id} could not be materialized` };
    }

    return {
      kind: 'found',
      mission: {
        ...mission,
        checkpoints: this.readCheckpoints(id),
        netEngineeringLines: this.readRecordedNel(id),
        ...this.readExternalTaskRef(id, taskFile),
      } as Mission,
      version: this.revisionOf(id, taskFile),
    };
  }

  async save(mission: Mission, expectedVersion: MissionVersion | null): Promise<MissionVersion> {
    const taskFile = this.taskFileFor(mission.id);
    if (expectedVersion === null) {
      throw new Error(
        `Compatibility Mission authority does not create task records: run the draft command for ${mission.id}`,
      );
    }
    if (taskFile === null) {
      throw new MissionStaleVersion(mission.id, expectedVersion, null);
    }
    const current = this.revisionOf(mission.id, taskFile);
    if (current !== expectedVersion) {
      throw new MissionStaleVersion(mission.id, expectedVersion, current);
    }

    const previous = await this.load(mission.id);
    const before = previous.kind === 'found' ? previous.mission : null;

    // Lifecycle first: the task record is the compatibility authority, and the
    // existing transition path owns its integration-branch and rebase behavior.
    if (before === null || before.status !== mission.status) {
      const persisted = PERSISTED_STATUS[mission.status];
      const accepted = await this.transition(mission.id, persisted, {
        implementer: mission.assignee,
        rootDir: this.rootDir,
        log: this.log,
      });
      if (!accepted) {
        throw new Error(`compatibility task lifecycle synchronization failed for ${mission.id}`);
      }
    }

    this.writeCheckpoints(mission);
    if (
      mission.netEngineeringLines !== null
      && (before === null || before.netEngineeringLines !== mission.netEngineeringLines)
    ) {
      this.mergeNelDocument(mission.id, { actualNel: mission.netEngineeringLines });
    }

    const taskFileAfter = this.taskFileFor(mission.id) ?? taskFile;
    return this.revisionOf(mission.id, taskFileAfter);
  }

  /**
   * The compatibility authority has no transactional log table, so the lane
   * event is not persisted here; the Mission write is still the single
   * authoritative effect. Returning the new revision keeps the port contract
   * identical for both stores, and the SQLite adapter — which does own an event
   * table — commits both in one transaction.
   */
  async saveWithTransition(
    mission: Mission,
    expectedVersion: MissionVersion,
    event: LaneTransitionEvent,
  ): Promise<MissionVersion> {
    if (event.missionId !== mission.id || event.repositoryId !== mission.repositoryId) {
      throw new Error('LaneTransitionEvent does not identify the Mission being saved');
    }
    return this.save(mission, expectedVersion);
  }

  // -----------------------------------------------------------------------
  // MissionNelRecorder
  // -----------------------------------------------------------------------

  /**
   * Write the structured NEL report as the existing per-mission JSON document.
   *
   * Only references and scalars are written: an artifact locator is recorded as
   * a path or range, never as an inlined payload.
   */
  async recordNel(record: MissionNelRecord): Promise<MissionNelRecordReceipt> {
    const reference = this.mergeNelDocument(record.missionId, {
      predictedBucket: record.predictedBucket,
      actualNel: record.netEngineeringLines,
      actualBucket: record.actualBucket,
      reviewRounds: record.reviewRounds,
      capturedAt: record.capturedAt,
      ...(record.artifacts.length === 0
        ? {}
        : {
          artifacts: record.artifacts.map((artifact) => ({
            kind: artifact.kind,
            location: artifact.location,
            byteSize: artifact.byteSize,
          })),
        }),
    });
    return { reference, authority: 'compatibility' };
  }

  // -----------------------------------------------------------------------
  // Compatibility document access
  // -----------------------------------------------------------------------

  private taskFileFor(id: MissionId): string | null {
    const resolution = this.resolveTask(id, this.rootDir);
    return resolution.ok && resolution.taskFile ? resolution.taskFile : null;
  }

  private missionDirFor(id: MissionId): string | null {
    return this.missionDirOf(id, this.rootDir);
  }

  private readCheckpoints(id: MissionId): readonly CheckpointData[] {
    const missionDir = this.missionDirFor(id);
    if (missionDir === null) {
      return [];
    }
    const documents: CheckpointData[] = [];
    for (const file of this.safeCheckpointList(missionDir)) {
      try {
        documents.push(parseCheckpointDocument(id, path.basename(file), this.readText(file)));
      } catch {
        // A legacy `CHECKPOINT_*.md` name or unreadable document is not
        // checkpoint evidence this boundary can vouch for; the board keeps
        // showing it through the read projection.
      }
    }
    return documents;
  }

  private safeCheckpointList(missionDir: string): string[] {
    try {
      return this.checkpointsOf(missionDir);
    } catch {
      return [];
    }
  }

  private writeCheckpoints(mission: Mission): void {
    if (mission.checkpoints.length === 0) {
      return;
    }
    const missionDir = this.missionDirFor(mission.id);
    if (missionDir === null) {
      throw new Error(`mission directory not found for ${mission.id}`);
    }
    const existing = new Map(
      this.readCheckpoints(mission.id).map((checkpoint) => [checkpoint.name, checkpoint]),
    );
    for (const checkpoint of mission.checkpoints) {
      const current = existing.get(checkpoint.name);
      if (current && sameCheckpoint(current, checkpoint)) {
        continue;
      }
      this.writeText(
        path.join(missionDir, checkpoint.rawFilename ?? `${checkpoint.name}.md`),
        renderCheckpointDocument(checkpoint),
      );
    }
  }

  private nelDocumentPath(id: MissionId): string | null {
    const missionDir = this.missionDirFor(id);
    return missionDir === null ? null : path.join(missionDir, NEL_RECORD_FILENAME);
  }

  private readNelDocument(id: MissionId): Record<string, unknown> | null {
    const documentPath = this.nelDocumentPath(id);
    if (documentPath === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(this.readText(documentPath)) as unknown;
      return typeof parsed === 'object' && parsed !== null
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }

  private readRecordedNel(id: MissionId): number | null {
    const document = this.readNelDocument(id);
    const value = document?.actualNel;
    return Number.isInteger(value) ? value as number : null;
  }

  /**
   * One document, one writer. Merging keeps the legacy key order and lets the
   * Mission write record the number while the handoff report completes the rest.
   */
  private mergeNelDocument(id: MissionId, fields: Record<string, unknown>): string {
    const documentPath = this.nelDocumentPath(id);
    if (documentPath === null) {
      throw new Error(`mission directory not found for ${id}`);
    }
    const merged: Record<string, unknown> = {
      slug: id,
      ...(this.readNelDocument(id) ?? {}),
      ...fields,
    };
    this.writeJsonDocument(documentPath, orderNelDocument(merged));
    return documentPath;
  }

  /**
   * Intake traceability read back from the accepted material: the task
   * frontmatter id plus the document that carries it. It is a reference — the
   * task's own status and assignee are never read as a second lifecycle.
   */
  private readExternalTaskRef(id: MissionId, taskFile: string): { externalTaskRef?: ReturnType<typeof externalTaskRef> } {
    const frontmatterId = this.frontmatter(taskFile, 'id');
    if (!frontmatterId) {
      return {};
    }
    try {
      return {
        externalTaskRef: externalTaskRef(
          'backlog',
          frontmatterId,
          path.relative(this.rootDir, taskFile) || path.basename(taskFile),
        ),
      };
    } catch {
      void id;
      return {};
    }
  }

  /**
   * Revision token for optimistic concurrency.
   *
   * It is the newest modification stamp across the documents that back the
   * aggregate. A concurrent agent edit to the task file, a checkpoint, or the
   * NEL record therefore invalidates a caller's expected revision. Two writes
   * inside the same millisecond share a revision; that widens the undetected
   * window slightly but never manufactures a false conflict.
   */
  private revisionOf(
    id: MissionId,
    taskFile: string,
  ): MissionVersion {
    const missionDir = this.missionDirFor(id);
    const candidates = [taskFile];
    if (missionDir !== null) {
      candidates.push(...this.safeCheckpointList(missionDir));
      candidates.push(path.join(missionDir, NEL_RECORD_FILENAME));
    }
    return missionVersion(candidates.reduce(
      (highest, candidate) => Math.max(highest, this.stampOf(candidate)),
      1,
    ));
  }
}

/** The legacy `nel-record.json` key order, preserved for existing consumers. */
const NEL_DOCUMENT_KEY_ORDER = [
  'slug',
  'predictedBucket',
  'actualNel',
  'actualBucket',
  'reviewRounds',
  'capturedAt',
] as const;

function orderNelDocument(document: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of NEL_DOCUMENT_KEY_ORDER) {
    if (key in document) {
      ordered[key] = document[key];
    }
  }
  for (const [key, value] of Object.entries(document)) {
    if (!(key in ordered)) {
      ordered[key] = value;
    }
  }
  return ordered;
}

function defaultStamp(filePath: string): number {
  try {
    return Math.max(1, Math.floor(fs.statSync(filePath).mtimeMs));
  } catch {
    return 1;
  }
}

function sameCheckpoint(left: CheckpointData, right: CheckpointData): boolean {
  return left.nextActionText === right.nextActionText
    && left.goalCheck.length === right.goalCheck.length
    && left.goalCheck.every((row, index) =>
      row.criterion === right.goalCheck[index]?.criterion
      && row.evidence === right.goalCheck[index]?.evidence);
}
