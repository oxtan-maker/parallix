/**
 * Mission creation: the application use case behind "Create new mission".
 *
 * It owns what an interface must not decide for itself: the new mission's
 * identity, which missions may be named as dependencies, and what a repeated
 * request means. Persistence is the existing intake write, so the mission,
 * its planning fields and its entry lane event commit as one unit and a
 * creation is never observable half-written. The result is a backlog Mission
 * only; nothing here drafts, launches an agent or creates a worktree.
 */

import type { ApplicationOutcome, Capability } from './contracts.js';
import { completed, failure, rejected } from './contracts.js';
import type { MissionTransitionStore } from './domain-ports.js';
import type { MissionIntakeResult, MissionIntakeService } from './mission-intake-service.js';
import { missionBrief, type MissionBrief } from '../domain/mission-brief.js';
import { missionDependencies } from '../domain/mission-dependencies.js';
import { successCriteria } from '../domain/mission-success-criteria.js';
import { missionId, missionLabels, type Mission, type MissionId } from '../domain/mission.js';
import type { RepositoryId } from '../domain/repository.js';

const REQUIRED_CAPABILITY: Capability = 'mission:intake';
const TITLE_LIMIT = 200;
const LABEL_LIMIT = 64;
const MAX_LABELS = 16;
const REMEMBERED_REQUESTS = 256;
/** Owner stand-in for dependency validation before the identity exists. */
const UNALLOCATED_OWNER = missionId('unallocated-mission.0');

/** Mints the next repository-scoped Mission identity. */
export interface MissionIdentityAllocator {
  allocate(_repositoryId: RepositoryId): MissionId;
}

/** Every Mission the repository's board shows, finished or not. */
export interface MissionCatalog {
  loadAllMissions(): Promise<readonly Mission[]>;
}

export interface MissionCreationRequest {
  readonly operationId: string;
  /**
   * Chosen by the caller once per form. Repeating it returns the first
   * outcome instead of creating a second mission, so a retry after a lost
   * response cannot duplicate a persisted mission.
   */
  readonly requestKey: string;
  readonly title: string;
  readonly description?: string;
  readonly context?: string;
  readonly labels?: readonly string[];
  readonly successCriteria?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly capabilities: ReadonlySet<Capability>;
}

export class MissionCreationService {
  private readonly remembered = new Map<string, Promise<ApplicationOutcome<MissionIntakeResult>>>();

  constructor(
    private readonly _intake: Pick<MissionIntakeService, 'execute'>,
    private readonly _catalog: MissionCatalog,
    private readonly _identities: MissionIdentityAllocator,
    private readonly _repositoryId: RepositoryId,
    /** Recovers a persisted creation once the in-memory memory of it is gone. */
    private readonly _store?: Pick<MissionTransitionStore, 'load' | 'findMissionByIdempotencyKey'>,
  ) {}

  async execute(request: MissionCreationRequest): Promise<ApplicationOutcome<MissionIntakeResult>> {
    if (!request.operationId.trim() || !request.requestKey.trim()) {
      return rejected('validation', 'operationId and requestKey are required');
    }
    if (!request.capabilities.has(REQUIRED_CAPABILITY)) {
      return rejected('capability', `${REQUIRED_CAPABILITY} capability is required`);
    }
    const prior = this.remembered.get(request.requestKey);
    if (prior) { return prior; }
    const attempt = this.create(request);
    this.remember(request.requestKey, attempt);
    const outcome = await attempt;
    // Only a persisted mission is worth remembering: a rejected or failed
    // attempt wrote nothing, so the same key must be free to try again.
    if (outcome.status !== 'completed') { this.remembered.delete(request.requestKey); }
    return outcome;
  }

  private remember(key: string, attempt: Promise<ApplicationOutcome<MissionIntakeResult>>): void {
    this.remembered.set(key, attempt);
    if (this.remembered.size > REMEMBERED_REQUESTS) {
      const oldest = this.remembered.keys().next().value;
      if (oldest !== undefined) { this.remembered.delete(oldest); }
    }
  }

