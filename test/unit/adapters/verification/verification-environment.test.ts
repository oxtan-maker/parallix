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
const { createReviewPreparationPorts } = await import('../../../../src/adapters/cli/commands/review-preparation.js');
const { retainedRepairPort } = await import('../../../../src/adapters/review/retained-repair.js');
test.afterEach(() => mock.restoreAll());

const inherited = { PATH: '/toolchain/bin', HOME: '/operator', NODE_OPTIONS: '--max-old-space-size=1024',
  PARALLIX_WORKFLOW_OPERATION: 'parent-workflow', PARALLIX_WORKFLOW_GENERATION: '3' };

test('retained repair verification isolates its write fence and preserves command and failure evidence (TASK-2750)', async () => {
  // Output capture belongs to runToExit, which returns when the check itself exits (TASK-2806).
  mock.method(git, 'runToExit', (bin: string, args: string[], options: GitOptions) => {
    assert.equal(bin, 'bash');
    assert.deepEqual(args, ['-lc', 'npm test']);
    assert.equal(options.cwd, '/checkout');
    assert.equal(options.stdio, undefined);
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

test('retained verification whose stream cannot be captured is a failed gate, not a crash (TASK-2828.3)', async () => {
  mock.method(git, 'runToExit', async () => {
    throw new git.CommandOutputLimitError('bash', 'ENOBUFS', 10 * 1024 * 1024,
      'the incomplete output was rejected instead of accepted; narrow the query or read it in bounded parts');
  });
  const port = retainedRepairPort('task-parent', '/checkout', {} as never, resolveConfiguration(inherited));
  const result = await port.verify('npm test', '/checkout');
  assert.equal(result.ok, false, 'an uncapturable stream can never certify that verification ran');
  assert.match(result.diagnostic!, /bash produced more output than its 10485760 byte capture limit allows/);
  assert.ok(result.reason && result.reason.kind === 'gate-failure', 'the failure maps onto the structured gate reason');
  assert.deepEqual(result.reason.failureReason, { version: 1, code: 'gate-failed' });
  assert.equal(result.reason.exitCode, null, 'no exit code is claimed for an uncapturable stream');
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

test('declared review preparation gates keep their command and checkout without parent ownership (TASK-2750)', async () => {
  const command = 'npm test -- --integration owning-suite.test.ts';
  const configuration = resolveConfiguration(inherited);
  const calls: unknown[] = [];
  mock.method(git, 'runToExit', (bin: string, args: string[], options: GitOptions) => {
    calls.push([bin, args, options.cwd]);
    assert.equal(options.stdio, undefined);
    assert.deepEqual(options.env, verificationEnvironment(inherited));
    return { status: 0, stdout: '', stderr: '' };
  });
  // Application process port is backed by the injected runToExit double above.
  const { run: runDeclaredGate } = createReviewPreparationPorts(configuration).process;
  const result = await runDeclaredGate('bash', ['-c', command], { cwd: '/checkout' });
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

test('a repository gate whose output exceeds the capture limit fails closed instead of passing (TASK-2828.3)', () => {
  mock.method(product, 'loadAdapterConfig', () => ({ verification: { command: 'verify {{area}}', defaultArea: 'all' } }));
  const result = runVerificationGate('integration', { rootDir: '/checkout', env: inherited, stdio: 'pipe',
    runFn: () => { throw new git.CommandOutputLimitError('bash', 'ENOBUFS', 10 * 1024 * 1024,
      'the incomplete output was rejected instead of accepted; narrow the query or read it in bounded parts'); },
  });
  assert.notEqual(result.status, 0, 'a truncated gate stream is never a pass');
  assert.match(String(result.stderr), /bash produced more output than its 10485760 byte capture limit allows/);
  assert.equal(result.failureReason?.code, 'gate-failed');
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
