import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// SC1: every file under src/domain imports no infrastructure module. The domain
// layer may only import from within itself (relative specifiers). This test is
// behavioral: it fails if any domain file imports a forbidden module, and the
// fixture assertions fail if the detector stops flagging forbidden specifiers.

const DOMAIN_DIR = path.join(process.cwd(), 'src', 'domain');

// Infra tokens that are also forbidden even on a relative specifier (Git,
// Forgejo, and terminal-rendering modules reached by escaping the domain dir).
const FORBIDDEN_RELATIVE_TOKENS = ['/git.', 'core/git', 'tools/forgejo', 'forgejo', '/fmt.', 'core/fmt'];

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g)]
    .map((match) => match[1] as string);
}

/** A domain import is forbidden when it is not a within-domain relative
 * specifier. Non-relative specifiers (`react`, `ink`, `node:fs`, `node:sqlite`,
 * `node:path`, ...) are all forbidden; relative specifiers are allowed unless
 * they escape into a Git/Forgejo/terminal infra module. */
function forbiddenImports(source: string): string[] {
  const violations: string[] = [];
  for (const specifier of importSpecifiers(source)) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    if (!isRelative) {
      violations.push(specifier);
      continue;
    }
    if (FORBIDDEN_RELATIVE_TOKENS.some((token) => specifier.includes(token))) {
      violations.push(specifier);
    }
  }
  return violations;
}

function domainFiles(): string[] {
  return fs.readdirSync(DOMAIN_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join(DOMAIN_DIR, name));
}

test('SC1: no src/domain file imports a forbidden infrastructure module', () => {
  const offenders: string[] = [];
  for (const file of domainFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of forbiddenImports(source)) {
      offenders.push(`${path.relative(process.cwd(), file)}: ${specifier}`);
    }
  }
  assert.deepEqual(offenders, [], `Forbidden domain imports:\n${offenders.join('\n')}`);
});

test('SC1: the domain modules are present and scanned', () => {
  const names = domainFiles().map((file) => path.basename(file));
  for (const required of [
    'mission.ts', 'mission-workflow.ts', 'checkpoint.ts',
    'review.ts', 'agents.ts', 'usage.ts', 'repository.ts', 'session.ts',
  ]) {
    assert.ok(names.includes(required), `missing domain module ${required}`);
  }
});

test('SC1 detector bites: forbidden specifiers are flagged', () => {
  for (const token of ['react', 'ink', 'node:sqlite', 'node:fs', 'node:child_process', 'node:os', 'node:path']) {
    assert.deepEqual(
      forbiddenImports(`import x from '${token}';`),
      [token],
      `detector should flag ${token}`,
    );
  }
  // A Git/terminal relative infra import is flagged even though it is relative.
  assert.deepEqual(forbiddenImports("import { git } from '../core/git.js';"), ['../core/git.js']);
  // A within-domain relative import is allowed.
  assert.deepEqual(forbiddenImports("import { x } from './mission.js';"), []);
});
