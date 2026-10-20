// Split by proof contract; preserves assertions and isolation from verification-proof-reuse.
import childProcess from 'child_process';
import fs from 'fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'os';
import path from 'path';
import { verifyActiveUnits } from '../../../scripts/verify-active-units.js';
import { readRebaseCompletions } from '../../../src/adapters/git/rebase-completion-recorder.js';
import {
  readReusableVerificationProof,
  writeReusableVerificationProof,
} from '../../../src/adapters/verification/verification.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { initCommittedRepository } from '../../fixtures/git-repository.js';

function withTempDir(fn: (_arg0: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-2413-proof-'));
  try { fn(dir); } finally {
    fs.rmSync(`${dir}.verification-proof.json`, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const proofPath = (root: string) => `${root}.verification-proof.json`;

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
