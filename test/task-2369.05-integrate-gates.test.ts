// TASK-2369.05 — integration gate helpers now live in `integrate-gates.ts`.
//
// The extraction risk is the boundary, not the gate logic (that stays covered
// by test/integration-pipelines.test.ts): `integrate.ts` must re-export the
// exact function objects the new module owns rather than keeping a second
// implementation, and the gate-plan helpers must behave identically when
// called directly on the new module. Hermetic: the git runner is injected and
// the config is a fixture, so no worktree, Forgejo, or agent is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as gates from '../src/adapters/cli/commands/integrate-gates.js';
import * as integrate from '../src/adapters/cli/commands/integrate.js';

const OWNED = [
  'getIntegrationConfigPath',
  'detectChangedAreas',
  'isIntendedPayloadAtHead',
  'parseFilesToAreas',
  'orderIntegrationGates',
  'gateMatchesChangedAreas',
  'loadIntegrationConfig',
  'getIntegrationGatePlan',
  'printIntegrationGatePlan',
  'buildIntegrationGateEnv',
  'captureFinalIntegrationTree',
  'resolveIntegrationVerificationWorktree',
  'buildIntegrationVerificationInvocation',
  'executeIntegrationGates'
] as const;

const REEXPORTED = OWNED.filter(name => name !== 'getIntegrationConfigPath');

const INTEGRATE_SOURCE = path.join(import.meta.dirname, '..', 'src', 'adapters', 'cli', 'commands', 'integrate.ts');

test('integrate re-exports the extracted gate helpers as the same functions integrate-gates owns', () => {
  for (const name of REEXPORTED) {
    assert.equal(typeof (gates as any)[name], 'function', `${name} missing from integrate-gates.js`);
    assert.equal((integrate as any)[name], (gates as any)[name], `${name} is duplicated instead of re-exported`);
  }
});

test('integrate.ts keeps no second implementation of the extracted gate helpers', () => {
  const source = fs.readFileSync(INTEGRATE_SOURCE, 'utf8');
  for (const name of OWNED) {
    assert.equal(source.includes(`function ${name}(`), false, `integrate.ts still defines ${name}`);
  }
});

test('integrate-gates owns gate ordering with run_last gates sorted after the rest', () => {
  const ordered = gates.orderIntegrationGates({
    gates: {
      'web-e2e': { command: 'e2e', order: 1, run_last: true },
      workflow: { command: 'wf', order: 5 },
      server: { command: 'srv', order: 2 },
      disabled: { command: 'nope', order: 0, enabled: false }
    }
  });
  assert.deepEqual(ordered.map(gate => gate.key), ['server', 'workflow', 'web-e2e']);
});

test('integrate-gates plans only the gates matching the mission changed areas', () => {
  const configPath = path.join(import.meta.dirname, 'fixtures', 'task-2369.05-integration-pipelines.json');
  const plan = gates.getIntegrationGatePlan('task-2369.05', {
    dryRun: true,
    configPath,
    gitRunner: () => ({ status: 0, stdout: 'server/app.ts\n', stderr: '' })
  });
  assert.deepEqual(plan.changedAreas, ['server']);
  assert.deepEqual(plan.gates.map((gate: any) => gate.key), ['server']);
});

test('integrate-gates resolves the verification worktree from the mission worktree before the conventional path', () => {
  const resolved = gates.resolveIntegrationVerificationWorktree('task-2369.05', {
    baseWorktree: '/tmp/base',
    resolveWorktreeFn: (slug: string, opts: any) => `${opts.cwd}/wt-${slug}`,
    conventionalWorktreePathFn: () => '/tmp/should-not-be-used'
  });
  assert.equal(resolved, '/tmp/base/wt-task-2369.05');
});

test('integrate-gates falls back to the conventional worktree path when the mission worktree is unresolved', () => {
  const invocation = gates.buildIntegrationVerificationInvocation('task-2369.05', {
    baseWorktree: '/tmp/base',
    resolveWorktreeFn: () => null,
    conventionalWorktreePathFn: (slug: string, base: string) => `${base}/conventional-${slug}`,
    formatVerificationCommandFn: (phase: string, cwd: string) => `verify ${phase} in ${cwd}`
  });
  assert.deepEqual(invocation, {
    command: 'verify integrate in /tmp/base/conventional-task-2369.05',
    cwd: '/tmp/base/conventional-task-2369.05'
  });
});
