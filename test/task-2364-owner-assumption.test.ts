// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up

import test from 'node:test';
import assert from 'node:assert/strict';
import { pushRound } from '../src/adapters/review/review-commands.js';
import { defaultRepoSlug, collectSetupAnswers, buildNonInteractiveAnswers } from '../src/adapters/review/setup-review.js';

const mockSlug = 'task-2364';

test('auto-bootstrap fallback owner is human not magnus when repo is empty', async () => {
  let capturedOwner: string | undefined;
  let created = 0;

  await pushRound(mockSlug, {
    readReviewStateFn: () => ({ implementer: 'human' }),
    readTokenFn: () => 'token',
    transitionTaskFn: () => true,
    createPrFn: (_branch, _user, _token, opts) => {
      assert.equal(opts.forceWithLease, true);
      created += 1;
      return created === 1
        ? { ok: false, error: 'remote: Repository not found' }
        : { ok: true };
    },
    bootstrapReviewSurfaceFn: async (rootDir, params) => {
      capturedOwner = params.ownerLogin;
      return { ok: true };
    },
    // Empty repo forces fallback path
    resolveReviewAdapterFn: () => ({ baseUrl: 'http://localhost:3300', repo: '', remote: 'review' }),
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
    transitionTaskFn: () => true,
    createPrFn: (_branch, _user, _token, opts) => {
      assert.equal(opts.forceWithLease, true);
      created += 1;
      return created === 1
        ? { ok: false, error: 'remote: Repository not found' }
        : { ok: true };
    },
    bootstrapReviewSurfaceFn: async (rootDir, params) => {
      capturedOwner = params.ownerLogin;
      return { ok: true };
    },
    // Non-empty repo — owner derived from slug
    resolveReviewAdapterFn: () => ({ baseUrl: 'http://localhost:3300', repo: 'acme/parallix', remote: 'review' }),
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2364-'));
  try {
    const prompts = [];
    const answers = ['', 'owner-password', '', 'agent-password', ''];
    const result = await collectSetupAnswers(root, {
      users: ['codex'],
      resolveForgejoSettingsFn: () => ({ url: 'http://localhost:3300', repo: '' }),
      log: () => {},
      promptFn: async (prompt, promptOptions = {}) => {
        prompts.push({ prompt, promptOptions });
        return answers.shift();
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2364-'));
  try {
    const oldEnv = process.env.WORKFLOW_SETUP_OWNER_LOGIN;
    const oldProvider = process.env.WORKFLOW_SETUP_REVIEW_PROVIDER;
    delete process.env.WORKFLOW_SETUP_OWNER_LOGIN;
    process.env.WORKFLOW_SETUP_REVIEW_PROVIDER = 'forgejo';
    try {
      const answers = buildNonInteractiveAnswers(root, { log: () => {} });
      assert.equal(answers.ownerLogin, 'human', 'non-interactive ownerLogin should default to human');
    } finally {
      if (oldEnv === undefined) delete process.env.WORKFLOW_SETUP_OWNER_LOGIN;
      else process.env.WORKFLOW_SETUP_OWNER_LOGIN = oldEnv;
      if (oldProvider === undefined) delete process.env.WORKFLOW_SETUP_REVIEW_PROVIDER;
      else process.env.WORKFLOW_SETUP_REVIEW_PROVIDER = oldProvider;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
