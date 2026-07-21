import { resolveMaxConcurrentCustom } from '../core/product-config.js';

// Custom launchers run local GPU-backed models. This module is deliberately
// process-local: startAgent is the single lifecycle owner in this process, and
// the mission does not introduce cross-process coordination.
let activeCustomLaunches = 0;

export interface CustomCapacityReservation {
  release: () => void;
}

export function isCustomCapacityAvailable(rootDir?: string): boolean {
  return activeCustomLaunches < resolveMaxConcurrentCustom(rootDir);
}

export function tryAcquireCustomCapacity(rootDir?: string): CustomCapacityReservation | null {
  if (!isCustomCapacityAvailable(rootDir)) {return null;}
  activeCustomLaunches += 1;
  let released = false;
  return {
    release() {
      if (released) {return;}
      released = true;
      activeCustomLaunches = Math.max(0, activeCustomLaunches - 1);
    }
  };
}

// Test and recovery hook: clearing reservations is safe because this guard is
// in-process only. Production lifecycle code normally releases via finally.
export function resetCustomCapacity(): void {
  activeCustomLaunches = 0;
}

export function activeCustomCapacityCount(): number {
  return activeCustomLaunches;
}
