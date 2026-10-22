import { resolveCanonicalMaxConcurrentGates } from '../adapters/config/product-config.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { configureGateAdmission } from '../application/ports/gate-admission.js';
import { SharedGateAdmission } from '../adapters/process/gate-admission.js';
import { initCustomAdmissionState } from '../adapters/sqlite/custom-admission-state.js';
import { SqliteCustomAgentLeaseRepository } from '../adapters/sqlite/custom-agent-lease-repository.js';

export function createGateAdmission(configuration: ParallixConfiguration) {
  return new SharedGateAdmission(async resource => {
    const { db } = await initCustomAdmissionState(configuration);
    return new SqliteCustomAgentLeaseRepository(db, resource);
  }, configuration.runtime.gateOwner !== undefined, resolveCanonicalMaxConcurrentGates);
}
export function bindGateAdmission(configuration: ParallixConfiguration): void {
  configureGateAdmission(createGateAdmission(configuration));
}
