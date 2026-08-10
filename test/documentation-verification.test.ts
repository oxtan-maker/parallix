import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const verifier = path.join(repoRoot, 'scripts', 'verify-docs.mjs');

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-docs-'));
  for (const file of ['README.md', 'docs/authority-reference.md', 'docs/use-cases.md', 'docs/doc-standards.md']) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, '# Document\n');
  }
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(verifier, path.join(root, 'scripts', 'verify-docs.mjs'));
  return root;
}

function run(root: string) {
  return spawnSync(process.execPath, ['scripts/verify-docs.mjs'], { cwd: root, encoding: 'utf8' });
}

test('documentation verifier accepts durable authored documentation with valid relative links', () => {
  const root = createFixture();
  fs.writeFileSync(path.join(root, 'README.md'), '[Authority](docs/authority-reference.md)\n');
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

test('documentation verifier ignores fenced examples and external URLs', () => {
  const root = createFixture();
  fs.writeFileSync(path.join(root, 'README.md'), '```sh\nnode src/example.ts\n```\nhttps://example.test/lib/example.ts\n');
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

test('documentation verifier rejects volatile implementation evidence and broken relative links', () => {
  const root = createFixture();
  fs.writeFileSync(path.join(root, 'docs', 'use-cases.md'), 'See src/example.ts:42 and test/example.test.ts. [Missing](missing.md)\n');
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /volatile source-path evidence/);
  assert.match(result.stderr, /volatile test-inventory evidence/);
  assert.match(result.stderr, /relative Markdown link target does not exist/);
});

test('general verification gate runs the documentation verifier', () => {
  const gate = fs.readFileSync(path.join(repoRoot, 'scripts', 'verify-local.sh'), 'utf8');
  assert.match(gate, /gate_all\(\) \{\s+node scripts\/verify-docs\.mjs/s);
});
