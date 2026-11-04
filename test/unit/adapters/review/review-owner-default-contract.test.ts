import { resolveConfiguration } from '../../../../src/composition/config.js';
const environment: NodeJS.ProcessEnv = { ...process.env };
// review owner default contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewWorkflowAdapter } from '../../../../src/adapters/review/review-workflow-adapter.js';
import { fixtureMission } from '../../../fixtures/mission-builders.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionVersion } from '../../../../src/application/domain-ports.js';
import { pushRound } from '../../../../src/adapters/review/review-commands.js';
import {
  defaultRepoSlug,
  collectSetupAnswers,
  buildNonInteractiveAnswers,
} from '../../../../src/adapters/review/setup-review.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

// Regression provenance: TASK-2364.
const mockSlug = 'task-2364';

test('auto-bootstrap fallback owner is human not magnus when repo is empty', async () => {
  let capturedOwner: string | undefined;
  let created = 0;

  await pushRound(mockSlug, {
    readReviewStateFn: () => ({ implementer: 'human' }),
    readTokenFn: () => 'token',
    transitionTaskFn: async () => true,
    createPrFn: (_branch, _user, _token, opts) => {
      assert.ok(opts != null);
      assert.equal(opts.forceWithLease, true);
      created += 1;
      return created === 1
        ? { ok: false, error: 'remote: Repository not found' }
        : { ok: true };
    },
    bootstrapReviewSurfaceFn: async (rootDir, params) => {
      capturedOwner = params.ownerLogin;
      return { ok: true as const };
    },
    // Empty repo forces fallback path
    resolveReviewAdapterFn: () => ({ provider: 'forgejo', baseUrl: 'http://localhost:3300', repo: '', remote: 'review' }),
    log: () => {},
    error: () => {},
    exit: () => {}
  });

  // Fallback owner must be 'human', not 'magnus'
  assert.equal(capturedOwner, 'human', 'fallback ownerLogin should be human, not magnus');
  assert.equal(created, 2, 'PR should be retried after bootstrap');
});

test('auto-bootstrap derives owner from repo slug when present', async () => {
  let capturedOwner: string | undefined;
  let created = 0;

  await pushRound(mockSlug, {
    readReviewStateFn: () => ({ implementer: 'human' }),
    readTokenFn: () => 'token',
    transitionTaskFn: async () => true,
    createPrFn: (_branch, _user, _token, opts) => {
      assert.ok(opts != null);
      assert.equal(opts.forceWithLease, true);
      created += 1;
      return created === 1
        ? { ok: false, error: 'remote: Repository not found' }
        : { ok: true };
    },
    bootstrapReviewSurfaceFn: async (rootDir, params) => {
      capturedOwner = params.ownerLogin;
      return { ok: true as const };
    },
    // Non-empty repo — owner derived from slug
    resolveReviewAdapterFn: () => ({ provider: 'forgejo', baseUrl: 'http://localhost:3300', repo: 'acme/parallix', remote: 'review' }),
    log: () => {},
    error: () => {},
    exit: () => {}
  });

  assert.equal(capturedOwner, 'acme', 'ownerLogin derived from repo slug');
  assert.equal(created, 2, 'PR should be retried after bootstrap');
});

test('setup-review defaultRepoSlug falls back to human when owner is undefined', () => {
  assert.equal(defaultRepoSlug('/tmp/my-project'), 'human/my-project');
  assert.equal(defaultRepoSlug('/tmp/my-project', undefined), 'human/my-project');
  assert.equal(defaultRepoSlug('/tmp/my-project', ''), 'human/my-project');
});

