import { spawnSync } from 'node:child_process';
import { setTimeout as timerPause } from 'node:timers/promises';
import * as owner from '../../application/admission-wait.js';
export type { AdmissionWaitPolicy, AdmissionWaitState, AdmissionWaitOptions, AdmissionWaitResult, AdmissionPause } from '../../application/admission-wait.js';
export { admissionDelayMs } from '../../application/admission-wait.js';

/** Adapter effects only; polling and accounting have one application owner. */
export function waitForAdmission<T>(probe: Parameters<typeof owner.waitForAdmission<T>>[0], policy: owner.AdmissionWaitPolicy, options: owner.AdmissionWaitOptions = {}) {
  return owner.waitForAdmission(probe, policy, { ...options, pause: options.pause ?? ((ms, signal) => timerPause(ms, undefined, { signal })) });
}
export function waitForAdmissionSync<T>(probe: Parameters<typeof owner.waitForAdmissionSync<T>>[0], policy: owner.AdmissionWaitPolicy, options: Parameters<typeof owner.waitForAdmissionSync<T>>[2] = {}) {
  return owner.waitForAdmissionSync(probe, policy, { ...options, pause: options.pause ?? pauseSynchronously });
}
function pauseSynchronously(ms: number): void {
  const result = spawnSync('sleep', [String(ms / 1000)], { stdio: 'ignore' });
  if (result.signal) { throw new Error(`Admission interrupted by ${result.signal}; resource and operation state preserved`); }
  if (result.error) { throw result.error; }
  if (result.status !== 0) { throw new Error(`Admission pause failed (${result.status})`); }
}
