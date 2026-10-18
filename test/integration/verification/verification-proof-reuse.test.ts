/**
 * TASK-2413 CP-2: verification-proof reuse and invalidation.
 *
 * Publication must consume/assert the authoritative handoff proof for an
 * unchanged tree/command/toolchain and must never authorize publication from a
 * stale or mismatched proof. These tests pin the identity mechanism
 * (`createVerificationProofIdentity` / `readReusableVerificationProof` /
 * `writeReusableVerificationProof` / `assertVerifiedTreeProof`) that publication
 * depends on.
 */
import { resolveConfiguration } from '../../../src/composition/config.js';
import test from 'node:test';
import { createIntegrationVerificationEvidencePort } from '../../../src/adapters/verification/integration-verification-proof.js';
import { runPreReviewGate } from '../../../src/adapters/review/review-gate-handling.js';
import { runPhaseGates } from '../../../src/adapters/config/repository-gates.js';
import { readActiveVerificationProof, writeActiveVerificationProof } from '../../../src/adapters/verification/active-verification-proof.js';
import { VerificationGateEvidenceReader } from '../../../src/adapters/verification/gate-evidence-reader.js';
import { recoveryEvidenceFileSystem } from '../../../src/adapters/filesystem/recovery-evidence-fs.js';
import { captureRecoveryEvidence } from '../../../src/application/recovery-evidence.js';
import { missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { verifyActiveUnits } from '../../../scripts/verify-active-units.js';
import { readRebaseCompletions } from '../../../src/adapters/git/rebase-completion-recorder.js';
import assert from 'node:assert/strict';
import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initCommittedRepository } from '../../fixtures/git-repository.js';
import runWorkflow, {
  createVerificationProofIdentity,
  readReusableVerificationProof,
  writeReusableVerificationProof,
  captureVerifiedTreeProof,
  assertVerifiedTreeProof,
  readPublishedTreeState,
} from '../../../src/adapters/verification/verification.js';

function withTempDir(fn: (_arg0: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-2413-proof-'));
  try { fn(dir); } finally {
    fs.rmSync(`${dir}.verification-proof.json`, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const proofPath = (root: string) => `${root}.verification-proof.json`;

test('verify command executes once and reuses the active proof (TASK-2715)', () => {
  withTempDir((root) => {
    const marker = path.join(root, '.git', 'verification-runs');
    initCommittedRepository(root, {
      'workflow.config.json': JSON.stringify({ adapters: {
        verification: { command: 'printf x >> .git/verification-runs', defaultArea: 'all' },
      } }),
    });
    const previous = process.cwd();
    const configuration = resolveConfiguration({ ...process.env, PARALLIX_HOME: path.join(root, '.git', 'home') });
    const messages: string[] = [];
    try {
      process.chdir(root);
      assert.equal(runWorkflow([], { configuration, log: message => messages.push(message) }).status, 0);
      assert.equal(runWorkflow([], { configuration, log: message => messages.push(message) }).status, 0);
      assert.equal(fs.readFileSync(marker, 'utf8'), 'x');
      assert.ok(messages.includes('Active/review verification: reused successful proof.'));
      fs.writeFileSync(path.join(root, 'source.ts'), 'export const changed = true;\n');
      childProcess.execFileSync('git', ['add', '.']);
      childProcess.execFileSync('git', ['commit', '-m', 'change verification inputs']);
      assert.equal(runWorkflow(['all'], { configuration, log: message => messages.push(message) }).status, 0);
      assert.equal(fs.readFileSync(marker, 'utf8'), 'xx');
    } finally { process.chdir(previous); }
  });
});

test('task-2413: unchanged tree/command/toolchain reuses authoritative proof without re-verification', { concurrency: false }, () => {
  withTempDir((root) => {
    initCommittedRepository(root);
    const command = './scripts/verify-local.sh all';
    const written = writeReusableVerificationProof(command, root, { proofPath: proofPath(root) });
    assert.equal(written.ok, true);

    // The handoff proof is authoritative and reusable for the identical inputs.
    const reused = readReusableVerificationProof(command, root, { proofPath: proofPath(root) });
    assert.equal(reused.ok, true, 'identical command reuses the proof');
    assert.equal(reused.proof!.command, command);
    assert.equal(reused.proof!.status, 'passed');
    assert.ok(written.proof != null);
    assert.equal(reused.proof!.inputFingerprint, written.proof.inputFingerprint);
    assert.equal(reused.proof!.toolchain, written.proof.toolchain);

    // Publication asserts the unchanged tree authorises the publish using the
    // HEAD/tree identity captured by captureVerifiedTreeProof.
    const state = readPublishedTreeState(root);
    assert.equal(state.ok, true);
    const assertOk = assertVerifiedTreeProof({
      rootDir: fs.realpathSync(root),
      commit: state.commit,
      tree: state.tree,
    }, root);
    assert.equal(assertOk.ok, true, 'assertVerifiedTreeProof authorises the unchanged tree');
  });
});

test('task-2413: changing HEAD/tree invalidates proof reuse', { concurrency: false }, () => {
  withTempDir((root) => {
    initCommittedRepository(root);
    const command = './scripts/verify-local.sh all';
    const written = writeReusableVerificationProof(command, root, { proofPath: proofPath(root) });
    assert.equal(written.ok, true);

    // A new commit changes HEAD/tree; reuse must fail closed.
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'change.js'), 'x');
    const add = childProcess.spawnSync('git', ['-C', root, 'add', 'src/change.js'], { encoding: 'utf8' });
    assert.equal(add.status, 0);
    const commit = childProcess.spawnSync('git', ['-C', root, 'commit', '-m', 'change tree'], { encoding: 'utf8' });
    assert.equal(commit.status, 0);

    const reused = readReusableVerificationProof(command, root, { proofPath: proofPath(root) });
    assert.equal(reused.ok, false, 'a changed tree must not reuse the proof');
  });
});

test('task-2413: changing HEAD alone invalidates proof reuse', { concurrency: false }, () => {
  withTempDir((root) => {
    initCommittedRepository(root);
    const command = './scripts/verify-local.sh all';
    assert.equal(writeReusableVerificationProof(command, root, { proofPath: proofPath(root) }).ok, true);

    const commit = childProcess.spawnSync('git', ['-C', root, 'commit', '--allow-empty', '-m', 'new head'], { encoding: 'utf8' });
    assert.equal(commit.status, 0, commit.stderr);
    assert.equal(readReusableVerificationProof(command, root, { proofPath: proofPath(root) }).ok, false);
  });
});

test('task-2413: publication consumes an unchanged reusable proof without executing the gate', { concurrency: false }, () => {
  withTempDir((root) => {
    initCommittedRepository(root);
    const command = 'exit 9';
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { verification: { command, defaultArea: 'all' } },
    }));
    assert.equal(childProcess.spawnSync('git', ['-C', root, 'add', 'workflow.config.json']).status, 0);
    assert.equal(childProcess.spawnSync('git', ['-C', root, 'commit', '-m', 'configure gate']).status, 0);
    assert.equal(writeReusableVerificationProof(command, root, { proofPath: proofPath(root) }).ok, true);

    let executions = 0;
    const result = captureVerifiedTreeProof('all', root, {
      proofPath: proofPath(root), runFn: () => { executions++; return { signal: null,  status: 9, stdout: '', stderr: '' }; },
    });
    assert.equal(result.ok, true);
    assert.equal(executions, 0, 'publication must consume the handoff proof instead of executing the same gate');
  });
});

