import fs from 'node:fs';
import path from 'node:path';

import { isDeepStrictEqual } from 'node:util';
import type { Mission } from '../../domain/mission.js';
import { missionId } from '../../domain/mission.js';
import { compareCodeUnits } from '../../domain/comparators.js';

import { parseTaskFrontmatterValue } from './task-file-io.js';
import { parseCheckpointDocument, reconcileLegacyCheckpoint } from './checkpoint-document.js';
import { isLegacyMissionTemplate, parseLegacyMissionDocument } from './legacy-mission-document.js';
import { readLegacyTaskContent } from './legacy-task-content.js';
import { hasApprovedCheckpointException } from './legacy-mission-content.js';
import { classifyNelBucket } from '../../domain/net-engineering-lines.js';
import { readExportedReviewEvents } from '../review/review-state.js';
import { reviewStateDataFrom } from '../review/review-state-mapping.js';
import { stageLaunchWindowsFrom } from '../../domain/review.js';

import type { LegacyFileClass, LegacyFileFinding } from './legacy-mission-audit.js';
interface AuditFile { name: string; content: string; sha256: string; }
interface FileAssessment { classification: LegacyFileClass; reason: string; }
export interface LegacyAuditSources {
  rootDir: string; missions: ReadonlyMap<string, Mission>;
  nonstandardCheckpoints: ReadonlyMap<string, { sha256: string; content: string }>;
  retainedArtifacts: ReadonlyMap<string, { sha256: string; content: string }>;
  missionDocuments: ReadonlyMap<string, { sha256: string; content: string }>;
  reviewStateDiscrepancies: ReadonlyMap<string, { sha256: string; content: string }>;
}
export class LegacyFileClassifier {
  unparsed = 0; missingTasks = 0; verificationFailures = 0;
  readonly identityTitles = new Map<string, string[]>();
  constructor(private readonly sources: LegacyAuditSources) { }
  classify(input: AuditFile): LegacyFileFinding {
    return { path: input.name, sha256: input.sha256, ...this.assess(input) };
  }
  private assess(input: AuditFile): FileAssessment {
    const { name, sha256, content } = input;
    const { retainedArtifacts } = this.sources;
    if (/^backlog\/(?:tasks|completed|archive)\/.*\.md$/.test(name)) { return this.taskFile(input); }
    if (/^missions\/[^/]+\/CP-[0-9]+\.md$/.test(name)) { return this.checkpoint(input); }
    if (/^missions\/[^/]+\/CP-[^/]+\.md$/.test(name)) { return this.nonstandardCheckpoint(input); }
    if (name.endsWith('/MISSION.md')) { return this.missionDocument(input); }
    if (name.includes('/review-events/')) { return this.reviewEvent(input); }
    if (name.endsWith('/review-state.json')) { return this.reviewState(input); }
    if (name.endsWith('/nel-record.json')) { return this.nelRecord(input); }
    if (retainedArtifacts.get(name)?.sha256 === sha256
      && retainedArtifacts.get(name)?.content === content) { return this.retainedArtifact(input); }
    if (name === 'backlog.md') { return this.rootBacklog(input); }
    if (name.startsWith('missions/') && name.includes('/artifacts/')) { return this.missionArtifact(input); }
    return { classification: 'UNRESOLVED', reason: 'No proven Mission representation or retained artifact classification' };
  }
  private taskFile(input: AuditFile): FileAssessment {
    const { name, content } = input;
    const { missions } = this.sources;
    let classification: LegacyFileClass = 'UNRESOLVED';
    let reason = 'No proven Mission representation or retained artifact classification';

    const id = parseTaskFrontmatterValue(content, 'id')?.trim().toUpperCase();
    if (!id) { this.unparsed += 1; reason = 'Task identity is missing'; }
    else {
      const title = parseTaskFrontmatterValue(content, 'title')?.trim() ?? '';
      this.identityTitles.set(id, [...(this.identityTitles.get(id) ?? []), title]);
      const mission = missions.get(id.toLowerCase());
      if ((!mission || mission.status === 'backlog') && name.startsWith('backlog/tasks/')
        && parseTaskFrontmatterValue(content, 'status')?.trim().toLowerCase() === 'backlog') {
        classification = 'retained product/configuration';
        reason = `Unstarted backlog input retained in place; no Mission required for ${id}`;
      }
      else if (!mission) { this.missingTasks += 1; reason = `No Mission for ${id}`; }
      else if (!mission.externalTaskRef) {
        classification = 'retained product/configuration';
        reason = `Native Mission backlog input retained in place; no legacy import trace required for ${id}`;
      }
      else if (mission.externalTaskRef?.id !== id) { reason = `Mission ${id} has no matching source trace`; }
      else {
        return this.pinnedTaskFile(input, id, mission.externalTaskRef);
      }
    }

    return { classification, reason };
  }
  private pinnedTaskFile(input: AuditFile, id: string, taskRef: NonNullable<Mission['externalTaskRef']>): FileAssessment {
    const { name, content } = input;
    const { rootDir } = this.sources;
    let classification: LegacyFileClass = 'UNRESOLVED';
    let reason = 'No proven Mission representation or retained artifact classification';
    const pinned = readLegacyTaskContent(taskRef, rootDir);
    if (pinned.error) { this.verificationFailures += 1; reason = pinned.error; }
    else if (pinned.content !== content && name.startsWith('backlog/archive/')
      && taskRef.url?.startsWith('backlog/completed/')) {
      classification = 'obsolete';
      reason = `Archived copy is superseded by the pinned completed body for ${id}`;
    }
    else if (pinned.content !== content) { reason = 'This copy differs from the pinned task artifact'; }
    else {
      classification = name.startsWith('backlog/tasks/') ? 'retained product/configuration' : 'imported Mission';
      reason = name.startsWith('backlog/tasks/')
        ? `Current Backlog title source and lifecycle mirror retained; pinned artifact matches ${id} byte for byte`
        : `Pinned artifact matches ${id} byte for byte`;
    }
    return { classification, reason };
  }
  private checkpoint(input: AuditFile): FileAssessment {
    const { name, content } = input;
    const { rootDir, missions } = this.sources;
    let classification: LegacyFileClass = 'UNRESOLVED';
    let reason = 'No proven Mission representation or retained artifact classification';

    const slug = name.split('/')[1];
    const mission = missions.get(slug);
    try {
      const parsed = parseCheckpointDocument(missionId(slug), path.basename(name), content);
      const recorded = mission?.checkpoints.find(checkpoint => checkpoint.name === parsed.name);
      if (mission && hasApprovedCheckpointException(rootDir, mission, name, content)) {
        classification = 'retained external artifact';
        reason = 'Operator-approved historical final summary preserved; typed checkpoint phases remain authoritative';
      }
      else if (!recorded) { reason = `Mission ${slug} lacks ${parsed.name}`; }
      else {
        const merged = reconcileLegacyCheckpoint(recorded, parsed);
        if (merged && JSON.stringify(merged) === JSON.stringify(recorded)) {
          classification = 'identical Mission'; reason = `Parsed checkpoint is represented by ${slug} aggregate`;
        } else {
          this.verificationFailures += 1;
          reason = merged ? `Parsed ${parsed.name} has data missing from ${slug} aggregate`
            : `Parsed ${parsed.name} disagrees with ${slug} aggregate`;
        }
      }
    } catch (error) { this.unparsed += 1; reason = error instanceof Error ? error.message : String(error); }

    return { classification, reason };
  }
  private nonstandardCheckpoint(input: AuditFile): FileAssessment {
    const { name, content, sha256 } = input;
    const { nonstandardCheckpoints } = this.sources;
    let classification: LegacyFileClass = 'UNRESOLVED';
    let reason = 'No proven Mission representation or retained artifact classification';

    const preserved = nonstandardCheckpoints.get(name);
    if (preserved?.sha256 === sha256 && preserved.content === content) {
      classification = 'retained external artifact';
      reason = 'Full nonstandard checkpoint preserved outside the retired workflow tree';
    } else {
      this.unparsed += 1;
      reason = 'Nonstandard checkpoint has no verified preservation artifact';
    }

    return { classification, reason };
  }
  private missionDocument(input: AuditFile): FileAssessment {
    const { name, content, sha256 } = input;
    const { missions, missionDocuments } = this.sources;
    let classification: LegacyFileClass = 'UNRESOLVED';
    let reason = 'No proven Mission representation or retained artifact classification';

    const preserved = missionDocuments.get(name);
    if (isLegacyMissionTemplate(content)) {
      classification = 'obsolete';
      reason = 'Placeholder scaffold has no contract; typed Mission state remains authoritative';
    } else if (preserved?.sha256 === sha256 && preserved.content === content) {
      const mission = missions.get(name.split('/')[1]);
      const parsed = parseLegacyMissionDocument(content);
      const missing = missingMissionFields(parsed, mission);
      if (missing.length) {
        this.verificationFailures += 1;
        reason = `Valid typed fields absent from Mission: ${missing.join(', ')}`;
      } else {
        classification = 'retained external artifact';
        const superseded = supersededMissionFields(parsed, mission);
        reason = superseded.length
          ? `Historical text queryable through status; current Mission supersedes ${superseded.join(', ')}`
          : 'Historical text queryable through status; valid typed fields represented by Mission';
      }
    } else {
      this.unparsed += 1; reason = 'Mission document has no verified preservation artifact';
    }

    return { classification, reason };
  }
  private reviewEvent(input: AuditFile): FileAssessment {
    const { name } = input;
    const { rootDir, missions } = this.sources;
    let classification: LegacyFileClass = 'UNRESOLVED';
    let reason = 'No proven Mission representation or retained artifact classification';

    const slug = name.split('/')[1];
    const dir = path.join(rootDir, 'missions', slug, 'review-events');
    const filenames = fs.readdirSync(dir).filter(file => file.endsWith('.md')).sort(compareCodeUnits);
    const exported = readExportedReviewEvents(slug, rootDir);
    const index = filenames.indexOf(path.basename(name));
    const recorded = missions.get(slug)?.review?.reviewEvents[index];
    if (index < 0 || exported.length !== filenames.length) {
      this.unparsed += 1; reason = 'Review event export did not parse one event per file';
    } else if (recorded && isDeepStrictEqual(recorded, exported[index])) {
      classification = 'identical Mission'; reason = `Parsed review event matches ${slug} aggregate at position ${index}`;
    } else { this.verificationFailures += 1; reason = `Review event differs from ${slug} aggregate at position ${index}`; }

    return { classification, reason };
  }
  private reviewState(input: AuditFile): FileAssessment {
    const { name, content, sha256 } = input;
    const { missions, reviewStateDiscrepancies } = this.sources;
    let classification: LegacyFileClass = 'UNRESOLVED';
    let reason = 'No proven Mission representation or retained artifact classification';

    try {
      const state = JSON.parse(content) as Record<string, unknown>;
      const slug = name.split('/')[1];
      const mission = missions.get(slug);
      if (!mission?.review || !state || typeof state !== 'object') {
        this.verificationFailures += 1; reason = `Review state has no ${slug} aggregate counterpart`;
      } else {
        const current = reviewStateDataFrom(mission.review) as Record<string, unknown>;
        const fields = ['reviewer', 'implementer', 'round', 'startedAt', 'phase', 'disposition'];
        const changed = fields.filter(field => (state[field] ?? null) !== (current[field] ?? null));
        const metadata = state.metadata as Record<string, unknown> | undefined;
        const launches = stageLaunchWindowsFrom(metadata?.recordedStageLaunches);
        if (changed.length === 0 && isDeepStrictEqual(launches, mission.review.stageLaunches)) {
          classification = 'identical Mission'; reason = `Review state and launch history match ${slug} aggregate`;
        } else if (mission.status === 'done'
          && reviewStateDiscrepancies.get(name)?.sha256 === sha256
          && reviewStateDiscrepancies.get(name)?.content === content) {
          classification = 'retained external artifact';
          reason = `Closed Mission ${slug} has a distinct historical review snapshot preserved outside the retired tree`;
        } else {
          this.verificationFailures += 1;
          reason = `Review state differs from ${slug} aggregate (${[...changed, ...(!isDeepStrictEqual(launches, mission.review.stageLaunches) ? ['stage launches'] : [])].join(', ')})`;
        }
      }
    } catch { this.unparsed += 1; reason = 'Review state is invalid JSON'; }

    return { classification, reason };
  }
  private nelRecord(input: AuditFile): FileAssessment {
    const { name, content } = input;
    const { missions } = this.sources;
    let classification: LegacyFileClass = 'UNRESOLVED';
    let reason = 'No proven Mission representation or retained artifact classification';

    try {
      const record = JSON.parse(content) as { slug?: string; actualNel?: number; actualBucket?: string; predictedBucket?: string };
      const slug = name.split('/')[1];
      const mission = missions.get(slug);
      if (record.slug !== slug || !Number.isInteger(record.actualNel) || Number(record.actualNel) < 0
        || classifyNelBucket(Number(record.actualNel)).label !== record.actualBucket
        || !['Small', 'Medium', 'Large', 'Unknown'].includes(String(record.predictedBucket))) {
        this.unparsed += 1; reason = 'NEL record identity, bucket, or measurement is invalid';
      } else if (mission && mission.netEngineeringLines === record.actualNel
        && (record.predictedBucket === 'Unknown' || mission.predictedNelBucket === record.predictedBucket)) {
        classification = 'identical Mission'; reason = `NEL measurement and prediction match ${slug} aggregate`;
      } else { this.verificationFailures += 1; reason = `NEL record differs from ${slug} aggregate`; }
    } catch { this.unparsed += 1; reason = 'NEL record is invalid JSON'; }

    return { classification, reason };
  }
  private retainedArtifact(_input: AuditFile): FileAssessment {
    return { classification: 'retained external artifact', reason: 'Full historical artifact preserved outside the retired workflow tree' };
  }
  private rootBacklog(_input: AuditFile): FileAssessment {
    this.unparsed += 1;
    return { classification: 'UNRESOLVED', reason: 'Root backlog document has no verified retained artifact' };
  }
  private missionArtifact(_input: AuditFile): FileAssessment {
    return { classification: 'retained external artifact', reason: 'Mission artifact retained in repository' };
  }

}

