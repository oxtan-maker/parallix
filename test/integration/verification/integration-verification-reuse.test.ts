// Split by proof contract; preserves assertions and isolation from verification-proof-reuse.
import childProcess from 'child_process';
import fs from 'fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'os';
import path from 'path';
import { runPhaseGates } from '../../../src/adapters/config/repository-gates.js';
import { runPreReviewGate } from '../../../src/adapters/review/review-gate-handling.js';
import { readActiveVerificationProof } from '../../../src/adapters/verification/active-verification-proof.js';
import { createIntegrationVerificationEvidencePort, readIntegrationGateRun } from '../../../src/adapters/verification/integration-verification-proof.js';
import runWorkflow, {
  captureVerifiedTreeProof,
} from '../../../src/adapters/verification/verification.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { initCommittedRepository } from '../../fixtures/git-repository.js';
import { bookkeepingCommitMessage } from '../../../src/domain/approval-coverage.js';

test('real gate receipt currency accepts direct equivalence and a recorded rebase plus version hook only (TASK-2867.09)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-receipt-equivalence-'));
  try {
    const manifests = (version: string, dependency = false) => ({
      'package.json': `${JSON.stringify({ version, ...(dependency ? { dependencies: { x: '2' } } : {}) }, null, 2)}\n`,
      'package-lock.json': `${JSON.stringify({ version, packages: { '': { version } } }, null, 2)}\n`,
    });
    const repo = initCommittedRepository(root, { ...manifests('1.0.0'), 'src/input.ts': 'export const value = 1;\n' });
    repo.git('checkout', '-b', 'mission');
    const gates = [{ key: 'unit', order: 1, command: 'true' }];
    assert.equal((await runPhaseGates('integration', { slug: 'task-2867.09', checkoutPath: root, gates,
      verificationEvidence: createIntegrationVerificationEvidencePort(),
      commandRunner: () => ({ status: 0, stdout: '', stderr: '' }), log: () => {}, error: () => {} })).ok, true);
    const original = readIntegrationGateRun(root);
    assert.equal(original?.current, true);
    assert.ok(original?.gateRunId);

    fs.mkdirSync(path.join(root, 'backlog/tasks'), { recursive: true });
    fs.writeFileSync(path.join(root, 'backlog/tasks/task.md'), 'status: review\n');
    repo.git('add', '.');
    repo.git('commit', '-m', 'record task');
    assert.equal(readIntegrationGateRun(root)?.current, true, 'Backlog-only movement is directly equivalent');

    for (const [file, text] of Object.entries(manifests('1.0.1'))) { fs.writeFileSync(path.join(root, file), text); }
    repo.git('add', '.');
    repo.git('commit', '-m', bookkeepingCommitMessage('release hook', 'pre-commit-hook'));
    assert.equal(readIntegrationGateRun(root)?.current, true, 'the genuine tagged version hook is directly equivalent');

    repo.git('checkout', 'main');
    fs.writeFileSync(path.join(root, 'src/upstream.ts'), 'export const upstream = true;\n');
    repo.git('add', '.');
    repo.git('commit', '-m', 'upstream source');
    repo.git('checkout', 'mission');
    repo.git('rebase', 'main');
    for (const [file, text] of Object.entries(manifests('1.0.2'))) { fs.writeFileSync(path.join(root, file), text); }
    repo.git('add', '.');
    repo.git('commit', '-m', bookkeepingCommitMessage('release hook after rebase', 'pre-commit-hook'));
    const carried = readIntegrationGateRun(root);
    assert.equal(carried?.current, false, 'substantive rebased inputs use recorded lineage, not direct equivalence');
    assert.equal(carried?.carried?.length, 1, 'the hook after the completed rebase keeps the lineage connected');
    assert.equal(carried?.gateRunId, original.gateRunId, 'the original run identity survives every equivalent move');

    for (const [file, text] of Object.entries(manifests('1.0.3', true))) { fs.writeFileSync(path.join(root, file), text); }
    repo.git('add', '.');
    repo.git('commit', '-m', bookkeepingCommitMessage('substantive manifest edit', 'pre-commit-hook'));
    const substantive = readIntegrationGateRun(root);
    assert.equal(substantive?.current, false);
    assert.equal(substantive?.carried, null, 'dependency movement after the carried candidate requires fresh gates');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

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

test('integration-backed verification and gate runs survive completed rebases with upstream changes, a terminal conflict resolution and a chain (PX-0048)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-rebase-carry-'));
  try {
    const command = 'printf x >> .git/all-runs; exit 7';
    const gates = ['docs', 'build', 'unit'].map((key, order) => ({ key, order, command: 'true' }));
    const config = { adapters: { verification: { command, defaultArea: 'all', integrationCoverage: {
      command, checks: { docs: ['docs'], build: ['build'], unit: ['unit'] } } }, gates: { preIntegration: gates } } };
    const repo = initCommittedRepository(root, { 'workflow.config.json': JSON.stringify(config), 'src/input.ts': 'export const value = 1;\n' });
    repo.git('checkout', '-b', 'mission');
    fs.writeFileSync(path.join(root, 'src/input.ts'), 'export const value = 2;\n');
    repo.git('commit', '-am', 'mission change');
    const validated = repo.git('rev-parse', 'HEAD').trim();
    let executions = 0;
    assert.equal((await runPhaseGates('integration', { slug: 'px-0048', checkoutPath: root, gates, verificationEvidence: createIntegrationVerificationEvidencePort(),
      commandRunner: () => { executions++; return { status: 0, stdout: '', stderr: '' }; }, log: () => {}, error: () => {} })).ok, true);
    const file = path.join(root, '.git/integration-verification-proof.json');
    const original = fs.readFileSync(file, 'utf8');
    const upstream = (files: Record<string, string>) => {
      repo.git('checkout', 'main');
      for (const [name, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text);
      }
      repo.git('add', '.'); repo.git('commit', '-m', 'upstream'); repo.git('checkout', 'mission');
    };
    upstream({ 'src/input.ts': 'export const value = 9;\n', 'package.json': '{}\n', 'workflow.config.json': JSON.stringify({ ...config, product: { name: 'upstream' } }) });
    assert.notEqual(childProcess.spawnSync('git', ['rebase', 'main'], { cwd: root, encoding: 'utf8' }).status, 0, 'conflict pauses the rebase');
    assert.equal(readIntegrationGateRun(root)?.carried ?? null, null, 'an unfinished rebase establishes no lineage');
    fs.writeFileSync(path.join(root, 'src/input.ts'), 'export const value = 3; // resolved in a terminal\n');
    repo.git('add', '.'); repo.git('-c', 'core.editor=true', 'rebase', '--continue');
    upstream({ 'test/upstream.test.ts': 'upstream\n' });
    repo.git('rebase', 'main');
    const head = repo.git('rev-parse', 'HEAD').trim();
    const reused = readActiveVerificationProof(command, root);
    assert.equal(reused.ok, true, 'chained completed rebases carry the integration evidence');
    assert.match(reused.ok ? reused.diagnostic : '', new RegExp(`validated ${validated}, covered ${head} after 2 completed rebase`));
    const output: string[] = [];
    const previous = process.cwd();
    try { process.chdir(root); assert.equal((await runWorkflow(['all'], { log: line => output.push(line) })).status, 0); }
    finally { process.chdir(previous); }
    assert.equal(fs.existsSync(path.join(root, '.git/all-runs')), false, 'no verifier rerun');
    assert.equal(fs.readFileSync(file, 'utf8'), original, 'original execution evidence is not rewritten');
    const run = readIntegrationGateRun(root);
    assert.equal(run?.current, false);
    assert.equal(run?.revision, validated, 'the run keeps its executed revision');
    assert.equal(run?.carried?.length, 2);
    assert.equal(executions, 3, 'reuse is not a new execution');
    let publicationRuns = 0;
    assert.equal(captureVerifiedTreeProof('all', root, { runFn: () => { publicationRuns++; return { signal: null, status: 7, stdout: '', stderr: '' }; } }).ok, false);
    assert.equal(publicationRuns, 1, 'formal publication still verifies the exact rebased candidate');
    fs.writeFileSync(path.join(root, 'src/input.ts'), 'export const value = 4;\n');
    repo.git('commit', '-am', 'new implementation');
    assert.equal(readActiveVerificationProof(command, root).ok, false, 'an edit outside a completed rebase needs fresh verification');
    assert.equal(readIntegrationGateRun(root)?.carried ?? null, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