test('task-2413: publication reuse matches the handoff command after area placeholder resolution', { concurrency: false }, () => {
  withTempDir((root) => {
    initCommittedRepository(root);
    const template = './scripts/verify-local.sh {{area}}';
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { verification: { command: template, defaultArea: 'all' } },
    }));
    assert.equal(childProcess.spawnSync('git', ['-C', root, 'add', 'workflow.config.json']).status, 0);
    assert.equal(childProcess.spawnSync('git', ['-C', root, 'commit', '-m', 'placeholder command']).status, 0);
    const command = './scripts/verify-local.sh all';
    assert.equal(writeReusableVerificationProof(command, root, { proofPath: proofPath(root) }).ok, true);
    let executions = 0;
    const result = captureVerifiedTreeProof('all', root, {
      proofPath: proofPath(root), runFn: () => { executions++; return { signal: null,  status: 9, stdout: '', stderr: '' }; },
    });
    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(result.proof?.command, command);
    assert.equal(executions, 0);
  });
});

test('task-2413: changing the verification command invalidates proof reuse', { concurrency: false }, () => {
  withTempDir((root) => {
    initCommittedRepository(root);
    const written = writeReusableVerificationProof('./scripts/verify-local.sh all', root, { proofPath: proofPath(root) });
    assert.equal(written.ok, true);
    const reused = readReusableVerificationProof('./scripts/verify-local.sh static-analysis', root, { proofPath: proofPath(root) });
    assert.equal(reused.ok, false, 'a different command must not reuse the proof');
  });
});

test('task-2573: proof context is exact and cannot cross phase, mission, or checkout', { concurrency: false }, () => {
  withTempDir((root) => {
    initCommittedRepository(root);
    const command = 'true';
    const context = JSON.stringify({ phase: 'integration', slug: 'task-1', checkoutPath: root, gate: 'verify' });
    assert.equal(writeReusableVerificationProof(command, root, { proofPath: proofPath(root), context }).ok, true);
    assert.equal(readReusableVerificationProof(command, root, { proofPath: proofPath(root), context }).ok, true);
    for (const changed of [
      JSON.stringify({ phase: 'review', slug: 'task-1', checkoutPath: root, gate: 'verify' }),
      JSON.stringify({ phase: 'integration', slug: 'task-2', checkoutPath: root, gate: 'verify' }),
      JSON.stringify({ phase: 'integration', slug: 'task-1', checkoutPath: '/other', gate: 'verify' }),
    ]) {
      assert.equal(readReusableVerificationProof(command, root, { proofPath: proofPath(root), context: changed }).ok, false);
    }
  });
});

