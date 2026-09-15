import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isNewerNormalVersion, parseNormalVersion, publishTrustedRelease, validateMetadata, validateTrustedRelease } from '../scripts/release-publish.js';

test('task-2509: release metadata accepts only matching normal SemVer versions', () => {
  assert.deepEqual(parseNormalVersion('1.5.120'), [1, 5, 120]);
  assert.equal(parseNormalVersion('1.5.120-beta.1'), null);
  assert.equal(validateMetadata({ version: '1.5.120' }, { version: '1.5.120' }), '1.5.120');
  assert.throws(() => validateMetadata({ version: 'bad' }, { version: 'bad' }), /normal SemVer/);
  assert.throws(() => validateMetadata({ version: '1.5.120' }, { version: '1.5.119' }), /must match/);
});

test('task-2509: normal releases must advance the current normal release', () => {
  assert.equal(isNewerNormalVersion('1.5.120', '1.5.119'), true);
  assert.equal(isNewerNormalVersion('1.5.119', '1.5.119'), false);
  assert.equal(isNewerNormalVersion('1.5.118', '1.5.119'), false);
});

function withReleaseRoot(run: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2509-release-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.5.120' }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.5.120' }));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('task-2509: tag collision and another SHA publication fail closed', () => {
  withReleaseRoot(root => {
    const tagElsewhere = (command: string) => command === 'git'
      ? { status: 0, stdout: 'other-sha\n', stderr: '' }
      : { status: 1, stdout: '', stderr: 'E404 Not Found' };
    assert.throws(() => validateTrustedRelease(root, 'trusted-sha', tagElsewhere), /not trusted SHA/);

    const publishedElsewhere = (command: string, args: string[]) => {
      if (command === 'npm' && args[2] === 'gitHead') { return { status: 0, stdout: '"other-sha"', stderr: '' }; }
      if (command === 'npm' && args[1].includes('@1.5.120')) { return { status: 0, stdout: '"1.5.120"', stderr: '' }; }
      if (command === 'npm') { return { status: 0, stdout: '"1.5.119"', stderr: '' }; }
      return { status: 1, stdout: '', stderr: '' };
    };
    assert.throws(() => validateTrustedRelease(root, 'trusted-sha', publishedElsewhere), /different SHA/);
  });
});

test('task-2509: npm lookup errors fail closed', () => {
  withReleaseRoot(root => {
    assert.throws(
      () => validateTrustedRelease(root, 'trusted-sha', () => ({ status: 1, stdout: '', stderr: 'E503 registry unavailable' })),
      /npm view.*failed/,
    );
  });
});

test('task-2509: release flow publishes, tags, and creates the matching release', () => {
  withReleaseRoot(root => {
    const calls: string[][] = [];
    const run = (executable: string, args: string[]) => {
      calls.push([executable, ...args]);
      if (executable === 'npm' && args[0] === 'view' && args[1].includes('@1.5.120')) {
        return { status: 1, stdout: '', stderr: 'E404 Not Found' };
      }
      if (executable === 'npm' && args[0] === 'view') { return { status: 0, stdout: '"1.5.119"', stderr: '' }; }
      if (executable === 'git' && args[0] === 'rev-parse') { return { status: 1, stdout: '', stderr: '' }; }
      if (executable === 'gh' && args[0] === 'release' && args[1] === 'view') {
        return { status: 1, stdout: '', stderr: 'release not found' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    publishTrustedRelease(root, 'trusted-sha', run);
    assert.deepEqual(calls.filter(call => call[0] === 'git' && call[1] === 'tag'), [['git', 'tag', 'v1.5.120', 'trusted-sha']]);
    assert.ok(calls.some(call => call.join(' ') === 'npm publish --access public --provenance --registry=https://registry.npmjs.org'));
    assert.ok(calls.some(call => call.join(' ') === 'gh release create v1.5.120 --target trusted-sha --generate-notes'));
  });
});

test('task-2509: rerun reuses the existing GitHub Release by its verified tag', () => {
  withReleaseRoot(root => {
    const calls: string[][] = [];
    const run = (executable: string, args: string[]) => {
      calls.push([executable, ...args]);
      if (executable === 'git') { return { status: 0, stdout: 'trusted-sha\n', stderr: '' }; }
      if (executable === 'npm' && args[2] === 'gitHead') { return { status: 0, stdout: '"trusted-sha"', stderr: '' }; }
      if (executable === 'npm' && args[0] === 'view') { return { status: 0, stdout: '"1.5.120"', stderr: '' }; }
      // A release whose stored targetCommitish is a branch name is still bound to its tag.
      if (executable === 'gh') { return { status: 0, stdout: 'tag: v1.5.120\ntarget: main\n', stderr: '' }; }
      return { status: 0, stdout: '', stderr: '' };
    };
    publishTrustedRelease(root, 'trusted-sha', run);
    assert.ok(!calls.some(call => call[0] === 'npm' && call[1] === 'publish'));
    assert.ok(!calls.some(call => call[0] === 'git' && (call[1] === 'tag' || call[1] === 'push')));
    assert.ok(!calls.some(call => call[0] === 'gh' && call[2] === 'create'));
  });
});

test('task-2509: rerun accepts publication and tag only for the same trusted SHA', () => {
  withReleaseRoot(root => {
    const sameSha = (command: string, args: string[]) => {
      if (command === 'git') { return { status: 0, stdout: 'trusted-sha\n', stderr: '' }; }
      if (args[2] === 'gitHead') { return { status: 0, stdout: '"trusted-sha"', stderr: '' }; }
      return { status: 0, stdout: '"1.5.120"', stderr: '' };
    };
    assert.deepEqual(validateTrustedRelease(root, 'trusted-sha', sameSha), {
      version: '1.5.120', tag: 'v1.5.120', alreadyPublished: true, tagExists: true,
    });
  });
});