type ParsedMissionDocument = ReturnType<typeof parseLegacyMissionDocument>;
function missingMissionFields(parsed: ParsedMissionDocument, mission: Mission | undefined): readonly string[] {
  return [
    ...missingMissionContractFields(parsed, mission),
    parsed.predictedNelBucket && !mission?.predictedNelBucket ? 'NEL prediction' : null,
    parsed.reproductionTest && !mission?.reproductionTest ? 'reproduction test' : null,
    ...parsed.checkpoints.filter(cp => !mission?.checkpoints.some(recorded => recorded.name === cp.name))
      .map(cp => cp.name),
  ].filter((value): value is string => Boolean(value));
}

function supersededMissionFields(parsed: ParsedMissionDocument, mission: Mission | undefined): readonly string[] {
  return [
    ...supersededMissionContractFields(parsed, mission),
    parsed.predictedNelBucket && mission?.predictedNelBucket !== parsed.predictedNelBucket ? 'NEL prediction' : null,
    parsed.reproductionTest && mission?.reproductionTest !== parsed.reproductionTest ? 'reproduction test' : null,
  ].filter((value): value is string => Boolean(value));
}

function missingMissionContractFields(parsed: ParsedMissionDocument, mission: Mission | undefined): readonly (string | null)[] {
  return [
    parsed.brief && !mission?.brief ? 'brief' : null,
    parsed.successCriteria?.length && !mission?.successCriteria?.length ? 'success criteria' : null,
    parsed.declaredGates?.length && !mission?.declaredGates?.length ? 'gates' : null,
  ];
}

function supersededMissionContractFields(parsed: ParsedMissionDocument, mission: Mission | undefined): readonly (string | null)[] {
  return [
    parsed.brief && mission?.brief && !isDeepStrictEqual(parsed.brief, mission.brief) ? 'brief' : null,
    parsed.successCriteria && mission?.successCriteria?.length
      && !isDeepStrictEqual(parsed.successCriteria, mission.successCriteria) ? 'success criteria' : null,
    parsed.declaredGates && mission?.declaredGates?.length
      && !isDeepStrictEqual(parsed.declaredGates, mission.declaredGates) ? 'gates' : null,
  ];
}
