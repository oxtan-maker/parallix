import { forgejoApiFixture } from '../../fixtures/forgejo-api.js';
// Local publication delegates verification to explicit lifecycle gates and CI.
// Real Git fixture; remote pushes and Forgejo calls remain isolated doubles.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initCommittedRepository } from '../../fixtures/git-repository.js';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
const git = mockModule<typeof import('../../../src/adapters/git/git.js')>('../../../src/adapters/git/git.js', import.meta.url);
const pr = mockModule<typeof import('../../../src/adapters/forgejo/forgejo-pr.js')>('../../../src/adapters/forgejo/forgejo-pr.js', import.meta.url);
await installModuleMocks();

test('PR publication mirrors baseline without running implicit verification (TASK-2715)', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-local-publication-'));
  const marker = path.join(root, 'unexpected-verification');
  const pushes: string[][] = [];
  try {
    initCommittedRepository(root, {
      'workflow.config.json': JSON.stringify({ adapters: {
        verification: { command: 'node -e "require(\'fs\').writeFileSync(\'unexpected-verification\',\'ran\');process.exit(7)"' },
        missions: { primaryBranch: 'main' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'test-org/test-repo' },
      } }),
    });
    t.mock.method(git, 'git', (args: string[]) => {
      if (args.includes('push')) { pushes.push(args); return { status: 0, signal: null, stdout: '', stderr: '' }; }
      const result = spawnSync('git', args, { encoding: 'utf8' });
      return { ...result, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    });
    const result = pr.createPr('mission/task-9999', 'fixture', 'fixture-token', {
      rootDir: root, log: () => {},
      apiCall: forgejoApiFixture((method: string) => method === 'GET'
        ? { ok: true, data: [] }
        : { ok: true, data: { number: 1, html_url: 'http://localhost:3300/test-org/test-repo/pulls/1' } }),
    });
    assert.equal(result.ok, true, result.error ?? 'PR creation failed');
    assert.equal(fs.existsSync(marker), false, 'publication must not execute the configured verifier');
    assert.equal(pushes.length, 2, 'mirror primary and push mission without another test gate');
    assert.ok(pushes.some(args => args.includes('main:main')));
    assert.ok(pushes.some(args => args.includes('mission/task-9999')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const author of ['codex', 'claude', 'test-org']) {
  test(`existing PR author ${author} survives implementation ownership changes (TASK-2804)`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-pr-author-'));
    try {
      initCommittedRepository(root, { 'workflow.config.json': JSON.stringify({ adapters: {
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'test-org/test-repo' },
      } }) });
      t.mock.method(git, 'git', (args: string[]) => {
        if (args.includes('push')) { return { status: 0, signal: null, stdout: '', stderr: '' }; }
        const result = spawnSync('git', args, { encoding: 'utf8' });
        return { ...result, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
      });
      const existing = { number: 739, html_url: 'http://fixture/pulls/739', user: { login: author },
        head: { ref: 'mission/task-9999' }, base: { ref: 'main' } };
      const result = pr.createPr('mission/task-9999', 'codex', 'codex-token', {
        rootDir: root, log: () => {}, apiCall: forgejoApiFixture((method, endpoint) => {
          assert.equal(method, 'GET', 'do not create duplicate PRs');
          return { ok: true, data: endpoint === '/pulls/739' ? existing : [existing] };
        }),
      });
      assert.equal(result.ok, true, result.error ?? 'publication result');
      assert.equal(result.prNumber, 739);
      assert.equal(result.url, existing.html_url);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
