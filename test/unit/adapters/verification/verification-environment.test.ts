// Verification subprocesses inherit toolchains, never the invoking workflow's write fence.
import type { GitOptions } from '../../../../src/adapters/git/git.js';
import test, { mock } from 'node:test';
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';
import assert from 'node:assert/strict';
import { verificationEnvironment } from '../../../../src/adapters/config/verification-environment.js';
import { resolveConfiguration } from '../../../../src/composition/config.js';
import { inheritWorkflowAuthorization } from '../../../../src/composition/workflow-authorization.js';
import { authorizedOperationId, configureMissionWriteAuthorization } from '../../../../src/application/ports/mission-write-authorization.js';

const product = mockModule<typeof import('../../../../src/adapters/config/product-config.js')>('../../../../src/adapters/config/product-config.js', import.meta.url);
const git = mockModule<typeof import('../../../../src/adapters/git/git.js')>('../../../../src/adapters/git/git.js', import.meta.url);
await installModuleMocks();
const { buildGateEnv } = await import('../../../../src/adapters/config/repository-gates.js');
const { runVerificationGate } = await import('../../../../src/adapters/verification/verification.js');
const { buildIntegrationGateEnv } = await import('../../../../src/adapters/cli/commands/integrate-gates.js');
const { createHandoffPorts } = await import('../../../../src/adapters/cli/commands/handoff.js');
const { retainedRepairPort } = await import('../../../../src/adapters/review/retained-repair.js');
test.afterEach(() => mock.restoreAll());

const inherited = { PATH: '/toolchain/bin', HOME: '/operator', NODE_OPTIONS: '--max-old-space-size=1024',
  PARALLIX_WORKFLOW_OPERATION: 'parent-workflow', PARALLIX_WORKFLOW_GENERATION: '3' };

test('retained repair verification isolates its write fence and preserves command and failure evidence (TASK-2750)', async () => {
  mock.method(git, 'run', (bin: string, args: string[], options: GitOptions) => {
    assert.equal(bin, 'bash');
    assert.deepEqual(args, ['-lc', 'npm test']);
    assert.equal(options.cwd, '/checkout');
    assert.equal(options.stdio, 'pipe');
    assert.deepEqual(options.env, verificationEnvironment(inherited));
    return { status: 1, stdout: 'failed assertion', stderr: 'diagnostic' };
  });
  const port = retainedRepairPort('task-parent', '/checkout', {} as never, resolveConfiguration(inherited));
  const result = await port.verify('npm test', '/checkout');
  assert.equal(result.ok, false);
  assert.equal(result.command, 'npm test');
  assert.equal(typeof result.diagnostic, 'string');
  assert.match(result.diagnostic!, /failed assertion\ndiagnostic/);
});

for (const phase of ['handoff', 'review', 'integration'] as const) {
  test(`configured ${phase} verification does not inherit a workflow write fence (TASK-2750)`, () => {
    const env = buildGateEnv(phase, 'task-parent', '/checkout', inherited);
    assert.equal(env.PARALLIX_WORKFLOW_OPERATION, undefined);
    assert.equal(env.PARALLIX_WORKFLOW_GENERATION, undefined);
    assert.equal(env.PATH, inherited.PATH);
    assert.equal(env.HOME, inherited.HOME);
    assert.equal(env.NODE_OPTIONS, inherited.NODE_OPTIONS);
    assert.equal(inherited.PARALLIX_WORKFLOW_OPERATION, 'parent-workflow');
  });
}

test('verification children compose isolated services while workflow children retain fencing (TASK-2750)', () => {
  try {
    inheritWorkflowAuthorization(resolveConfiguration(verificationEnvironment(inherited)), null);
    assert.equal(authorizedOperationId(), null);
    assert.throws(() => inheritWorkflowAuthorization(resolveConfiguration(inherited), null), /unavailable/);
    assert.deepEqual(verificationEnvironment({ PATH: '/toolchain' }), { PATH: '/toolchain' });
  } finally { configureMissionWriteAuthorization(null); }
});

test('declared handoff gates keep their command and checkout without parent ownership (TASK-2750)', () => {
  const command = 'npm test -- --integration owning-suite.test.ts';
  const configuration = resolveConfiguration(inherited);
  const calls: unknown[] = [];
  mock.method(git, 'run', (bin: string, args: string[], options: GitOptions) => {
    calls.push([bin, args, options.cwd]);
    assert.deepEqual(options.env, verificationEnvironment(inherited));
    return { status: 0, stdout: '', stderr: '' };
  });
  // Application process port is backed by the injected git.run double above.
  const { spawnSync: runDeclaredGate } = createHandoffPorts(configuration).process;
  const result = runDeclaredGate('bash', ['-c', command], { cwd: '/checkout', encoding: 'utf8', stdio: 'pipe' });
  assert.equal(result.status, 0);
  assert.deepEqual(calls, [['bash', ['-c', command], '/checkout']]);
});

test('repository verification preserves command, toolchain and output mode (TASK-2750)', () => {
  mock.method(product, 'loadAdapterConfig', () => ({ verification: { command: 'verify {{area}}', defaultArea: 'all' } }));
  let calls = 0;
  const result = runVerificationGate('integration', { rootDir: '/checkout', env: inherited, stdio: 'pipe',
    runFn: (bin, args, options) => {
      calls++;
      assert.equal(bin, 'bash');
      assert.deepEqual(args, ['-c', 'verify integration']);
      assert.ok(options);
      assert.equal(options.cwd, '/checkout');
      assert.equal(options.stdio, 'pipe');
      assert.deepEqual(options.env, verificationEnvironment(inherited));
      return { status: 7, stdout: '', stderr: 'gate failed' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 7, 'failure still propagates');
});

test('integration environment retains changed areas and dry-run policy without writer authority (TASK-2750)', () => {
  const env: NodeJS.ProcessEnv = buildIntegrationGateEnv('task-parent', { processEnv: inherited, baseWorktree: '/checkout', baseBranch: 'main', dryRun: true,
    gitRunner: () => ({ status: 0, stdout: 'test/unit/service.test.ts\n', stderr: '' }),
  });
  assert.equal(env.PARALLIX_WORKFLOW_OPERATION, undefined);
  assert.equal(env.PARALLIX_WORKFLOW_GENERATION, undefined);
  assert.equal(env.INTEGRATE_DRY_RUN, 'true');
  assert.equal(env.PARALLIX_EXECUTION_ROOT, '/checkout');
  assert.equal(env.INTEGRATE_CHANGED_AREAS, 'workflow');
  assert.equal(env.PATH, inherited.PATH);
});
