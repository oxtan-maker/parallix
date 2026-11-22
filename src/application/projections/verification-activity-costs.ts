/** Closed activity intervals of one repository's history, kept in the order the activity transition owner applies them. */
export type Interval = readonly [number, number];

export function interval(start: string | null, end: string | null): Interval[] {
  const a = start === null ? Number.NaN : Date.parse(start), b = end === null ? Number.NaN : Date.parse(end);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? [[a, b]] : [];
}

export type ActivityEvent = { repositoryId?: string; missionId: string; operationId: string;
  operationGeneration?: number | null; sourceId?: string; revision?: string | null; attempt?: number | null;
  phase: string; state: string; purpose?: 'repair' };

export class ActivityCosts {
  readonly sources = new Map<string, { phase: string; start: string; event: ActivityEvent }>();
  readonly repair: Interval[] = [];
  readonly review: Interval[] = [];
  readonly waiting: Interval[] = [];
  private readonly seenReview = new Set<string>();
  /** Source keys of each operation, bottom frame first: the stack the activity transition owner keeps. */
  private readonly stacks = new Map<string, string[]>();
  accept(event: ActivityEvent, at: string): void {
    const key = JSON.stringify([event.operationId, event.sourceId]);
    const stack = this.stacks.get(event.operationId ?? '') ?? [];
    this.stacks.set(event.operationId ?? '', stack);
    const index = stack.indexOf(key);
    // As in the transition owner, a running event for a frame closes every frame above it: the owner of the lower
    // frame took the work back, so the frames above it ended without publishing a terminal of their own.
    if (event.state === 'running' && index >= 0) {
      for (const above of stack.splice(index + 1)) { this.closeSource(above, at); }
    }
    const prior = this.sources.get(key);
    if (prior) { this.close(prior, at); }
    if (event.state !== 'running') { this.sources.delete(key); if (index >= 0) { stack.splice(index, 1); } return; }
    const phase = this.reviewPhase(event, prior?.phase);
    this.sources.set(key, { phase, start: at, event });
    if (index < 0) { stack.push(key); }
  }
  private closeSource(key: string, at: string): void {
    const open = this.sources.get(key);
    if (open) { this.close(open, at); this.sources.delete(key); }
  }
  private close(prior: { phase: string; start: string }, at: string): void {
    const times = interval(prior.start, at);
    if (['repair', 'review-response', 'recovery'].includes(prior.phase)) { this.repair.push(...times); }
    if (prior.phase === 're-review') { this.review.push(...times); }
    if (prior.phase === 'waiting') { this.waiting.push(...times); }
  }
  private reviewPhase(event: ActivityEvent, prior?: string): string {
    if (event.purpose === 'repair') { return 'repair'; }
    if (event.phase !== 'review') { return event.phase; }
    const repeated = this.seenReview.has(event.missionId) && !['review', 're-review'].includes(prior ?? '');
    this.seenReview.add(event.missionId);
    return repeated || prior === 're-review' ? 're-review' : 'review';
  }
}
