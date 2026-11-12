export const OBSERVATION_DIAGNOSTIC_KINDS = ['identity', 'terminal', 'model', 'coverage', 'provenance'] as const;
export type ObservationDiagnosticKind = typeof OBSERVATION_DIAGNOSTIC_KINDS[number];
export const OBSERVATION_DIAGNOSTIC_STATES = ['absent', 'running', 'interrupted'] as const;
export type ObservationDiagnosticState = typeof OBSERVATION_DIAGNOSTIC_STATES[number];

/** A mission-scoped verification gap used to calculate FLOW completeness. */
export interface ObservationDiagnostic {
  readonly kind: ObservationDiagnosticKind;
  readonly state: ObservationDiagnosticState;
  readonly repositoryId: string;
  readonly missionId: string;
  readonly operationId: string | null;
  readonly sourceId: string | null;
  readonly stage: string;
  readonly message: string;
  readonly recovery: string;
}

export function formatObservationDiagnostic(diagnostic: ObservationDiagnostic): string {
  const identity = [diagnostic.operationId ? `operation=${diagnostic.operationId}` : null,
    diagnostic.sourceId ? `source=${diagnostic.sourceId}` : null].filter(Boolean).join(', ');
  return `${diagnostic.message}${identity ? ` (${identity})` : ''}; ${diagnostic.recovery}`;
}
