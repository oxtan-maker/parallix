// TASK-2547 — regression test for the production LCOV merge path.
//
// The hosted `ci-required` job unions the per-tier LCOV fragments produced by
// the CI-safe execution with `scripts/coverage-merge.ts`, which calls
// `mergeLcov()` in src/adapters/verification/coverage-gate.ts. SC4 forbids raw
// LCOV concatenation for overlapping records: a source/line present in more
// than one fragment keeps the larger hit count with no duplicated `DA:` record,
// and LF/LH are recomputed from the union.
//
// This test imports `mergeLcov` directly (not through the mock facade used by
// test/coverage-gate.test.ts) so the production function under test is actually
// exercised and its coverage is captured by the CI-safe coverage run; a
// facade delegation would select the real function but not count its hits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLcov } from '../src/adapters/verification/coverage-gate.js';

test('mergeLcov unions overlapping records with no DA: duplication and recomputes LF/LH', () => {
  const fragmentA = 'SF:src/a.ts\nDA:1,0\nDA:2,3\nend_of_record\n';
  const fragmentB = 'SF:src/a.ts\nDA:1,2\nDA:2,0\nend_of_record\n';
  // DA:1 keeps the larger hit (2), DA:2 keeps the larger hit (3); one DA: per
  // line, no concatenated duplicate records.
  assert.equal(
    mergeLcov([fragmentA, fragmentB]),
    'SF:src/a.ts\nDA:1,2\nDA:2,3\nLF:2\nLH:2\nend_of_record\n',
  );
});

test('mergeLcov keeps distinct SF: files separate and recomputes per file', () => {
  const fragmentA = 'SF:src/a.ts\nDA:1,5\nend_of_record\n';
  const fragmentB = 'SF:src/b.ts\nDA:1,7\nend_of_record\n';
  assert.equal(
    mergeLcov([fragmentA, fragmentB]),
    'SF:src/a.ts\nDA:1,5\nLF:1\nLH:1\nend_of_record\n' +
      'SF:src/b.ts\nDA:1,7\nLF:1\nLH:1\nend_of_record\n',
  );
});

test('mergeLcov handles a zero-hit line and empty input', () => {
  const fragmentA = 'SF:src/a.ts\nDA:1,0\nDA:2,0\nend_of_record\n';
  // Both lines zero-hit: LF counts them, LH counts only covered lines.
  assert.equal(
    mergeLcov([fragmentA]),
    'SF:src/a.ts\nDA:1,0\nDA:2,0\nLF:2\nLH:0\nend_of_record\n',
  );
  assert.equal(mergeLcov([]), '');
});
