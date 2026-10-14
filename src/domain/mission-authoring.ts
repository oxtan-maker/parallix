import { missionBrief, type MissionBrief } from './mission-brief.js';
import { declaredGates } from './mission-gates.js';
import { replaceSuccessCriteria, successCriteria } from './mission-success-criteria.js';
import { planCheckpoint } from './checkpoint.js';
import { missionLabel, type Mission } from './mission.js';
import type { NelBucketLabel } from './net-engineering-lines.js';

export const MISSION_CLASSIFICATIONS = ['ai_sdlc', 'user_value', 'unknown'] as const;
export type MissionClassification = typeof MISSION_CLASSIFICATIONS[number];

/** Recorded classification only; absence is distinct from an explicit unknown. */
export function recordedClassification(labels: readonly string[]): MissionClassification | null {
  const matches = labels.filter((label): label is MissionClassification => MISSION_CLASSIFICATIONS.includes(label as MissionClassification));
  return matches.length === 1 ? matches[0]! : null;
}

export interface MissionAuthoringFields {
  readonly brief: MissionBrief;
  readonly criteria: readonly string[];
  readonly checkpoints: readonly { readonly name: string; readonly description: string }[];
  readonly gates: readonly string[];
  readonly predictedNelBucket: NelBucketLabel;
  readonly classification: MissionClassification;
}

export function classificationLabels(mission: Mission, classification: string) {
  const value = classification.trim().toLowerCase() as MissionClassification;
  if (!MISSION_CLASSIFICATIONS.includes(value)) { throw new Error('classification must be exactly one of ai_sdlc, user_value, or unknown'); }
  return [...mission.labels.filter(label => !MISSION_CLASSIFICATIONS.includes(String(label) as MissionClassification)), missionLabel(value)];
}

/** A complete draft replaces planning facts, preserving all unrelated state. */
export function authorMission(mission: Mission, fields: MissionAuthoringFields): Mission {
  if (!['backlog', 'refined'].includes(mission.status) || mission.closedAt !== null
    || mission.checkpoints.some(checkpoint => checkpoint.goalCheck.length > 0 || checkpoint.repair)) {
    throw new Error('Mission authoring cannot replace a locked execution contract');
  }
  const brief = missionBrief(fields.brief);
  const criteria = successCriteria(fields.criteria);
  const gates = declaredGates(fields.gates);
  if (!brief.scope || criteria.length === 0 || gates.length === 0 || fields.checkpoints.length === 0) {
    throw new Error('Mission authoring requires scope, criteria, checkpoint plans and gates');
  }
  if (!['Small', 'Medium', 'Large'].includes(fields.predictedNelBucket)) { throw new Error('predicted NEL bucket must be Small, Medium or Large'); }
  const checkpoints = fields.checkpoints.reduce((planned, checkpoint) => planCheckpoint(planned, { ...checkpoint, missionId: mission.id }), [] as Mission['checkpoints'][number][]);
  return { ...replaceSuccessCriteria(mission, criteria), brief,
    checkpoints, declaredGates: gates, predictedNelBucket: fields.predictedNelBucket,
    labels: classificationLabels(mission, fields.classification) };
}
