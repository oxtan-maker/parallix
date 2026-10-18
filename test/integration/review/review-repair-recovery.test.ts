// Real CLI repair verification owns independent successful and failed checks.
import { it } from 'node:test';
import { retainedRepairCase } from '../../fixtures/review-repair-recovery.js';

for (const phase of ['recovery', 'failed-check'] as const) {
  for (const inferred of [false, true]) {
    it(`running CLI ${phase} with ${inferred ? 'inferred' : 'explicit'} slug (TASK-2766)`, { timeout: 10000 }, async t => {
      await retainedRepairCase(phase, inferred, t);
    });
  }
}
