// The real ESLint/TypeScript diagnostic boundary is separate from shell gate
// status handling, which remains in integrate-gate-and-exclusivity-process-contract.
// TASK-2762: operator authorized this batched real-tool replacement.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';
import { invalidAnalysis } from '../../fixtures/standard-analysis-scenarios.js';
const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

  // Operator-authorized TASK-2762 replacement: one real-tool batch preserves
  // every diagnostic assertion; private shell probes retain stage/status behavior.
  test('standard analysis tools retain every diagnostic in one batch (TASK-2762)', () => {
    const root = registeredMkdtemp('standard-analysis-batch-');
    try {
      const scenarios = [{ name: 'clean project', file: 'src/fixture.ts', source: 'export const validValue = 1;' },
        ...invalidAnalysis.filter(scenario => scenario.name !== 'focused test')];
      const result = childProcess.spawnSync(process.execPath,
        // This short batch pays more CPU for background compilation than it
        // saves in elapsed time. Keep V8 work on one thread, including GC/JIT.
        ['--single-threaded', '--v8-pool-size=1', '--max-semi-space-size=64', path.join(repoRoot, 'test/fixtures/standard-analysis-batch.mjs'), root,
          path.join(repoRoot, 'eslint.config.mjs'), JSON.stringify(scenarios)], {
          encoding: 'utf8', timeout: 3000,
          // Tool dependencies supply diagnostics, not product coverage.
          env: { ...process.env, NODE_V8_COVERAGE: '', NODE_OPTIONS: '' },
        });
      assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`);
      const results = JSON.parse(result.stdout) as Array<{ name: string; lint: Array<{ ruleId: string | null }>; compiler: string[] }>;
      assert.equal(results.length, scenarios.length);
      assert.deepEqual(results[0]?.lint, []);
      assert.deepEqual(results[0]?.compiler, []);
      for (const scenario of invalidAnalysis.filter(scenario => scenario.name !== 'focused test')) {
        const actual = results.find(row => row.name === scenario.name);
        assert.ok(actual, scenario.name);
        assert.match(JSON.stringify(scenario.name.includes('compiler') ? actual.compiler : actual.lint), scenario.diagnostic, scenario.name);
      }
      const focused = invalidAnalysis.find(scenario => scenario.name === 'focused test')!;
      const focusFile = path.join(root, focused.file);
      fs.mkdirSync(path.dirname(focusFile), { recursive: true });
      fs.writeFileSync(focusFile, focused.source);
      const hygiene = childProcess.spawnSync('bash', [path.join(repoRoot, 'scripts/test-hygiene.sh')], {
        cwd: root, encoding: 'utf8', timeout: 1000,
      });
      assert.notEqual(hygiene.status, 0, hygiene.stdout + hygiene.stderr);
      assert.match(hygiene.stdout, /VIOLATION: \.only found/);
      assert.doesNotMatch(hygiene.stdout, /PASS: no test-hygiene violation/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
