import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheckpointDocument, renderCheckpointDocument } from '../src/adapters/backlog/checkpoint-document.js';
import type { MissionId } from '../src/domain/mission.js';
const missionId = 'task-2525.04' as unknown as MissionId;

const DOC = `# CP-2: First fix + regression tests

## Summary

Work done.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Slice fixed | \`npm test -- test/checkpoint-document.test.ts\` | PASS |
| Static analysis | \`./scripts/verify-local.sh static-analysis\` | PASS |

Next action: Advance.`;

test('parseCheckpointDocument extracts name, first line, goal-check rows, and next action', () => {
  const data = parseCheckpointDocument(missionId, 'CP-2.md', DOC);

  assert.equal(data.name, 'CP-2');
  assert.equal(data.rawFilename, 'CP-2.md');
  assert.equal(data.firstLine, 'CP-2: First fix + regression tests');
  assert.equal(data.goalCheck.length, 2);
  assert.deepEqual(data.goalCheck[0], { criterion: 'Slice fixed', evidence: '`npm test -- test/checkpoint-document.test.ts`' });
  assert.deepEqual(data.goalCheck[1], { criterion: 'Static analysis', evidence: '`./scripts/verify-local.sh static-analysis`' });
  assert.match(data.nextActionText, /^Advance/);
});

test('parseCheckpointDocument stops scanning at the next ## heading after the Goal Check table', () => {
  const content = [
    '# CP-3',
    '',
    '## Goal Check',
    '',
    '| Criterion | Evidence | Status |',
    '|---|---|---|',
    '| A | ev | PASS |',
    '',
    '## Next section',
    '',
    '| B | ev2 | PASS |',
    '',
    'Next action: go',
  ].join('\n');

  const data = parseCheckpointDocument(missionId, 'CP-3.md', content);
  assert.equal(data.goalCheck.length, 1);
  assert.equal(data.goalCheck[0].criterion, 'A');
});

test('parseCheckpointDocument ignores rows with fewer than two cells by ending the table', () => {
  const content = [
    '# CP-4',
    '## Goal Check',
    '| Criterion | Evidence | Status |',
    '|---|---|---|',
    '| only-one-cell',
    '| real | ev | PASS |',
    'Next action: go',
  ].join('\n');

  const data = parseCheckpointDocument(missionId, 'CP-4.md', content);
  assert.equal(data.goalCheck.length, 0);
});

test('parseCheckpointDocument accepts the alternate Goal Check Table heading', () => {
  const content = [
    '# CP-5',
    '## Goal Check Table',
    '| Criterion | Evidence | Status |',
    '|---|---|---|',
    '| A | ev | PASS |',
    'Next action: go',
  ].join('\n');

  const data = parseCheckpointDocument(missionId, 'CP-5.md', content);
  assert.equal(data.goalCheck.length, 1);
});

test('parseCheckpointDocument throws for a non-CP-named document', () => {
  assert.throws(() => parseCheckpointDocument(missionId, 'notes.md', DOC), /not named CP-<n>\.md/);
});

test('parseCheckpointDocument collects the last Next action line when several are present', () => {
  const content = [
    '# CP-6',
    'Next action: first',
    '',
    '## Goal Check',
    '| Criterion | Evidence | Status |',
    '|---|---|---|',
    '| A | ev | PASS |',
    '',
    'Next action: second',
  ].join('\n');

  const data = parseCheckpointDocument(missionId, 'CP-6.md', content);
  assert.equal(data.nextActionText, 'second');
});

test('renderCheckpointDocument round-trips parsed data through the same shape', () => {
  const parsed = parseCheckpointDocument(missionId, 'CP-2.md', DOC);
  const rendered = renderCheckpointDocument(parsed);
  const reparsed = parseCheckpointDocument(missionId, 'CP-2.md', rendered);

  assert.deepEqual(reparsed.goalCheck, parsed.goalCheck);
  assert.equal(reparsed.nextActionText, parsed.nextActionText);
});