test('task-2413: a stale/mismatched proof cannot authorize publication', { concurrency: false }, () => {
  withTempDir((root) => {
    initCommittedRepository(root);
    const state = readPublishedTreeState(root);
    assert.equal(state.ok, true);

    // A proof captured from a *different* checkout must not authorise this tree.
    const foreign = { rootDir: '/some/other/checkout', commit: 'deadbeef', tree: 'foreigntree' };
    const assertForeign = assertVerifiedTreeProof(foreign, root);
    assert.equal(assertForeign.ok, false);
    assert.match(assertForeign.error || '', /different checkout/);

    // A proof whose commit no longer matches the current HEAD must not authorise.
    const staleCommit = { rootDir: fs.realpathSync(root), commit: '000000', tree: state.tree! };
    const assertStale = assertVerifiedTreeProof(staleCommit, root);
    assert.equal(assertStale.ok, false);
    assert.match(assertStale.error || '', /does not match the tree being published/);

    // Missing proof must not authorise.
    // @ts-expect-error Intentional missing proof must fail closed at the adapter boundary.
    const assertMissing = assertVerifiedTreeProof(null, root);
    assert.equal(assertMissing.ok, false);
    assert.match(assertMissing.error || '', /missing verification proof/);
  });
});

test('task-2413: a dirty worktree cannot issue a reusable proof (fails closed)', { concurrency: false }, () => {
  withTempDir((root) => {
    initCommittedRepository(root);
    fs.writeFileSync(path.join(root, 'README.md'), 'dirty\n');
    const identity = createVerificationProofIdentity('./scripts/verify-local.sh all', root);
    assert.equal(identity.ok, false);
    assert.match(identity.error || '', /dirty worktree/);
  });
});

