// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HYGIENE_SCRIPT = path.join(import.meta.dirname, '..', 'scripts', 'test-hygiene.sh');

function withFixture(source, assertion) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-hygiene-'));
  try {
    fs.mkdirSync(path.join(repoRoot, 'test'));
    fs.writeFileSync(path.join(repoRoot, 'test', 'fixture.test.ts'), source);
    // The hygiene script also checks /tmp inode usage. Stub df here so these
    // source-scanning fixtures do not inherit the host's transient disk state.
    const binDir = path.join(repoRoot, 'bin');
    fs.mkdirSync(binDir);
    const dfScript = path.join(binDir, 'df');
    fs.writeFileSync(dfScript, `#!/usr/bin/env bash
echo "Filesystem     Inodes  IUsed   IFree IUse% Mounted"
echo "tmpfs  524288  1  524287  1%  /tmp"
`, 'utf8');
    fs.chmodSync(dfScript, 0o755);
    assertion(spawnSync('bash', [HYGIENE_SCRIPT], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    }));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test('test hygiene rejects .only in TypeScript tests', () => {
  withFixture(`${['test', 'only'].join('.')}('focused', () => {});\n`, result => {
    assert.equal(result.status, 1);
    assert.match(result.stdout, /fixture\.test\.ts:1/);
  });
});

test('test hygiene accepts an annotated TypeScript skip', () => {
  withFixture("test.skip('documented', () => {}); // reason: fixture coverage\n", result => {
    assert.equal(result.status, 0);
  });
});

// Inode-usage guard: exercises the real scripts/test-hygiene.sh with a
// mocked df binary so the threshold logic is verified without depending
// on the host's actual /tmp inode state.
function withMockedDf(dfOutput, assertion) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-hygiene-inode-'));
  try {
    fs.mkdirSync(path.join(repoRoot, 'test'));
    // Copy the real test-hygiene.sh into the fixture repo
    fs.copyFileSync(HYGIENE_SCRIPT, path.join(repoRoot, 'test-hygiene.sh'));

    // Create a mock df binary that returns the provided output
    const binDir = path.join(repoRoot, 'bin');
    fs.mkdirSync(binDir);
    const dfScript = path.join(binDir, 'df');
    fs.writeFileSync(dfScript, `#!/usr/bin/env bash
echo "Filesystem     Inodes  IUsed   IFree IUse% Mounted"
echo "${dfOutput}"
`, 'utf8');
    fs.chmodSync(dfScript, 0o755);

    assertion(spawnSync('bash', ['test-hygiene.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    }));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test('inode guard fails the real script at 86% usage', () => {
  withMockedDf('tmpfs  524288  450000  74288  86%  /tmp', result => {
    assert.equal(result.status, 1, 'inode guard should fail at 86% usage');
    assert.match(result.stdout, /FAIL: \/tmp inode usage is 86% \(threshold: 80%\)/);
  });
});

test('inode guard passes the real script below 80% threshold', () => {
  withMockedDf('tmpfs  524288  300000  224288  57%  /tmp', result => {
    assert.equal(result.status, 0, 'inode guard should pass at 57% usage');
    assert.match(result.stdout, /PASS: no test-hygiene violations/);
  });
});

// BSD/macOS df -i format:
// Filesystem 512-blocks Used Available Capacity iused ifree %iused Mounted on
// Inode percentage is in field 8 (%iused), not field 5.
function withMockedDfBsd(dfOutput, assertion) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-hygiene-inode-bsd-'));
  try {
    fs.mkdirSync(path.join(repoRoot, 'test'));
    fs.copyFileSync(HYGIENE_SCRIPT, path.join(repoRoot, 'test-hygiene.sh'));

    const binDir = path.join(repoRoot, 'bin');
    fs.mkdirSync(binDir);
    const dfScript = path.join(binDir, 'df');
    fs.writeFileSync(dfScript, `#!/usr/bin/env bash
echo "Filesystem 512-blocks      Used Available Capacity iused     ifree     %iused Mounted on"
echo "${dfOutput}"
`, 'utf8');
    fs.chmodSync(dfScript, 0o755);

    assertion(spawnSync('bash', ['test-hygiene.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    }));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test('inode guard fails the real script on BSD layout at 92% usage', () => {
  withMockedDfBsd('/dev/disk1s1  488281264  244140632  244140632  50%  122070316  122070316  92%  /tmp', result => {
    assert.equal(result.status, 1, 'inode guard should fail at 92% usage (BSD)');
    assert.match(result.stdout, /FAIL: \/tmp inode usage is 92% \(threshold: 80%\)/);
  });
});

test('inode guard passes the real script on BSD layout below 80%', () => {
  withMockedDfBsd('/dev/disk1s1  488281264  244140632  244140632  50%  61035158  183105474  45%  /tmp', result => {
    assert.equal(result.status, 0, 'inode guard should pass at 45% usage (BSD)');
    assert.match(result.stdout, /PASS: no test-hygiene violations/);
  });
});
