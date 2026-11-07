import type { MissionId } from './mission.js';

export type DefectAttribution =
  | { readonly kind: 'originating-mission'; readonly missionId: MissionId }
  | { readonly kind: 'external' }
  | { readonly kind: 'pre-mission' }
  | { readonly kind: 'unresolved' };

/** Durable causal evidence for a bug-labelled Mission. */
export interface DefectProvenance {
  readonly rootCauseSummary: string;
  readonly investigationEvidence: string;
  readonly attribution: DefectAttribution;
}

export class DefectProvenanceViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefectProvenanceViolation';
  }
}

/** Validate and normalize defect provenance at every aggregate write boundary. */
export function defectProvenance(
  value: DefectProvenance,
  owningMissionId?: MissionId,
): DefectProvenance {
  const rootCauseSummary = requiredText(value?.rootCauseSummary, 'root-cause summary');
  const investigationEvidence = requiredText(value?.investigationEvidence, 'investigation evidence');
  const attribution = value?.attribution;
  if (!attribution || typeof attribution !== 'object') {
    throw new DefectProvenanceViolation('Defect provenance requires one attribution disposition');
  }
  switch (attribution.kind) {
    case 'originating-mission': {
      if (typeof attribution.missionId !== 'string' || attribution.missionId.trim().length === 0) {
        throw new DefectProvenanceViolation('Originating-Mission attribution requires a Mission id');
      }
      if (owningMissionId !== undefined && attribution.missionId === owningMissionId) {
        throw new DefectProvenanceViolation(`Mission ${owningMissionId} cannot attribute its defect to itself`);
      }
      return { rootCauseSummary, investigationEvidence, attribution: { kind: attribution.kind, missionId: attribution.missionId } };
    }
    case 'external':
    case 'pre-mission':
    case 'unresolved':
      if ('missionId' in attribution) {
        throw new DefectProvenanceViolation(`${attribution.kind} attribution cannot name an originating Mission`);
      }
      return { rootCauseSummary, investigationEvidence, attribution: { kind: attribution.kind } };
    default:
      throw new DefectProvenanceViolation(`Invalid defect attribution disposition: ${String((attribution as { kind?: unknown }).kind)}`);
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DefectProvenanceViolation(`Defect provenance requires non-empty ${field}`);
  }
  return value.trim();
}