// Real Git, isolated proof state, doubled units: ADR 0057 integration-ci.
function activeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'active-unit-proof-'));
  const repo = initCommittedRepository(root, { 'src/input.ts': 'export const value = 1;\n' });
  return { root, repo, options: { root, proofPath: path.join(root, '.git', 'units-proof.json'), log: () => {} },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('active review runs units once across four consumers and suppresses inherited coverage (TASK-2715)', () => {
  const fixture = activeFixture();
  try {
    let executions = 0;
    const runUnits = (_command: string, env: NodeJS.ProcessEnv) => {
      executions++;
      assert.equal(env.PARALLIX_TEST_COVERAGE, '0');
      assert.equal(env.NODE_V8_COVERAGE, undefined);
      assert.equal(env.NODE_OPTIONS, undefined);
      assert.equal(env.PARALLIX_FAST_UNIT, '1');
      return 0;
    };
    const options = { ...fixture.options, runUnits, env: { ...process.env,
      PARALLIX_TEST_COVERAGE: 'true', NODE_V8_COVERAGE: '/tmp/coverage', NODE_OPTIONS: '--experimental-test-coverage' } };
    for (const phase of ['implementer', 'autonomous preparation', 'handoff', 'reviewer']) {
      assert.equal(verifyActiveUnits(options), 0, phase);
    }
    assert.equal(executions, 1);
    assert.equal(fs.existsSync(path.join(fixture.root, 'coverage')), false);
  } finally { fixture.cleanup(); }
});

for (const input of ['src/input.ts', 'test/input.test.ts']) {
test('active review changed ' + input + ' invalidates successful units (TASK-2715)', () => {
  const fixture = activeFixture();
  try {
    let executions = 0;
    const options = { ...fixture.options, runUnits: () => { executions++; return 0; } } satisfies NonNullable<Parameters<typeof verifyActiveUnits>[0]>;
    assert.equal(verifyActiveUnits(options), 0);
    fs.mkdirSync(path.dirname(path.join(fixture.root, input)), { recursive: true });
    fs.writeFileSync(path.join(fixture.root, input), 'export const value = 2;\\n');
    fixture.repo.git('add', '.'); fixture.repo.git('commit', '-m', 'repair');
    assert.equal(verifyActiveUnits(options), 0);
    assert.equal(executions, 2);
  } finally { fixture.cleanup(); }
});
}

test('active review failed units issue no proof and may retry successfully (TASK-2715)', () => {
  const fixture = activeFixture();
  try {
    let executions = 0;
    let fail = true;
    const options = { ...fixture.options, runUnits: () => { executions++; return fail ? 7 : 0; } } satisfies NonNullable<Parameters<typeof verifyActiveUnits>[0]>;
    assert.equal(verifyActiveUnits(options), 7);
    assert.equal(verifyActiveUnits(options), 7);
    fail = false;
    assert.equal(verifyActiveUnits(options), 0);
    assert.equal(verifyActiveUnits(options), 0);
    assert.equal(executions, 3);
  } finally { fixture.cleanup(); }
});

test('active units survive Backlog-only commits and SHA changes but rerun for verification inputs (TASK-2715)', () => {
  const fixture = activeFixture();
  try {
    let executions = 0;
    const options = { ...fixture.options, runUnits: () => { executions++; return 0; } } satisfies NonNullable<Parameters<typeof verifyActiveUnits>[0]>;
    assert.equal(verifyActiveUnits(options), 0);
    for (const input of ['backlog/tasks/mission.md', 'backlog/completed/mission.md']) {
      fs.mkdirSync(path.dirname(path.join(fixture.root, input)), { recursive: true });
      fs.writeFileSync(path.join(fixture.root, input), 'status: review\n');
      fixture.repo.git('add', '.'); fixture.repo.git('commit', '-m', 'bookkeeping');
      assert.equal(verifyActiveUnits(options), 0);
      assert.equal(executions, 1, input);
    }
    fixture.repo.git('commit', '--amend', '-m', 'rebased bookkeeping');
    assert.equal(verifyActiveUnits(options), 0);
    assert.equal(executions, 1, 'SHA-only changes preserve the unit inputs');
    fs.writeFileSync(path.join(fixture.root, 'workflow.config.json'), '{}\n');
    fixture.repo.git('add', '.'); fixture.repo.git('commit', '-m', 'verification configuration');
    assert.equal(verifyActiveUnits(options), 0);
    assert.equal(executions, 2, 'configuration is a verification input');
  } finally { fixture.cleanup(); }
});

test('active units survive upstream source rebases but invalidate changed mission edits (TASK-2715)', () => {
  const fixture = activeFixture();
  try {
    const input = path.join(fixture.root, 'src/input.ts');
    const baseline = Array.from({ length: 20 }, (_, index) => `// context ${index}\n`).join('') + 'export const value = 1;\n';
    fs.writeFileSync(input, baseline);
    fixture.repo.git('add', '.'); fixture.repo.git('commit', '-m', 'baseline');
    fixture.repo.git('checkout', '-b', 'mission/rebase-cache');
    fs.writeFileSync(input, baseline.replace('value = 1', 'value = 2'));
    fixture.repo.git('add', '.'); fixture.repo.git('commit', '-m', 'mission edit');
    let executions = 0;
    const options = { ...fixture.options, runUnits: () => { executions++; return 0; } } satisfies NonNullable<Parameters<typeof verifyActiveUnits>[0]>;
    assert.equal(verifyActiveUnits(options), 0);
    fixture.repo.git('checkout', 'main');
    fs.writeFileSync(input, '// upstream insertion\n' + baseline);
    fixture.repo.git('add', '.'); fixture.repo.git('commit', '-m', 'upstream edit');
    fixture.repo.git('checkout', 'mission/rebase-cache');
    fixture.repo.git('rebase', 'main');
    assert.equal(verifyActiveUnits(options), 0);
    assert.equal(executions, 1, 'upstream changes and shifted hunk positions are deferred to covered integration');
    fs.writeFileSync(input, fs.readFileSync(input, 'utf8').replace('value = 2', 'value = 3'));
    fixture.repo.git('add', '.'); fixture.repo.git('commit', '-m', 'repair');
    assert.equal(verifyActiveUnits(options), 0);
    assert.equal(executions, 2, 'a changed mission patch still invalidates units');
  } finally { fixture.cleanup(); }
});

for (const outcome of ['continue', 'abort'] as const) {
test(`terminal-resolved rebase ${outcome} has structured cache evidence (TASK-2715)`, () => {
  const fixture = activeFixture();
  try {
    const hooks = path.join(fixture.root, '.git', "original hooks's");
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, 'post-rewrite'), '#!/bin/sh\nprintf "%s\\n" "$1" > "$(git rev-parse --git-path original-rewrite-kind)"\ncat > "$(git rev-parse --git-path original-rewrite-input)"\n', { mode: 0o700 });
    fixture.repo.git('config', 'core.hooksPath', hooks);
    fixture.repo.git('checkout', '-b', 'mission/terminal-rebase');
    const input = path.join(fixture.root, 'src/input.ts');
    fs.writeFileSync(input, 'export const value = 2;\n');
    fixture.repo.git('add', '.'); fixture.repo.git('commit', '-m', 'mission');
    let executions = 0;
    const options = { ...fixture.options, runUnits: () => { executions++; return 0; } } satisfies NonNullable<Parameters<typeof verifyActiveUnits>[0]>;
    assert.equal(verifyActiveUnits(options), 0);
    const coveredBefore = JSON.parse(fs.readFileSync(options.proofPath, 'utf8')).coveredCommit;
    // Hooks added after installation are also forwarded by the overlay.
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nprintf x >> "$(git rev-parse --git-path original-pre-commit)"\n', { mode: 0o700 });
    fixture.repo.git('checkout', 'main');
    fs.writeFileSync(input, 'export const value = 99;\n');
    fixture.repo.git('add', '.'); fixture.repo.git('commit', '-m', 'upstream conflict');
    fixture.repo.git('checkout', 'mission/terminal-rebase');
    const paused = childProcess.spawnSync('git', ['rebase', 'main'], { cwd: fixture.root, encoding: 'utf8' });
    assert.notEqual(paused.status, 0);
    assert.equal(verifyActiveUnits(options), 1, 'no unit execution or cache advance while rebase is unresolved');
    assert.equal(executions, 1);
    assert.equal(readRebaseCompletions(fixture.root).length, 0);
    if (outcome === 'continue') {
      fs.writeFileSync(input, 'export const value = 3; // terminal conflict resolution\n');
      fixture.repo.git('add', '.');
      fixture.repo.git('-c', 'core.editor=true', 'rebase', '--continue');
      assert.equal(readRebaseCompletions(fixture.root).length, 1);
      assert.equal(fs.readFileSync(path.join(fixture.root, '.git/original-rewrite-kind'), 'utf8'), 'rebase\n');
      assert.match(fs.readFileSync(path.join(fixture.root, '.git/original-rewrite-input'), 'utf8'), /^[a-f0-9]+ [a-f0-9]+/);
    } else {
      fixture.repo.git('rebase', '--abort');
      assert.equal(readRebaseCompletions(fixture.root).length, 0);
    }
    assert.ok(fs.readFileSync(path.join(fixture.root, '.git/original-pre-commit'), 'utf8').includes('x'));
    assert.equal(verifyActiveUnits(options), 0, 'disk evidence survives workflow restart');
    assert.equal(executions, 1);
    const carried = JSON.parse(fs.readFileSync(options.proofPath, 'utf8'));
    assert.equal(carried.verifiedCommit, coveredBefore, 'retain the revision actually tested');
    assert.equal(carried.coveredCommit, fixture.repo.git('rev-parse', 'HEAD').trim());
    fs.writeFileSync(input, 'export const value = 4; // new implementation\n');
    fixture.repo.git('add', '.'); fixture.repo.git('commit', '-m', 'new implementation');
    assert.equal(verifyActiveUnits(options), 0);
    assert.equal(executions, 2, 'ordinary implementation commits never inherit the rebase skip');
  } finally { fixture.cleanup(); }
});
}

