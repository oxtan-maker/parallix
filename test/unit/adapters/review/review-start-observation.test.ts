import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewStartFailureDiagnostics } from '../../../../src/adapters/review/review-start-observation.js';
import type { ReviewStartFailureKind } from '../../../../src/application/ports/verification-policy.js';

test('review-start diagnostics count every typed failure under a separate label (TASK-2859.09 F3)', () => {
  const messages: string[] = [];
  const diagnostics = createReviewStartFailureDiagnostics(message => { messages.push(message); });
  const kinds: ReviewStartFailureKind[] = [
    'artifact-missing', 'artifact-invalid', 'artifact-unreadable', 'artifact-hash-mismatch',
    'history-unavailable', 'history-invalid', 'history-contradiction', 'history-unmodelled-history',
    'belief-invalid', 'belief-contradiction', 'belief-unmodelled-history', 'no-recommendation',
    'policy-exception', 'writer-failure', 'observation-timeout',
  ];
  for (const kind of kinds) { diagnostics({ kind, message: `${kind} diagnostic` }); }
  diagnostics({ kind: 'writer-failure', message: 'database still unavailable' });

  for (const kind of kinds) {
    assert.ok(messages.some(message => message.includes(`verification.review-start-failure.${kind} count=1`)));
  }
  assert.match(messages.at(-1)!, /verification\.review-start-failure\.writer-failure count=2/);
});
