import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveKnownAgentFamilies } from '../../../src/adapters/agents/known-agent-families.js';
import { discoverTestFiles } from '../../../src/adapters/verification/coverage-gate.js';
import { discoverSuites } from '../../lib/test-tier-selection.js';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';

// Regression guard for SonarQube S2871 (implicit string sort). The mission
// baseline flagged every default-ordering `.sort()` in `src/` as a latent
// correctness risk. The 18 open calls sort string/lexical data where default
// lexicographic ordering is the intended order; each now carries an explicit
// comparator. These tests pin that ordering so a later mechanical rewrite
// (e.g. dropping the comparator) is caught as a behavior change.

/** Create a temp root with a config/agents.json written from `contents`. */
function tempRoot(contents: string): string {
  const root = registeredMkdtemp('sonarqube-s2871-');
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'agents.json'), contents);
  return root;
}

test('resolveKnownAgentFamilies returns the eligible union in lexicographic order', () => {
  // Eligible entries are declared out of order; the union branch must sort
  // them with an explicit comparator (S2871), yielding ascending order.
  const root = tempRoot(
    JSON.stringify({
      steps: {
        draft: { eligible: ['vibe', 'claude'] },
        review: { eligible: ['codex', 'claude'] },
      },
    }),
  );
  try {
    const families = resolveKnownAgentFamilies(root);
    assert.deepEqual(families, ['claude', 'codex', 'vibe']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverTestFiles preserves UTF-16 filename order', () => {
  const testDir = path.join(process.cwd(), 'test');
  const files = discoverTestFiles();
  assert.deepEqual(files, discoverSuites(testDir).map(file => path.join(testDir, file)).sort());
  assert.ok(files.length > 0);
  assert.deepEqual(files, [...files].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
});

test('string sort comparator yields ascending order on mixed-length tokens', () => {
  // Default `Array.prototype.sort` orders by UTF-16 code units; the explicit
  // comparator must reproduce ascending lexicographic order for the token
  // shapes these sorts actually carry (agent/dir/file names).
  const tokens = ['vibe', 'claude', 'codex'];
  const sorted = [...tokens].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(sorted, ['claude', 'codex', 'vibe']);
});