for (const changed of ['mission', 'toolchain']) {
test('active review ' + changed + ' mismatch cannot reuse success (TASK-2715)', () => {
  const fixture = activeFixture();
  try {
    let executions = 0;
    const options = { ...fixture.options, runUnits: () => { executions++; return 0; } } satisfies NonNullable<Parameters<typeof verifyActiveUnits>[0]>;
    assert.equal(verifyActiveUnits(options), 0);
    if (changed === 'mission') fixture.repo.git('checkout', '-b', 'mission/other');
    else {
      const proof = JSON.parse(fs.readFileSync(options.proofPath, 'utf8'));
      proof.toolchain = 'foreign';
      fs.writeFileSync(options.proofPath, JSON.stringify(proof));
    }
    assert.equal(verifyActiveUnits(options), 0);
    assert.equal(executions, 2);
  } finally { fixture.cleanup(); }
});
}

test('outer handoff proof cannot cross identical checkout or mission branch (TASK-2715)', () => {
  withTempDir((root) => {
    const repo = initCommittedRepository(root);
    const artifact = path.join(root, '.git', 'proof.json');
    assert.equal(writeReusableVerificationProof('true', root, { proofPath: artifact }).ok, true);
    repo.git('checkout', '-b', 'mission/other');
    assert.equal(readReusableVerificationProof('true', root, { proofPath: artifact }).ok, false);
    repo.git('checkout', 'main');
    const clone = path.join(root, '.git', 'clone');
    assert.equal(childProcess.spawnSync('git', ['clone', root, clone]).status, 0);
    assert.equal(readReusableVerificationProof('true', clone, { proofPath: artifact }).ok, false);
  });
});

