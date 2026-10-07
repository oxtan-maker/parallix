/**
 * Net-engineering-line capture at handoff: compute the bucket and persist
 * it through the Mission use case before review advances.
 */

import * as path from 'node:path';
import { artifactReference } from '../domain/net-engineering-lines.js';
import { missionId } from '../domain/mission.js';
import type { CaptureNelOptions, CaptureNelResult, HandoffWorkflowPorts } from './ports/handoff-workflow.js';
import type { NelBucketLabel } from '../domain/net-engineering-lines.js';

const NEL_BUCKET_LABELS: readonly NelBucketLabel[] = ['Small', 'Medium', 'Large'];

/** Captures NEL evidence for a handoff. */
export class HandoffNelCapture {
  private readonly ports: HandoffWorkflowPorts;

  constructor(ports: HandoffWorkflowPorts) {
    this.ports = ports;
  }

  /**
   * Capture NEL (Net Engineering Lines) at handoff time.
   *
   * Computes actual NEL from the merge diff (primary..HEAD), reads the predicted
   * bucket from the mission's Refinement Signals, resolves review rounds from
   * the Mission store, and records the result through the checked Mission
   * boundary. NEL values remain observational; failure to durably persist a
   * computed value is fatal to handoff.
   */
  async captureNelAtHandoff(slug: string, options: CaptureNelOptions): Promise<CaptureNelResult> {
    const { fileSystem, missionUtils, nel, documentWriter } = this.ports;
    const { rootDir, missionDir, error } = options;
    const documentWriterFn = options.documentWriterFn || documentWriter.write;

    // 1. Determine primary branch for diff range
    let primaryBranch;
    try {
      primaryBranch = missionUtils.getPrimaryBranch(rootDir);
    } catch (_) {
      return { ok: false, error: 'could not detect primary branch for NEL diff range' };
    }

    if (!primaryBranch) {
      return { ok: false, error: 'primary branch is empty' };
    }

    // 2. Compute actual NEL from primary..HEAD
    let nelRecord: ReturnType<typeof nel.computeNELRecord>;
    try {
      nelRecord = nel.computeNELRecord(`${primaryBranch}..HEAD`, { cwd: rootDir });
    } catch (_) {
      return { ok: false, error: 'NEL computation failed' };
    }

    const actualNel = nelRecord.nel;
    const actualBucket = nelRecord.bucket.label;

    // 5. Record through the checked Mission boundary. The use case decides and the
    //    selected SQLite authority writes; this workflow supplies only
    //    domain values and the artifact *references* it observed.
    const missionServicesFn = options.missionServicesFn || this.ports.missionServices;
    if (typeof missionServicesFn !== 'function') { return { ok: false, error: 'mission services are not configured' }; }
    const missionServices = await missionServicesFn(rootDir, {
      missionDir,
      documentWriter: documentWriterFn,
    });

    // 4. Read review rounds from the Mission store (not review-state.json).
    // architecture invariant: the SQLite store is the sole authority for Mission domain state.
    let reviewRounds = 1;
    const missionLoad = await missionServices.store.load(missionId(slug));
    if (missionLoad.kind === 'found' && missionLoad.mission.review) {
      reviewRounds = missionLoad.mission.review.rounds.length;
    }

    // 3. The predicted bucket is recorded with `px nel set`. A Mission drafted
    //    before it was Mission state still carries it in its document's
    //    Refinement Signals, which is the only place it exists for that Mission.
    let predictedBucket: NelBucketLabel | 'Unknown' = (missionLoad.kind === 'found' ? missionLoad.mission.predictedNelBucket : null) ?? 'Unknown';
    const missionMdPath = path.join(missionDir, 'MISSION.md');
    if (predictedBucket === 'Unknown' && !(missionLoad.kind === 'found' && missionLoad.mission.brief) && fileSystem.existsSync(missionMdPath)) {
      const predictedMatch = fileSystem.readText(missionMdPath).match(/Predicted NEL bucket:\s*(Small|Medium|Large)/i);
      const documented = predictedMatch?.[1]?.toLowerCase();
      predictedBucket = NEL_BUCKET_LABELS.find((label) => label.toLowerCase() === documented) ?? predictedBucket;
    }
    const artifacts = [
      artifactReference('git-range', `${primaryBranch}..HEAD`),
    ];
    const outcome = await missionServices.handoff.recordNel({
      operationId: `handoff-nel-${slug}`,
      missionId: missionId(slug),
      capabilities: new Set(['handoff:record']),
      netEngineeringLines: actualNel,
      predictedBucket,
      reviewRounds,
      capturedAt: new Date().toISOString(),
      artifacts,
    });

    if (outcome.status !== 'completed') {
      const message = outcome.error?.message || 'NEL record was not persisted';
      error(`Failed to write NEL record: ${message}`);
      return { ok: false, persistenceFailed: true, error: `failed to write NEL record: ${message}` };
    }

    return { ok: true, nel: actualNel, bucket: actualBucket };
  }

}
