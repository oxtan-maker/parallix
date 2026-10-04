/**
 * Focused application boundary for an autonomous review round.
 *
 * Provider, artifact, process, and persistence implementations remain adapter
 * concerns.  The application decides when their effects are sequenced.
 */
export interface PersistedReviewRound {
  readonly round: number;
}

export interface StartReviewRound {
  readonly slug: string;
  readonly implementer?: string;
  readonly reviewer?: string;
  readonly focus: string;
  readonly maxAttempts: number;
  readonly dryRun: boolean;
  readonly reset: boolean;
  readonly isContinue: boolean;
  readonly verbose: boolean;
  readonly pollTimeoutSeconds: number | null;
  readonly missionPath?: string;
}

export interface ReviewRoundWorkflowPort {
  loadRound(_slug: string): Promise<PersistedReviewRound | null>;
  isKnownMission(_slug: string): Promise<boolean>;
  clearHumanIntervention(_slug: string): Promise<void>;
  invalidateResolvedBlocker(_slug: string): Promise<void>;
  runRound(_request: StartReviewRound): Promise<void>;
  invalidMaxAttempts(_raw: string): void;
  missingReviewAggregate(_slug: string): void;
}
