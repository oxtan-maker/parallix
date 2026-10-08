import { PACKET_VERSION, PROMPT_VERSION } from './evidence-packet.js';
import { ROUTING_POLICY_VERSION } from './routing-policy.js';
import type { LoopContext } from '../review-loop/round.js';
import type { ReviewClassificationPorts } from '../ports/review-classification.js';
import type { ClassifierCallMeasurement, ReviewClassificationTelemetryPort } from '../ports/review-classification-telemetry.js';

/** What the telemetry row may know about the round, however early it ends. */
export interface RoundIdentity {
  readonly repository: string | null;
  readonly decisionId: string;
  readonly round: number;
  readonly priorRevision: string;
  readonly candidateRevision: string;
  readonly findingIds: readonly string[];
}

/**
 * Exactly one telemetry row per review round attempt. The first `finish` wins;
 * later calls are ignored, so every exit path may call it without double counting.
 * A retried round re-enters with the same decision identity and is deduplicated
 * by statistics on (mission, round), not by this writer.
 */
export class RoundTelemetry {
  private measurement: ClassifierCallMeasurement;
  private finished = false;
  constructor(private readonly _telemetry: ReviewClassificationTelemetryPort | null, ports: ReviewClassificationPorts,
    context: LoopContext, identity: RoundIdentity) {
    this.measurement = {
      decisionId: identity.decisionId, fingerprint: ports.fingerprint(), repository: identity.repository ?? '', mission: context.slug,
      round: identity.round, observedAt: ports.now(), priorRevision: identity.priorRevision, candidateRevision: identity.candidateRevision,
      findingIds: [...identity.findingIds], packetHash: null, packetVersion: PACKET_VERSION, promptVersion: PROMPT_VERSION,
      policyVersion: ROUTING_POLICY_VERSION, provider: null, model: null, implementer: context.identities.implementer,
      reviewer: context.identities.reviewer, label: null, score: null, route: 'reviewer', reason: 'unrecorded',
      shadow: ports.mode === 'shadow', preparationMs: null, classificationMs: null,
    };
  }
  /** Accumulates measurements gathered before the round ends. */
  note(patch: Partial<ClassifierCallMeasurement>): void { this.measurement = { ...this.measurement, ...patch }; }
  get current(): ClassifierCallMeasurement { return this.measurement; }
  /** Writes the single row; recording failures never change the review outcome. */
  async finish(reason: string, patch: Partial<ClassifierCallMeasurement> = {}): Promise<void> {
    if (this.finished) { return; }
    this.finished = true;
    if (!this._telemetry || !this.measurement.repository) { return; }
    try { await this._telemetry.recordCall({ ...this.measurement, route: 'reviewer', ...patch, reason }); } catch { /* measurement only */ }
  }
}
