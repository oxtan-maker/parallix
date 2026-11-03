import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Mission } from '../../domain/mission.js';
import { missionCohortMetadata } from '../../application/projections/metrics-read-adapter.js';
import type { Review, ReviewRound } from '../../domain/review.js';
import { reviewStatistics, type ReviewStatisticsEvidence } from '../../application/services/review-statistics.js';
import { GitMissionPatchComparison } from './mission-patch-comparison.js';

/** Read-only proofs through the existing mission-patch comparison owner. */
export function createReviewStatisticsEvidenceReader(root: string) {
  const comparison = new GitMissionPatchComparison(root);
  const proofs = new PatchProofCache(root, comparison);
  return async (review: Review | null): Promise<ReviewStatisticsEvidence> => {
    const equivalentSubmissions: Record<string, string[]> = {};
    // Only retained obligations need judged-work proofs. Plain approvals must
    // not turn every stats read into a Git audit of all delivered work.
    const judgedRounds = new Set(reviewStatistics(review).obligations.map(obligation => obligation.round));
    for (const round of review?.rounds ?? []) {
      if (!judgedRounds.has(round.number)) { continue; }
      const proof = await judgmentProof(round, review!.rounds, proofs);
      if (round.decision?.revision) { equivalentSubmissions[round.decision.revision] = [...new Set([...(equivalentSubmissions[round.decision.revision] ?? []), ...proof])]; }
    }
    proofs.flush();
    return { equivalentSubmissions };
  };
}

async function judgmentProof(round: ReviewRound,
  rounds: Review['rounds'], comparison: Pick<GitMissionPatchComparison, 'samePatch'>): Promise<string[]> {
  const revision = round.decision?.revision;
  if (!revision || revision === round.subject.revision) { return []; }
  const proven: string[] = [];
  const submissions = rounds.filter(submission => submission.number <= round.number
    && (submission === round || submission.implementer !== round.implementer));
  for (const submission of submissions) {
    try {
      // Prove an empty mission delta between submission and judgment first.
      // This reuses the same owner without replaying the branch's entire
      // release history for ordinary bookkeeping-only moves.
      const baseline = submission.subject.revision;
      if (await comparison.samePatch({ revision, baseline }, { revision: baseline, baseline })) {
        proven.push(submission.subject.revision);
      }
    } catch {
      // Missing Git objects provide no proof. Assignment never substitutes for it.
    }
  }
  return proven;
}

/** Bind one proof reader to a read session; Git objects are immutable by SHA. */
export function createMissionCohortMetadataReader(root: string) {
  const readEvidence = createReviewStatisticsEvidenceReader(root);
  return async (missions: readonly Mission[]) => {
    const evidence = new Map<string, ReviewStatisticsEvidence>();
    const completed = missions.filter(mission => mission.status === 'done');
    // Bound process fan-out while avoiding a serial Git audit on each refresh.
    for (let offset = 0; offset < completed.length; offset += 4) {
      await Promise.all(completed.slice(offset, offset + 4).map(async mission => {
        evidence.set(mission.id, await readEvidence(mission.review));
      }));
    }
    return missionCohortMetadata(missions, evidence);
  };
}

/** Cache Git facts, never review counts. Only immutable object IDs are reusable. */
class PatchProofCache {
  private readonly file: string;
  private readonly writable: boolean;
  private readonly entries = new Map<string, boolean>();
  private changed = false;
  constructor(root: string, private readonly comparison: GitMissionPatchComparison) {
    this.writable = fs.existsSync(root);
    this.file = path.join(root, '.workflow', 'cache', 'review-patch-proofs-v1.json');
    try {
      const stored: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [key, value] of Object.entries(stored)) {
          if (/^[a-f0-9]{64}$/.test(key) && typeof value === 'boolean') { this.entries.set(key, value); }
        }
      }
    } catch { /* Missing or corrupt cache is a miss, never evidence. */ }
  }
  async samePatch(before: Parameters<GitMissionPatchComparison['samePatch']>[0], after: Parameters<GitMissionPatchComparison['samePatch']>[1]): Promise<boolean> {
    const immutable = [before.revision, before.baseline, after.revision, after.baseline].every(value => /^[a-f0-9]{40}$/.test(value));
    const key = createHash('sha256').update(JSON.stringify([before, after])).digest('hex');
    if (immutable && this.entries.has(key)) { return this.entries.get(key)!; }
    const result = await this.comparison.samePatch(before, after);
    if (immutable) { this.entries.set(key, result); this.changed = true; }
    return result;
  }
  flush(): void {
    if (!this.changed || !this.writable) { return; }
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.entries)), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
      this.changed = false;
    } catch { /* Cache availability must not change the observation. */ }
    finally { try { fs.unlinkSync(temporary); } catch { /* Already renamed or unavailable. */ } }
  }
}
