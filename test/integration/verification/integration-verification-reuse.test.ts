// Split by proof contract; preserves assertions and isolation from verification-proof-reuse.
import fs from 'fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'os';
import path from 'path';
import { runPhaseGates } from '../../../src/adapters/config/repository-gates.js';
import { runPreReviewGate } from '../../../src/adapters/review/review-gate-handling.js';
import { readActiveVerificationProof } from '../../../src/adapters/verification/active-verification-proof.js';
import { createIntegrationVerificationEvidencePort } from '../../../src/adapters/verification/integration-verification-proof.js';
import runWorkflow, {
  captureVerifiedTreeProof,
} from '../../../src/adapters/verification/verification.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { initCommittedRepository } from '../../fixtures/git-repository.js';

// Real Git and phase execution boundary: existing integration-ci owner, ADR 0057.
for (const scenario of ['green', 'partial', 'failed', 'uncovered']) {
  test('integration coverage authorizes all only after complete green validation: ' + scenario + ' (TASK-2740)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-all-proof-'));
    try {
      const command = 'printf x >> .git/all-runs';
      const gates = ['docs', 'build', 'unit'].map((key, order) => ({ key, order, command: 'true' }));
      initCommittedRepository(root, { 'workflow.config.json': JSON.stringify({ adapters: {
        verification: { command, defaultArea: 'all', integrationCoverage: {
          command, checks: { docs: ['docs'], build: ['build'], unit: [scenario === 'uncovered' ? 'absent' : 'unit'] },
        } }, gates: { preIntegration: gates },
      } }) });
      const configuration = resolveConfiguration({ ...process.env });
      const result = await runPhaseGates('integration', { configuration, slug: 'task-2740', checkoutPath: root, verificationEvidence: createIntegrationVerificationEvidencePort(configuration),
        gates: scenario === 'partial' ? gates.slice(0, 2) : gates,
        commandRunner: () => ({ status: scenario === 'failed' ? 7 : 0, stdout: '', stderr: '' }),
        log: () => {}, error: () => {},
      });
      assert.equal(result.ok, scenario !== 'failed');
      const proof = readActiveVerificationProof(command, root, { configuration });
      assert.equal(proof.ok, scenario === 'green');
      if (scenario === 'green') {
        const previous = process.cwd();
        try { process.chdir(root); assert.equal((await runWorkflow(['all'], { configuration, log: () => {} })).status, 0); }
        finally { process.chdir(previous); }
        assert.equal(fs.existsSync(path.join(root, '.git/all-runs')), false, 'zero redundant verifier invocations');
        let reviewRuns = 0;
        const review = await runPreReviewGate('task-2740', root, { configuration, resolveEffectiveAreaFn: () => 'all',
          runFn: () => { reviewRuns++; return { status: 7, signal: null, stdout: '', stderr: '' }; },
          log: () => {}, error: () => {},
        });
        assert.equal(review.ok, true);
        assert.equal(reviewRuns, 0, 'review also reuses integration evidence');
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

for (const scenario of ['bookkeeping', 'source', 'test', 'config', 'manifest', 'dirty', 'malformed', 'partial-record',
  'failed-record', 'toolchain', 'git-failure', 'failed-retry', 'partial-retry', 'mid-gate-change', 'foreign-scope']) {
  test('integration-backed verification invalidation: ' + scenario + ' (TASK-2740)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-invalidation-'));
    try {
      const command = 'printf x >> .git/all-runs; exit 7';
      const gates = ['docs', 'build', 'unit'].map((key, order) => ({ key, order, command: 'true' }));
      const config = { adapters: { verification: { command, defaultArea: 'all', integrationCoverage: {
        command, checks: { docs: ['docs'], build: ['build'], unit: ['unit'] },
      } }, gates: { preIntegration: gates } } };
      const repo = initCommittedRepository(root, { 'workflow.config.json': JSON.stringify(config), 'src/input.ts': 'export const value = 1;\n' });
      const options = { slug: 'task-2740', checkoutPath: root, verificationEvidence: createIntegrationVerificationEvidencePort(), log: () => {}, error: () => {},
        commandRunner: () => ({ status: 0, stdout: '', stderr: '' }) } satisfies NonNullable<Parameters<typeof runPhaseGates>[1]>;
      assert.equal((await runPhaseGates('integration', options)).ok, true);
      const file = path.join(root, '.git/integration-verification-proof.json');
      const original = fs.readFileSync(file, 'utf8');
      if (['bookkeeping', 'source', 'test', 'config', 'manifest'].includes(scenario)) {
        const changed = { bookkeeping: 'backlog/tasks/task.md', source: 'src/input.ts', test: 'test/input.test.ts',
          config: 'workflow.config.json', manifest: 'package.json' }[scenario]!;
        fs.mkdirSync(path.dirname(path.join(root, changed)), { recursive: true });
        fs.writeFileSync(path.join(root, changed), scenario === 'config' ? JSON.stringify({ ...config, product: { name: 'changed' } }) : 'changed\n');
        repo.git('add', '.'); repo.git('commit', '-m', scenario);
      } else if (scenario === 'dirty') {
        fs.appendFileSync(path.join(root, 'src/input.ts'), '// dirty\n');
      } else if (scenario === 'malformed') { fs.writeFileSync(file, '{'); }
      else if (scenario === 'git-failure') {
        // A well-shaped but unavailable revision forces the real diff boundary to fail.
        const proof = JSON.parse(original); proof.verifiedCommit = proof.coveredCommit = 'a'.repeat(40);
        fs.writeFileSync(file, JSON.stringify(proof));
      } else if (['partial-record', 'failed-record', 'toolchain', 'foreign-scope'].includes(scenario)) {
        const proof = JSON.parse(original);
        if (scenario === 'partial-record') { proof.outcomes.pop(); }
        if (scenario === 'failed-record') { proof.outcomes[0].exitCode = 7; }
        if (scenario === 'toolchain') { proof.toolchain = 'changed'; }
        if (scenario === 'foreign-scope') { proof.scope = 'another-mission'; }
        fs.writeFileSync(file, JSON.stringify(proof));
      } else if (scenario === 'failed-retry') {
        assert.equal((await runPhaseGates('integration', { ...options,
          commandRunner: () => ({ status: 9, stdout: '', stderr: '' }) })).ok, false);
      } else if (scenario === 'partial-retry') {
        assert.equal((await runPhaseGates('integration', { ...options, gates: gates.slice(0, 2) })).ok, true);
      } else if (scenario === 'mid-gate-change') {
        await runPhaseGates('integration', { ...options, commandRunner: () => {
          fs.appendFileSync(path.join(root, 'src/input.ts'), '// changed while running\n');
          return { status: 0, stdout: '', stderr: '' };
        } });
      }
      const reusable = readActiveVerificationProof(command, root);
      assert.equal(reusable.ok, scenario === 'bookkeeping');
      const output: string[] = [];
      const previous = process.cwd();
      try {
        process.chdir(root);
        assert.equal((await runWorkflow(['all'], { log: line => output.push(line) })).status, scenario === 'bookkeeping' ? 0 : 7);
      } finally { process.chdir(previous); }
      const runs = path.join(root, '.git/all-runs');
      assert.equal(fs.existsSync(runs) ? fs.readFileSync(runs, 'utf8').length : 0, scenario === 'bookkeeping' ? 0 : 1);
      if (scenario === 'bookkeeping') {
        assert.match(output.join('\n'), /integration evidence.*validated [a-f0-9]+, covered [a-f0-9]+/);
        // Active evidence must not become exact publication authorization.
        let publicationRuns = 0;
        assert.equal(captureVerifiedTreeProof('all', root, { runFn: () => {
          publicationRuns++; return { signal: null,  status: 7, stdout: '', stderr: '' };
        } }).ok, false);
        assert.equal(publicationRuns, 1);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
