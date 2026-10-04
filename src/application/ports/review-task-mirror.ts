/** Task-record mechanisms; review decisions remain application-owned. */
export interface ReviewTaskMirror {
  transition(_status: 'active' | 'review' | 'approved'): Promise<boolean>;
}

export interface ReviewHandoffFailurePort extends ReviewTaskMirror {
  repairMission(): Promise<void>;
  reportBounce(): void;
}
