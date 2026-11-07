import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { bindGateAdmission } from './gate-admission.js';
import { bindRebaseObservation } from './rebase-observation.js';
import { bindVerificationObservation } from './verification-observation.js';

/** Install every durable workflow observation port for this process role. */
export function bindWorkflowObservability(configuration: ParallixConfiguration): void {
  bindGateAdmission(configuration);
  bindVerificationObservation(configuration);
  bindRebaseObservation(configuration);
}
