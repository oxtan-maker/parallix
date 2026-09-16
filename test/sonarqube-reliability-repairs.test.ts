import test from 'node:test';
import assert from 'node:assert/strict';
import { stripAnsi } from '../src/application/presentation/cli-format.js';
import { resolveAssetPath, type AssetManifest } from '../src/interfaces/web/security.js';
import { slugifyDraftIntent } from '../src/adapters/cli/commands/draft-setup.js';
import { parseAssigneeFamilies } from '../src/adapters/backlog/task-metadata.js';
import { normalizeVerifyArea } from '../src/adapters/filesystem/mission-paths.js';

// Regression guards for the non-sort half of the 2026-09-16 SonarQube
// reliability baseline: S6324 (control characters in regex literals), S5850
// (implicit anchor/alternation precedence) and S3923 (conditional branches
// that return the same value). Every repair is behavior-preserving, so each
// test pins the pre-repair observable behavior.

test('stripAnsi removes SGR escape sequences after the control-character repair', () => {
  const escape = String.fromCharCode(0x1b);
  assert.equal(stripAnsi(`${escape}[31mred${escape}[0m`), 'red');
  assert.equal(stripAnsi(`plain${escape}[1;32mgreen${escape}[0m tail`), 'plaingreen tail');
  assert.equal(stripAnsi('no escapes here'), 'no escapes here');
  // Non-SGR escapes are still left alone, as before the repair.
  assert.equal(stripAnsi(`${escape}[2Jclear`), `${escape}[2Jclear`);
});

test('resolveAssetPath rejects control characters and NUL in the decoded path', () => {
  const manifest: AssetManifest = {
    'app.js': { contentType: 'text/javascript', size: 10 },
  };

  assert.deepEqual(resolveAssetPath('/app.js', manifest), {
    result: 'ok', relativePath: 'app.js', contentType: 'text/javascript', size: 10,
  });
  // NUL (U+0000) and other C0 control characters must still be a 400.
  assert.deepEqual(resolveAssetPath('/app.js%00.png', manifest), { result: 'reject', status: 400 });
  assert.deepEqual(resolveAssetPath('/app%0a.js', manifest), { result: 'reject', status: 400 });
  assert.deepEqual(resolveAssetPath('/app%1f.js', manifest), { result: 'reject', status: 400 });
  // U+0020 and above are not control characters: rejection comes from the
  // manifest lookup (404), not the control-character guard (400).
  assert.deepEqual(resolveAssetPath('/app .js', manifest), { result: 'reject', status: 404 });
});

test('slugifyDraftIntent trims only leading and trailing hyphens', () => {
  assert.equal(slugifyDraftIntent('--Repair SonarQube findings--'), 'repair-sonarqube-findings');
  assert.equal(slugifyDraftIntent('./src/repair me'), 'src-repair-me');
  assert.equal(slugifyDraftIntent('a-b'), 'a-b');
});

test('parseAssigneeFamilies strips leading and trailing quotes only', () => {
  assert.deepEqual(parseAssigneeFamilies("assignee: ['claude', \"codex\"]\n"), {
    matched: true, families: ['claude', 'codex'],
  });
  // An interior quote is not an anchor match and must survive.
  assert.deepEqual(parseAssigneeFamilies('assignee: [cla"ude]\n'), {
    matched: true, families: ['cla"ude'],
  });
});

test('normalizeVerifyArea returns an unsupported area unchanged', () => {
  assert.equal(normalizeVerifyArea(undefined), 'docs');
  assert.equal(normalizeVerifyArea('auth-server'), 'auth');
  assert.equal(normalizeVerifyArea('all'), 'all');
  assert.equal(normalizeVerifyArea('not-a-known-area'), 'not-a-known-area');
});