test('outer verification proof invalidates an updated effective npm launcher (TASK-2715)', () => {
  withTempDir((root) => {
    initCommittedRepository(root);
    const bin = path.join(root, '.git', 'bin');
    fs.mkdirSync(bin);
    const npm = path.join(bin, 'npm');
    fs.writeFileSync(npm, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const previous = process.env.PATH;
    try {
      process.env.PATH = bin + ':' + previous;
      const artifact = path.join(root, '.git', 'proof.json');
      assert.equal(writeReusableVerificationProof('npm test', root, { proofPath: artifact, configuration: resolveConfiguration(process.env) }).ok, true);
      fs.appendFileSync(npm, '# updated launcher\n');
      assert.equal(readReusableVerificationProof('npm test', root, { proofPath: artifact, configuration: resolveConfiguration(process.env) }).ok, false);
    } finally { process.env.PATH = previous; }
  });
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
        try { process.chdir(root); assert.equal(runWorkflow(['all'], { configuration, log: () => {} }).status, 0); }
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
        assert.equal(runWorkflow(['all'], { log: line => output.push(line) }).status, scenario === 'bookkeeping' ? 0 : 7);
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

test('gate evidence reader classifies proofs, failures and validation against the checkout (TASK-2775)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-evidence-'));
  try {
    const repo = initCommittedRepository(root, {
      'src/input.ts': 'export const value = 1;\n',
      'workflow.config.json': JSON.stringify({ adapters: { gates: { preIntegration: [
        { key: 'unit', command: 'true', order: 0 }, { key: 'docs', command: 'true', order: 1 },
      ] } } }),
    });
    const command = './scripts/verify-local.sh all';
    const configuration = resolveConfiguration({ ...process.env, PARALLIX_HOME: path.join(root, '.git', 'home') });
    const scope = { repositoryId: repositoryId('task-2775-repository'), missionId: missionId('task-2775-gate') };
    const head = () => repo.git('rev-parse', 'HEAD').trim();
    const commit = (value: number) => { fs.writeFileSync(path.join(root, 'src/input.ts'), `export const value = ${value};\n`); repo.git('commit', '-am', `change ${value}`); };
    const marker = null;
    const reader = new VerificationGateEvidenceReader({ configuration, resolveWorktree: () => root, integrationValidation: async () => marker });
    const declared = async () => (await reader.readDeclaredGates(scope, [command])).gates[0];

    assert.deepEqual(await declared(), { command, proof: { state: 'absent' }, failure: null });
    // Scoping: another mission's failure lives in another store and never becomes
    // this mission's gate result, even in the same checkout.
    captureRecoveryEvidence({ command, cwd: root, capturedRevision: head(), exitCode: 4, signal: null, stdout: '', stderr: 'foreign mission', diagnostic: 'foreign mission', missionId: missionId('task-2775-foreign') }, { fs: recoveryEvidenceFileSystem });
    assert.equal((await declared()).failure, null, 'another mission\'s failure is not this mission\'s gate');
    captureRecoveryEvidence({ command, cwd: root, capturedRevision: head(), exitCode: 2, signal: null, stdout: '', stderr: 'boom', diagnostic: 'boom', missionId: scope.missionId }, { fs: recoveryEvidenceFileSystem });
    assert.equal((await declared()).failure?.state, 'current', 'a failure on HEAD is current');
    commit(2);
    assert.equal((await declared()).failure?.state, 'stale', 'a repair commit makes the failure stale');
    assert.equal(writeActiveVerificationProof(command, root, { configuration }).ok, true);
    assert.deepEqual({ proof: (await declared()).proof.state, failure: (await declared()).failure?.state }, { proof: 'current', failure: 'stale' });
    // Scoping: the proof slot belongs to this checkout's branch, so another
    // mission branch of the same repository cannot lend this one a success.
    repo.git('checkout', '-b', 'mission/task-2775-foreign');
    assert.deepEqual((await declared()).proof, { state: 'absent' }, 'a proof on another mission branch is not this checkout\'s result');
    repo.git('checkout', 'main');
    assert.equal((await declared()).proof.state, 'current', 'the same inputs on the owning branch keep the result current');
    commit(3);
    assert.equal((await declared()).proof.state, 'stale', 'changed inputs make the prior success stale');
    fs.writeFileSync(path.join(root, 'src/input.ts'), 'export const value = 4;\n');
    const dirty = await reader.readDeclaredGates(scope, [command]);
    assert.deepEqual({ clean: dirty.checkout.kind === 'present' && dirty.checkout.clean, proof: dirty.gates[0].proof.state }, { clean: false, proof: 'stale' });
    repo.git('checkout', '--', 'src/input.ts');
    captureRecoveryEvidence({ command, cwd: root, capturedRevision: head(), exitCode: 1, signal: null, stdout: '', stderr: 'publication', diagnostic: 'publication' }, { fs: recoveryEvidenceFileSystem });
    assert.equal((await declared()).failure?.state, 'current', 'publication failures captured under the worktree name count too');

    await assert.rejects(new VerificationGateEvidenceReader({ configuration, resolveWorktree: () => root, integrationValidation: null }).readIntegrationGates(scope, null), /history is unavailable/);
    await assert.rejects(new VerificationGateEvidenceReader({ configuration, resolveWorktree: () => path.join(root, 'missing'), integrationValidation: null }).readDeclaredGates(scope, [command]), /unreadable/);
    assert.deepEqual(await new VerificationGateEvidenceReader({ configuration, resolveWorktree: () => null, integrationValidation: null }).readDeclaredGates(scope, [command]), { checkout: { kind: 'absent' }, gates: [] });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


// Separate execution-observation contract keeps both cases inside the existing
// finite per-case CPU limit; proof identity assertions above stay intact.
test('gate evidence reader scopes integration execution to its owning attempt (TASK-2775)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-run-evidence-'));
  try {
    initCommittedRepository(root, { 'workflow.config.json': JSON.stringify({ adapters: { gates: { preIntegration: [
      { key: 'unit', command: 'true', order: 0 }, { key: 'docs', command: 'true', order: 1 },
    ] } } }) });
    const configuration = resolveConfiguration({ ...process.env, PARALLIX_HOME: path.join(root, '.git', 'home') });
    const scope = { repositoryId: repositoryId('task-2775-repository'), missionId: missionId('task-2775-gate') };
    let marker: { sha: string; hooks: readonly string[]; createdAt: string } | null = null;
    // The executor's own run record is the only authority for a running plan,
    // and it belongs to the attempt that started it.
    const runConfiguration = { ...configuration, runtime: { ...configuration.runtime, workflowOperation: 'op-9', workflowGeneration: 2 } };
    const runReader = new VerificationGateEvidenceReader({ configuration: runConfiguration, resolveWorktree: () => root, integrationValidation: async () => marker });
    const runGates = [{ key: 'unit', command: 'true' }, { key: 'docs', command: 'true' }];
    const run = createIntegrationVerificationEvidencePort(runConfiguration).start(root, runGates);
    if (!run) { throw new Error('a configured plan with a matching run must start observable'); }
    const running = await runReader.readIntegrationGates(scope, { id: 'op-9', generation: 2, phase: 'checking' });
    assert.equal(running.running?.attempt, 'op-9:2', 'the executor records a run for the attempt that started it');
    assert.ok(running.running?.startedAt);
    assert.equal((await runReader.readIntegrationGates(scope, { id: 'op-9', generation: 3, phase: 'checking' })).running, null, 'a superseded attempt does not own the run');
    run.complete([{ key: 'unit', command: 'true', exitCode: 0 }, { key: 'docs', command: 'true', exitCode: 1 }], 'failed');
    const settled = await runReader.readIntegrationGates(scope, { id: 'op-9', generation: 2, phase: 'checking' });
    assert.equal(settled.running, null, 'a settled run is never running');
    assert.deepEqual(settled.gates.map(gate => ({ key: gate.key, proof: gate.proof.state, exit: gate.failure?.exitCode ?? null })),
      [{ key: 'unit', proof: 'current', exit: null }, { key: 'docs', proof: 'absent', exit: 1 }], 'per-gate outcomes are observed');
    marker = { sha: settled.checkout.kind === 'present' ? settled.checkout.revision : '', hooks: ['unit', 'docs'], createdAt: new Date(Date.now() + 1).toISOString() };
    const repaired = await runReader.readIntegrationGates(scope, null);
    assert.deepEqual(repaired.gates.map(gate => gate.proof.state), ['current', 'current'], 'later validated hook coverage supersedes failed execution');
    fs.writeFileSync(path.join(root, '.git', 'integration-verification-proof.json'), '{malformed');
    await assert.rejects(runReader.readIntegrationGates(scope, null), /evidence is unreadable/);

  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('gate evidence reader preserves partial integration marker hook coverage (TASK-2775)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-marker-evidence-'));
  try {
    const repo = initCommittedRepository(root, {
      'src/input.ts': 'export const value = 1;\n',
      'workflow.config.json': JSON.stringify({ adapters: { gates: { preIntegration: [
        { key: 'unit', command: 'true', order: 0 }, { key: 'docs', command: 'true', order: 1 },
      ] } } }),
    });
    const configuration = resolveConfiguration({ ...process.env, PARALLIX_HOME: path.join(root, '.git', 'home') });
    const scope = { repositoryId: repositoryId('task-2775-repository'), missionId: missionId('task-2775-gate') };
    const head = () => repo.git('rev-parse', 'HEAD').trim();
    const commit = (value: number) => { fs.writeFileSync(path.join(root, 'src/input.ts'), `export const value = ${value};\n`); repo.git('commit', '-am', `change ${value}`); };
    let marker: { sha: string; failed?: boolean; hooks: readonly string[]; createdAt: string } | null = null;
    const reader = new VerificationGateEvidenceReader({ configuration, resolveWorktree: () => root, integrationValidation: async () => marker });
    const integration = () => reader.readIntegrationGates(scope, null);
    assert.deepEqual((await integration()).configured, ['unit', 'docs']);
    assert.deepEqual((await integration()).gates, [
      { key: 'unit', proof: { state: 'absent' }, failure: null },
      { key: 'docs', proof: { state: 'absent' }, failure: null },
    ], 'a configured plan with no observed run leaves every gate unproven');
    assert.equal((await integration()).running, null);
    // A validation marker covers only the hooks it names; it never passes the plan.
    marker = { sha: head(), failed: false, hooks: ['unit'], createdAt: '2026-10-18T09:00:00.000Z' };
    assert.deepEqual((await integration()).gates, [
      { key: 'unit', proof: { state: 'current', revision: head(), observedAt: marker.createdAt }, failure: null },
      { key: 'docs', proof: { state: 'absent' }, failure: null },
    ], 'partial hook coverage stays partial');
    marker = { sha: head(), failed: true, hooks: ['unit'], createdAt: '2026-10-18T09:30:00.000Z' };
    assert.deepEqual((await integration()).gates[0].failure, { state: 'current', revision: head(), observedAt: marker.createdAt, exitCode: null });
    commit(5);
    assert.equal((await integration()).gates[0].failure?.state, 'stale', 'a marker for an earlier revision is stale');

  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Count the actual boundary, including helpers that do not use a supplied Git double.
test('board gate inputs are shared per build and refreshed on the next read (TASK-2775)', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-read-snapshot-'));
  const { syncBuiltinESMExports } = await import('node:module');
  const originalSpawn = childProcess.spawnSync;
  const originalRead = fs.readFileSync;
  try {
    const repo = initCommittedRepository(root, { 'src/input.ts': 'export const value = 1;\n' });
    const bin = path.join(root, '.git', 'bin');
    fs.mkdirSync(bin);
    const npm = path.join(bin, 'npm');
    fs.writeFileSync(npm, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const configuration = resolveConfiguration({ ...process.env, PATH: bin, PARALLIX_HOME: path.join(root, '.git', 'home') });
    assert.equal(writeActiveVerificationProof('true', root, { configuration }).ok, true);
    let calls: string[][] = [];
    let launcherReads = 0;
    t.mock.method(childProcess, 'spawnSync', (...args: Parameters<typeof originalSpawn>) => {
      if (args[0] === 'git') { calls.push(args[1] as string[]); }
      return originalSpawn(...args);
    });
    t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof originalRead>) => {
      if (args[0] === npm) { launcherReads++; }
      return originalRead(...args);
    });
    syncBuiltinESMExports();
    const second = path.join(root, '.git', 'second-checkout');
    repo.git('worktree', 'add', '-b', 'mission/second', second);
    calls = []; launcherReads = 0;
    const reader = new VerificationGateEvidenceReader({ configuration, resolveWorktree: id => id === 'task-second' ? second : root, integrationValidation: async () => null });
    const beginRead = () => (reader as import('../../../src/application/ports/gate-evidence.js').GateEvidenceReader).beginRead?.();
    const scope = { repositoryId: repositoryId('fixture'), missionId: missionId('task-fixture') };
    const read = (id = scope.missionId) => reader.readDeclaredGates({ ...scope, missionId: id }, ['true', 'false']);
    beginRead();
    for (let i = 0; i < 40; i++) {
      const result = await read(missionId(`task-fixture-${i}`));
      assert.deepEqual(result.gates.map(gate => gate.proof.state), ['current', 'absent']);
    }
    assert.ok(calls.length <= 6, `one input snapshot, not one per mission or command: ${calls.length} Git spawns`);
    assert.equal(calls.filter(args => args.includes('--porcelain')).length, 1, 'checkout and proof identity share status');
    assert.equal(launcherReads, 1, 'one toolchain hash per build');
    t.diagnostic(`40 mission reads, 2 commands, 1 worktree: ${calls.length} Git spawns and ${launcherReads} npm launcher hash`);
    assert.equal((await reader.readDeclaredGates({ ...scope, missionId: missionId('task-second') }, ['true'])).gates[0].proof.state, 'absent', 'another worktree has a separate input and proof scope');
    assert.equal(launcherReads, 1, 'the toolchain is shared across worktrees within a build');
    fs.writeFileSync(path.join(root, 'src/input.ts'), 'export const value = 2;\n');
    calls = []; launcherReads = 0;
    beginRead();
    assert.equal((await read()).gates[0].proof.state, 'stale', 'a new build observes dirty inputs');
    assert.equal(calls.filter(args => args.includes('--porcelain')).length, 1);
    assert.equal(launcherReads, 1);
    // A clean new revision, branch and launcher must not inherit the cached identity.
    repo.git('commit', '-am', 'changed input');
    calls = [];
    beginRead();
    for (let i = 0; i < 40; i++) { assert.equal((await read()).gates[0].proof.state, 'stale'); }
    assert.ok(calls.length <= 6, 'stale proof classification also shares its rebase metadata reads');
    repo.git('checkout', '-b', 'mission/other');
    beginRead();
    assert.equal((await read()).gates[0].proof.state, 'absent');
    repo.git('checkout', 'main');
    fs.appendFileSync(npm, '# changed launcher\n');
    beginRead();
    assert.equal((await read()).gates[0].proof.state, 'absent', 'toolchain cache expires with the build');
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime board benchmark counts the real gate read boundary (TASK-2775)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-read-benchmark-'));
  try {
    initCommittedRepository(root);
    const { boardBuild } = await import('../../../scripts/benchmark-runtime.js');
    const one = await boardBuild(1, root);
    const forty = await boardBuild(40, root);
    assert.ok(one > 0, 'the benchmark must execute Git instead of stubbing observeGate');
    assert.equal(forty, one, 'shared-checkout gate work is bounded per build');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
