// Reproduction for task-2484: npm manifest metadata (repository.url, homepage,
// bugs.url) must agree with `git remote get-url origin`. This test runs the
// documentation verifier against a synthetic fixture whose manifest disagrees
// with origin and asserts rejection. It is red on the mission parent commit
// (the verifier ignores the manifest) and green once the offline
// origin-agreement check lands in scripts/verify-docs.mjs.
//
// Origin is supplied through PARALLIX_ORIGIN_REMOTE_URL so the check stays
// offline and deterministic; no HTTP request is ever made.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifier = path.join(repoRoot, 'scripts', 'verify-docs.mjs');

// Operator-confirmed canonical remote for this checkout (see CP 2).
const ORIGIN = 'https://github.com/oxtan-maker/parallix.git';
// scp-style SSH remote form Git emits for SSH clones; must normalize equal to ORIGIN.
const SSH_ORIGIN = 'git@github.com:oxtan-maker/parallix.git';
// The dead value currently in package.json: resolves to HTTP 404 for anonymous visitors.
const DEAD = 'https://github.com/magnusekdahl/parallix';

function manifestFor(repository: string, homepage: string, bugs: string): string {
  return JSON.stringify(
    {
      name: '@magnusekdahl/parallix',
      version: '1.5.98',
      repository: { type: 'git', url: `git+${repository}` },
      bugs: { url: bugs },
      homepage,
    },
    null,
    2,
  );
}

function makeFixture(repository: string, homepage: string, bugs: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-metadata-'));
  for (const file of ['README.md', 'docs/use-cases.md', 'docs/doc-standards.md']) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, '# metadata fixture\n');
  }
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(verifier, path.join(root, 'scripts', 'verify-docs.mjs'));
  fs.writeFileSync(path.join(root, 'package.json'), manifestFor(repository, homepage, bugs));
  return root;
}

function run(root: string, origin: string = ORIGIN) {
  return spawnSync(process.execPath, ['scripts/verify-docs.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PARALLIX_ORIGIN_REMOTE_URL: origin },
  });
}

test('npm metadata that disagrees with origin is rejected by the verifier', () => {
  const root = makeFixture(DEAD, `${DEAD}#readme`, `${DEAD}/issues`);
  try {
    const result = run(root);
    assert.equal(result.status, 1, `expected verifier to reject mismatched metadata, stderr: ${result.stderr}`);
    assert.match(result.stderr, /disagrees with origin remote/);
    assert.match(result.stderr, /repository\.url/);
    assert.match(result.stderr, /homepage/);
    assert.match(result.stderr, /bugs\.url/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('npm metadata that agrees with origin passes the verifier', () => {
  const root = makeFixture(ORIGIN, `${ORIGIN}#readme`, `${ORIGIN}/issues`);
  try {
    const result = run(root);
    assert.equal(result.status, 0, `expected verifier to accept matching metadata, stderr: ${result.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scp-style SSH origin normalizes equal to the https manifest', () => {
  const root = makeFixture(ORIGIN, `${ORIGIN}#readme`, `${ORIGIN}/issues`);
  try {
    const result = spawnSync(process.execPath, ['scripts/verify-docs.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PARALLIX_ORIGIN_REMOTE_URL: SSH_ORIGIN },
    });
    assert.equal(result.status, 0, `expected SSH origin to normalize equal to matching metadata, stderr: ${result.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
