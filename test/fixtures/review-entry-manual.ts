// Manual production-composition probe. All state belongs to disposable fixtures;
// Git, shell checks and SQLite are real, and agent/provider boundaries are doubled.
// Run: node --import tsx --import ./test/bootstrap-parallix-home.ts test/fixtures/review-entry-manual.ts
import { test } from 'node:test';
import { retainedRepairCase } from './review-repair-recovery.js';

for (const scenario of [
  { label: 'inferred first entry refuses missing diagnostics and evidence', phase: 'acknowledgment', inferred: true, first: true },
  { label: 'explicit first entry repairs and reaches independent reviewer', phase: 'recovery', inferred: false, first: true },
  { label: 'inferred existing review resumes repair and independent verdict', phase: 'recovery', inferred: true, first: false },
  { label: 'original false check returns failure without approval', phase: 'failed-check', inferred: false, first: false },
  { label: 'new blocker retains diagnostics and returns failure', phase: 'new-blocker', inferred: true, first: false },
] as const) {
  test(`manual px review: ${scenario.label}`, { timeout: 10000 }, async t => {
    await retainedRepairCase(scenario.phase, scenario.inferred, t, scenario.first);
    t.diagnostic('Production create-cli composition; disposable Git/SQLite; provider=none; launcher doubled; fixture cleanup restored environment and removed state.');
  });
}
