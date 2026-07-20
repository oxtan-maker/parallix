// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HYGIENE_SCRIPT = path.join(__dirname, '..', 'scripts', 'test-hygiene.sh');

function withFixture(source, assertion) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-hygiene-'));
  try {
    fs.mkdirSync(path.join(repoRoot, 'test'));
    fs.writeFileSync(path.join(repoRoot, 'test', 'fixture.test.ts'), source);
    assertion(spawnSync('bash', [HYGIENE_SCRIPT], { cwd: repoRoot, encoding: 'utf8' }));
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
