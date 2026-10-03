import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderLcovFile, renderLcovSummary } from '../scripts/render-lcov-summary.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('task-2548: LCOV summary aggregates duplicate source records and preserves ordinary path punctuation', () => {
  const summary = renderLcovSummary(
    'SF:src/a file (v2).ts\nDA:1,0\nDA:2,3\nend_of_record\nSF:src/a file (v2).ts\nDA:1,2\nSF:src/b.ts\nDA:1,0\n',
    'coverage/lcov.info',
    'abc123',
  );
  assert.match(summary, /\| Lines \| 2 \| 3 \| 66\.7% \|/);
  assert.match(summary, /Revision: abc123/);
});

test('task-2548: LCOV summary reports zero coverable lines and ignores malformed numeric records', () => {
  const summary = renderLcovSummary('SF:src/a.ts\nDA:zero,1\nDA:2,nope\nDA:3,-1\n', 'coverage/lcov.info');
  assert.match(summary, /\| Lines \| 0 \| 0 \| 0\.0% \|/);
});

test('task-2548: LCOV summary shows valid function and branch evidence only', () => {
  const summary = renderLcovSummary('SF:src/a.ts\nDA:1,1\nFNDA:2,works\nFNDA:bad,broken\nBRDA:1,0,0,0\nBRDA:1,0,1,3\nBRDA:1,0,2,-\n', 'coverage/lcov.info');
  assert.match(summary, /\| Functions \| 1 \| 1 \| 100\.0% \|/);
  assert.match(summary, /\| Branches \| 1 \| 2 \| 50\.0% \|/);
  assert.doesNotMatch(renderLcovSummary('SF:src/a.ts\nDA:1,1\nFNDA:no,broken\nBRDA:1,0,0,-\n', 'coverage/lcov.info'), /Functions|Branches/);
});

test('task-2548: missing canonical LCOV fails with an actionable error', () => {
  assert.throws(() => renderLcovFile('/definitely/missing/lcov.info'), /cannot read LCOV report/);
});

test('task-2548: ci-required presents the canonical report and triggered candidate without another test run', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-required.yml'), 'utf8');
  assert.match(workflow, /npm run coverage:summary -- "\$GITHUB_SHA" >> "\$GITHUB_STEP_SUMMARY"/);
  assert.match(workflow, /Publish whole-report CI-safe LCOV coverage/);
  assert.doesNotMatch(workflow, /npm run test:coverage/);
});
