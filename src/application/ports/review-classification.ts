import type { DecisionPort } from './decision.js';
import type { ReviewEvidencePort } from './review-evidence.js';
import type { ReviewClassificationTelemetryPort } from './review-classification-telemetry.js';
import type { ClassifierReviewSource } from '../../domain/classifier-review.js';
export interface RepeatReviewClassificationPorts {
  readonly decision: DecisionPort;
  readonly evidence: ReviewEvidencePort;
  telemetry(): Promise<ReviewClassificationTelemetryPort>;
  readonly mode: 'enabled' | 'disabled' | 'shadow';
  hash(_text: string): string;
  fingerprint(): string;
  now(): string;
  clock(): number;
  /** Formal review by the dedicated classifier identity at the exact candidate revision. */
  publish(_source: ClassifierReviewSource, _route: 'clear' | 'implementer', _summary: string): Promise<boolean>;
}