  private async create(request: MissionCreationRequest): Promise<ApplicationOutcome<MissionIntakeResult>> {
    const persisted = await this.recoverPersisted(request.requestKey);
    if (persisted) { return persisted; }
    let fields: ValidFields;
    try {
      fields = validate(request);
    } catch (error) {
      return rejected('validation', error instanceof Error ? error.message : 'invalid mission');
    }
    const refused = await this.refuseIneligibleDependencies(fields.dependencies);
    if (refused) { return refused; }
    let id: MissionId;
    try {
      id = this._identities.allocate(this._repositoryId);
    } catch (error) {
      return failure('unavailable', `could not allocate a mission identity: ${error instanceof Error ? error.message : String(error)}`);
    }
    const outcome = await this._intake.execute({
      operationId: request.operationId,
      missionId: id,
      repositoryId: this._repositoryId,
      title: fields.title,
      labels: fields.labels,
      brief: fields.brief,
      description: fields.description,
      successCriteria: fields.successCriteria,
      dependencies: fields.dependencies,
      idempotencyKey: creationKey(request.requestKey),
      capabilities: request.capabilities,
    });
    return outcome;
  }

  /**
   * The mission this request key already created, read back from its durable
   * entry event. Memory of a request is bounded; the event is not, so a retry
   * of an old request still returns the mission instead of a conflict.
   */
  private async recoverPersisted(requestKey: string): Promise<ApplicationOutcome<MissionIntakeResult> | null> {
    if (!this._store?.findMissionByIdempotencyKey) { return null; }
    try {
      const id = await this._store.findMissionByIdempotencyKey(this._repositoryId, creationKey(requestKey));
      if (id === null) { return null; }
      const read = await this._store.load(id);
      return read.kind === 'found' && read.mission.repositoryId === this._repositoryId ? completed({ mission: read.mission, version: read.version }) : null;
    } catch (error) {
      return failure('unavailable', `could not check for an earlier creation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** A dependency is an unfinished Mission of this repository, as the board shows it. */
  private async refuseIneligibleDependencies(dependencies: readonly MissionId[]): Promise<ApplicationOutcome<MissionIntakeResult> | null> {
    if (dependencies.length === 0) { return null; }
    let known: readonly Mission[];
    try {
      known = await this._catalog.loadAllMissions();
    } catch (error) {
      return failure('unavailable', `could not read the repository's missions: ${error instanceof Error ? error.message : String(error)}`);
    }
    const byId = new Map(known.filter((mission) => mission.repositoryId === this._repositoryId).map((mission) => [mission.id, mission]));
    for (const dependency of dependencies) {
      const mission = byId.get(dependency);
      if (!mission) { return rejected('validation', `dependency ${dependency} is not a mission in this repository`); }
      if (mission.status === 'done' || mission.closedAt !== null) {
        return rejected('validation', `dependency ${dependency} is already finished and cannot be depended on`);
      }
    }
    return null;
  }
}

/**
 * A brief needs goal and why. Without a stated why the text stays a
 * description and the refining agent derives the brief from it.
 */
function describe(description: string, context: string): Pick<ValidFields, 'brief' | 'description'> {
  if (!description) { return {}; }
  return context
    ? { brief: missionBrief({ goal: description, why: context, scope: null, outOfScope: [] }) }
    : { description };
}

function creationKey(requestKey: string): string { return `mission-create-${requestKey}`; }

interface ValidFields {
  readonly title: string;
  readonly labels: ReturnType<typeof missionLabels>;
  readonly brief?: MissionBrief;
  readonly description?: string;
  readonly successCriteria: readonly string[];
  readonly dependencies: readonly MissionId[];
}

function validate(request: MissionCreationRequest): ValidFields {
  const title = request.title.trim();
  if (!title) { throw new Error('Title is required.'); }
  if (title.length > TITLE_LIMIT) { throw new Error(`Title must be at most ${TITLE_LIMIT} characters.`); }
  const labels = missionLabels(request.labels ?? []);
  if (labels.length > MAX_LABELS) { throw new Error(`Use at most ${MAX_LABELS} labels.`); }
  const longLabel = labels.find((label) => label.length > LABEL_LIMIT);
  if (longLabel) { throw new Error(`Label "${longLabel}" is longer than ${LABEL_LIMIT} characters.`); }
  const description = request.description?.trim() ?? '';
  const context = request.context?.trim() ?? '';
  if (context && !description) { throw new Error('Add a description or clear the context.'); }
  return {
    title,
    labels,
    ...describe(description, context),
    successCriteria: successCriteria((request.successCriteria ?? []).map((criterion) => criterion.trim()).filter(Boolean)),
    dependencies: missionDependencies(request.dependencies ?? [], UNALLOCATED_OWNER),
  };
}
