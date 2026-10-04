import type { ReviewTaskMirror, ReviewHandoffFailurePort } from './ports/review-task-mirror.js';

/** Repair only the stale active mirror after a successfully recorded review. */
export async function repairReviewedTask(
  resolved: boolean, currentStatus: string | null, virtualStatus: string,
  mirror: ReviewTaskMirror,
): Promise<{ repaired: boolean; skipped?: boolean; currentStatus?: string }> {
  if (!resolved) { return { repaired: false, skipped: true }; }
  if (virtualStatus !== 'active') { return { repaired: false, skipped: true, currentStatus: currentStatus ?? undefined }; }
  const repaired = await mirror.transition('review');
  return repaired
    ? { repaired: true, currentStatus: currentStatus ?? undefined }
    : { repaired: false, skipped: false, currentStatus: currentStatus ?? undefined };
}

/** Keep local and provider-backed task mirrors consistent with review outcomes. */
export async function mirrorReviewOutcome(
  outcome: string, providerEnabled: boolean, currentStatus: string | null,
  mirror: ReviewTaskMirror,
): Promise<void> {
  if (outcome === 'approve') {
    await mirror.transition(providerEnabled && currentStatus === 'active' ? 'review' : 'approved');
  } else if (outcome === 'request-changes' || outcome === 'comment') {
    await mirror.transition('review');
  }
}

/** A declared-gate rejection rebounds once, after authoritative Mission repair. */
export async function reboundRejectedHandoff(
  result: { ok: unknown; reason?: unknown; recoveryAttempted?: unknown }, port: ReviewHandoffFailurePort,
): Promise<void> {
  if (!result.ok && result.reason === 'validation-failed' && !result.recoveryAttempted) {
    await port.repairMission();
    await port.transition('active');
    port.reportBounce();
  }
}
