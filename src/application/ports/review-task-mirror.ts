/** Task-record mechanisms; review decisions remain application-owned. */
export interface ReviewTaskMirror {
  transition(_status: 'active' | 'review' | 'approved'): Promise<boolean>;
}

export interface ReviewReviewPreparationFailurePort extends ReviewTaskMirror {
  repairMission(): Promise<void>;
  reportBounce(): void;
}
