import test from 'node:test';
import assert from 'node:assert/strict';
import { GitReviewEvidence } from '../../../../src/adapters/review/review-evidence.js';
import { EvidenceReadError } from '../../../../src/application/ports/review-evidence.js';

// Contract of the Git evidence adapter: bounded reads report typed errors.
test('an oversized or failed git read is a typed evidence error rather than a raw child-process error (TASK-2704)', async () => {
  const oversize = Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
  const big = new GitReviewEvidence('/repo', async () => { throw oversize; });
  await assert.rejects(big.diff('a', 'b', []), (error: unknown) => error instanceof EvidenceReadError && error.oversize);
  const broken = new GitReviewEvidence('/repo', async () => { throw new Error('fatal: bad object'); });
  await assert.rejects(broken.source('a', 'x.ts'), (error: unknown) => error instanceof EvidenceReadError && !error.oversize);
  await assert.rejects(broken.tree('a'), EvidenceReadError);
});