test('setup-review collectSetupAnswers defaults owner to human when repo is empty', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = registeredMkdtemp('task-2364-');
  try {
    const prompts: { prompt: string; promptOptions: { hidden?: boolean; }; }[] = [];
    const answers = ['', 'owner-password', '', 'agent-password', ''];
    const result = await collectSetupAnswers(root, {
      users: ['codex'],
      resolveForgejoSettingsFn: () => ({ url: 'http://localhost:3300', repo: '', remote: 'review' }),
      log: () => {},
      promptFn: async (prompt, promptOptions = {}) => {
        prompts.push({ prompt, promptOptions });
        return answers.shift() ?? '';
      },
    });
    assert.equal(result.ownerLogin, 'human', 'ownerLogin should default to human when repo is empty');
    assert.ok(prompts.some(e => e.prompt.includes('[human]')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setup-review buildNonInteractiveAnswers defaults owner to human without env var', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = registeredMkdtemp('task-2364-');
  try {
    const oldEnv = environment.WORKFLOW_SETUP_OWNER_LOGIN;
    const oldProvider = environment.WORKFLOW_SETUP_REVIEW_PROVIDER;
    delete environment.WORKFLOW_SETUP_OWNER_LOGIN;
    environment.WORKFLOW_SETUP_REVIEW_PROVIDER = 'forgejo';
    try {
      const answers = buildNonInteractiveAnswers(root, { configuration: resolveConfiguration(environment), log: () => {} });
      assert.equal(answers.ownerLogin, 'human', 'non-interactive ownerLogin should default to human');
    } finally {
      if (oldEnv === undefined) delete environment.WORKFLOW_SETUP_OWNER_LOGIN;
      else environment.WORKFLOW_SETUP_OWNER_LOGIN = oldEnv;
      if (oldProvider === undefined) delete environment.WORKFLOW_SETUP_REVIEW_PROVIDER;
      else environment.WORKFLOW_SETUP_REVIEW_PROVIDER = oldProvider;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Publication belongs to the recorded implementer, independently of the reviewer.
for (const explicit of [false, true]) {
  test(`review push preserves recorded codex authorship with custom reviewer; explicit=${explicit} (px-0016)`, async () => {
    const published: string[] = [];
    const adapter = createReviewWorkflowAdapter();
    await adapter.push({ slug: mockSlug, args: ['--push', ...(explicit ? ['--implementer', 'codex'] : [])], options: {
      missionStore: { load: async () => ({ kind: 'found', version: missionVersion(1), mission: fixtureMission(mockSlug, { assignee: agentFamily('codex') }) }) },
      resolveWorktreeFn: () => '/fixture', readReviewStateFn: () => ({ implementer: 'codex', reviewer: 'custom' }),
      resolveReviewUserFn: (user: string) => user, isReviewProviderEnabledFn: () => true,
      readTokenFn: (user: string) => `${user}-token`, transitionTaskFn: async () => true,
      createPrFn: (_branch: string, user: string, token: string) => { published.push(`${user}:${token}`); return { ok: true }; },
      log: () => {}, error: (message: string) => assert.fail(message), exit: (code: number) => assert.fail(`exit ${code}`),
    } });
    assert.deepEqual(published, ['codex:codex-token']);
  });
}

test('review push cannot override recorded implementer with a flag or stale review metadata (px-0016)', async () => {
  const publications: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const adapter = createReviewWorkflowAdapter();
  const options = {
    missionStore: { load: async () => ({ kind: 'found', version: missionVersion(1), mission: fixtureMission(mockSlug, { assignee: agentFamily('codex') }) }) },
    resolveWorktreeFn: () => '/fixture', readReviewStateFn: () => ({ implementer: 'custom', reviewer: 'custom' }),
    resolveReviewUserFn: (user: string) => user, isReviewProviderEnabledFn: () => true,
    readTokenFn: (user: string) => `${user}-token`, transitionTaskFn: async () => true,
    createPrFn: (_branch: string, user: string) => { publications.push(user); return { ok: true }; },
    log: () => {}, error: (message: string) => errors.push(message), exit: (code: number) => exits.push(code),
  };
  await adapter.push({ slug: mockSlug, args: ['--push'], options });
  assert.deepEqual(publications, ['codex']);
  await adapter.push({ slug: mockSlug, args: ['--push', '--implementer', 'custom'], options });
  assert.deepEqual(publications, ['codex'], 'a CLI override cannot authorize a different publisher');
  assert.deepEqual(exits, [1]);
  assert.match(errors.join('\n'), /differs from recorded implementer codex/);
});

for (const mode of ['unavailable', 'unassigned']) {
  test(`review push refuses ${mode} Mission identity instead of using reviewer or task (px-0016)`, async () => {
    const errors: string[] = [];
    const exits: number[] = [];
    await createReviewWorkflowAdapter().push({ slug: mockSlug, args: ['--push', '--implementer', 'codex'], options: {
      missionStore: { load: async () => mode === 'unavailable'
        ? { kind: 'unavailable', reason: 'fixture unavailable' }
        : { kind: 'found', version: missionVersion(1), mission: fixtureMission(mockSlug, { assignee: null }) } },
      resolveWorktreeFn: () => '/fixture', readReviewStateFn: () => ({ implementer: 'codex', reviewer: 'custom' }),
      resolveTaskFileFn: () => assert.fail('Mission identity cannot fall back to task metadata'),
      isReviewProviderEnabledFn: () => true, readTokenFn: () => assert.fail('no credential selection without identity'),
      createPrFn: () => assert.fail('no publication without identity'),
      log: () => {}, error: (message: string) => errors.push(message), exit: (code: number) => exits.push(code),
    } });
    assert.deepEqual(exits, [1]);
    assert.match(errors.join('\n'), /recorded implementer|No review identity/);
  });
}

test('legacy review push uses the recorded implementer rather than reviewer (px-0016)', async () => {
  const published: string[] = [];
  await pushRound(mockSlug, {
    resolveWorktreeFn: () => '/fixture', readReviewStateFn: () => ({ implementer: 'codex', reviewer: 'custom' }),
    resolveReviewUserFn: user => user, isReviewProviderEnabledFn: () => true,
    readTokenFn: user => `${user}-token`, transitionTaskFn: async () => true,
    createPrFn: (_branch, user) => { published.push(user); return { ok: true }; },
    log: () => {}, error: message => assert.fail(message), exit: code => assert.fail(`exit ${code}`),
  });
  assert.deepEqual(published, ['codex']);
});

test('review push retains configured credential home through lookup bootstrap and publication (px-0016)', async () => {
  const configuration = resolveConfiguration({ FORGEJO_HOME: '/configured/forgejo' });
  let publications = 0;
  let bootstraps = 0;
  await createReviewWorkflowAdapter().push({ slug: mockSlug, args: ['--push', '--implementer', 'codex'], options: {
    configuration,
    resolveWorktreeFn: () => '/fixture', readReviewStateFn: () => ({ implementer: 'codex', reviewer: 'custom' }),
    resolveReviewUserFn: (user: string) => user, isReviewProviderEnabledFn: () => true,
    readTokenFn: (user: string, options: { rootDir?: string; configuration?: typeof configuration }) => {
      assert.equal(user, 'codex'); assert.equal(options.rootDir, '/fixture');
      assert.strictEqual(options.configuration, configuration); return 'codex-token';
    },
    transitionTaskFn: async () => true,
    createPrFn: (_branch: string, user: string, _token: string, options: { configuration?: typeof configuration }) => {
      assert.equal(user, 'codex'); assert.strictEqual(options.configuration, configuration);
      return ++publications === 1 ? { ok: false, error: 'Repository not found' } : { ok: true };
    },
    bootstrapReviewSurfaceFn: async (_root: string, _setup: unknown, options: { configuration?: typeof configuration }) => {
      assert.strictEqual(options.configuration, configuration); bootstraps++; return { ok: true };
    },
    resolveReviewAdapterFn: () => ({ provider: 'forgejo', baseUrl: 'http://fixture', repo: 'human/fixture', remote: 'review' }),
    log: () => {}, error: (message: string) => assert.fail(message), exit: (code: number) => assert.fail(`exit ${code}`),
  } });
  assert.equal(publications, 2); assert.equal(bootstraps, 1);
});

test('review push rejects unreadable recorded implementer (px-0016)', async () => {
  const errors: string[] = [];
  const exits: number[] = [];
  await pushRound(mockSlug, {
    resolveWorktreeFn: () => '/fixture', isReviewProviderEnabledFn: () => true,
    readReviewStateFn: () => { throw new Error('state unreadable'); },
    readTokenFn: () => assert.fail('no credential lookup without identity'),
    createPrFn: () => assert.fail('no publication without identity'),
    log: () => {}, error: message => errors.push(message), exit: code => exits.push(code),
  });
  assert.deepEqual(exits, [1]);
  assert.match(errors.join('\n'), /Cannot read the recorded implementer/);
});

test('review push rejects requested implementer differing from recorded one (px-0016)', async () => {
  const errors: string[] = [];
  const exits: number[] = [];
  await pushRound(mockSlug, {
    implementer: 'claude',
    resolveWorktreeFn: () => '/fixture', isReviewProviderEnabledFn: () => true,
    readReviewStateFn: () => ({ implementer: 'codex' }),
    readTokenFn: () => assert.fail('no credential lookup on identity mismatch'),
    createPrFn: () => assert.fail('no publication on identity mismatch'),
    log: () => {}, error: message => errors.push(message), exit: code => exits.push(code),
  });
  assert.deepEqual(exits, [1]);
  assert.match(errors.join('\n'), /differs from recorded implementer codex/);
});

test('review push warns when it defaults the identity to autonomous (px-0016)', async () => {
  const logs: string[] = [];
  const published: string[] = [];
  await pushRound(mockSlug, {
    resolveWorktreeFn: () => '/fixture', isReviewProviderEnabledFn: () => false,
    readReviewStateFn: () => null,
    resolveTaskFileFn: () => ({ ok: false }) as ReturnType<NonNullable<Parameters<typeof pushRound>[1]>['resolveTaskFileFn'] & {}>,
    resolveReviewUserFn: user => user, readTokenFn: user => `${user}-token`, transitionTaskFn: async () => true,
    createPrFn: (_branch, user) => { published.push(user); return { ok: true }; },
    log: message => logs.push(message), error: message => assert.fail(message), exit: code => assert.fail(`exit ${code}`),
  });
  assert.match(logs.join('\n'), /defaulting to "autonomous"/);
  assert.deepEqual(published, ['autonomous']);
});
