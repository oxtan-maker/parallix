import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  collectGoalCheckEvidenceRows,
  collectRepoTestNames,
  findUnverifiableGoalCheckRow,
} from '../../../../src/adapters/review/review-static-evidence.js';
import { findUnverifiableRecordedRow } from '../../../../src/application/static-evidence.js';

// Reference assertions formerly reached these live handoff helpers through the
// superseded static-review command. Keep them here with an isolated memory port.
test('handoff evidence accepts commands, test names and repository paths (TASK-2810 F2)', () => {
  const { root, fileSystem } = memoryRepository({
    'scripts/verify-local.sh': '#!/bin/sh',
    'hello.sh': '#!/bin/sh',
    'package.json': '{}',
    'backlog/tasks/task-example - follow-up.md': '# Follow-up',
    'test/example.test.ts': "test('real evidence title', () => {});",
  });
  for (const evidence of [
    '`./scripts/verify-local.sh static-analysis`',
    '`bash hello.sh` prints hello',
    '`"real evidence title"`',
    'test `real evidence title`',
    '`test/example.test.ts`',
    'follow-up task `backlog/tasks/task-example - follow-up.md`',
    '`scripts/verify-local.sh`',
    'the shipped layout is described by package.json',
  ]) {
    const rows = collectGoalCheckEvidenceRows(`| Criterion | Evidence | Status |\n|---|---|---|\n| Covered | ${evidence} | PASS |`);
    assert.equal(rows.length, 1, evidence);
    assert.equal(findUnverifiableGoalCheckRow(fileSystem, rows, root), null, evidence);
  }
});

test('handoff evidence rejects placeholder, prose and separator-only tables (TASK-2810 F2)', () => {
  const { root, fileSystem } = memoryRepository({});
  for (const evidence of ['`TBD`', 'Tested manually', 'All tests pass successfully']) {
    const rows = collectGoalCheckEvidenceRows(`| Criterion | Evidence | Status |\n|---|---|---|\n| Covered | ${evidence} | PASS |`);
    assert.equal(rows.length, 1);
    assert.equal(findUnverifiableGoalCheckRow(fileSystem, rows, root), rows[0]);
  }
  for (const table of ['|---|---|---|', '| Criterion | Evidence | Status |\n|---|---|---|\n|---|---|---|']) {
    assert.deepEqual(collectGoalCheckEvidenceRows(table), []);
  }
});

/** An in-memory repository: `files` maps repository-relative paths to content. */
function memoryRepository(files: Record<string, string>) {
  const root = '/repo';
  const absolute = Object.fromEntries(Object.entries(files).map(([file, content]) => [path.join(root, file), content]));
  const children = (dir: string) => [...new Set(Object.keys(absolute)
    .filter(file => file.startsWith(`${dir}/`))
    .map(file => file.slice(dir.length + 1).split('/')[0]))];
  const isFile = (target: string) => target in absolute;
  const isDir = (target: string) => Object.keys(absolute).some(file => file.startsWith(`${target}/`));
  return {
    root,
    fileSystem: {
      existsSync: (target: string) => isFile(target) || isDir(target),
      readText: (target: string) => absolute[target] ?? '',
      listNames: children,
      listEntries: (dir: string) => children(dir).map(name => ({
        name, isFile: () => isFile(path.join(dir, name)), isDirectory: () => isDir(path.join(dir, name)),
      })),
    },
  };
}

const CASE_MODULE = 'test/unit/interfaces/web/web-board-interaction.cases.ts';
const caseRepository = () => memoryRepository({
  [CASE_MODULE]: "test('rapid repeated activation synchronously sends one request (TASK-2657)', async () => {});\n",
});

test('exact quoted test names in owning .cases.ts modules are verifiable (TASK-2662)', () => {
  const { root, fileSystem } = caseRepository();
  assert.ok(collectRepoTestNames(fileSystem, root).has('rapid repeated activation synchronously sends one request (TASK-2657)'));
  const row = { criterion: 'one request per activation', evidence: '"rapid repeated activation synchronously sends one request (TASK-2657)"' };
  assert.equal(findUnverifiableRecordedRow(fileSystem, [row], root), null);
});

test('nonexistent test names and test-file paths are rejected (TASK-2662)', () => {
  const { root, fileSystem } = caseRepository();
  for (const evidence of ['"a test name nobody wrote"', '`test/unit/missing-suite.test.ts`']) {
    const unverifiable = findUnverifiableRecordedRow(fileSystem, [{ criterion: 'covered', evidence }], root);
    assert.ok(unverifiable, `${evidence} must not be accepted`);
    assert.match(unverifiable.message, /cites no verifiable reference/);
  }
});

test('a basename-only case module reference is rejected with a repository-relative path hint (TASK-2657)', () => {
  const { root, fileSystem } = caseRepository();
  const basename = findUnverifiableRecordedRow(fileSystem, [{ criterion: 'board interaction', evidence: 'web-board-interaction.cases.ts' }], root);
  assert.ok(basename, 'a basename does not resolve from the repository root');
  assert.match(basename.message, /`web-board-interaction\.cases\.ts` does not exist relative to the repository root; cite the repository-relative path/);
  assert.match(basename.message, /Offending row: \| board interaction \| web-board-interaction\.cases\.ts \|/);
  assert.equal(findUnverifiableRecordedRow(fileSystem, [{ criterion: 'board interaction', evidence: CASE_MODULE }], root), null);
});

test('existing files outside the repository are not evidence, including file:line and command forms (TASK-2662)', () => {
  const outside = { '/etc/ssl/openssl.cnf': '', '/code/package.json': '' };
  const { root, fileSystem } = caseRepository();
  const escaping = { ...fileSystem, existsSync: (target: string) => target in outside || fileSystem.existsSync(target) } satisfies NonNullable<Parameters<typeof findUnverifiableRecordedRow>[0]>;
  for (const evidence of ['/etc/ssl/openssl.cnf', '/etc/ssl/openssl.cnf:3', '../code/package.json', '`cat ../code/package.json`', '`./../code/package.json`']) {
    assert.ok(findUnverifiableRecordedRow(escaping, [{ criterion: 'covered', evidence }], root), `${evidence} lies outside the repository`);
  }
  assert.equal(findUnverifiableRecordedRow(escaping, [{ criterion: 'covered', evidence: `./${CASE_MODULE}:1` }], root), null);
});

test('the legacy lib/ file:line alias still respects the root-escape rule (TASK-2662)', () => {
  // canonicalSourceContainsFile maps a compiled lib/ path to its src/ basename;
  // the alias must not let a lib/../../ form reach that fallback.
  const srcRepo = memoryRepository({ 'src/static-evidence.ts': 'export const x = 1\n' });
  for (const evidence of ['lib/../../static-evidence.ts:1', 'lib/../../../etc/passwd:1']) {
    const unverifiable = findUnverifiableRecordedRow(srcRepo.fileSystem, [{ criterion: 'covered', evidence }], srcRepo.root);
    assert.ok(unverifiable, `${evidence} escapes the repository and must not be accepted`);
    assert.match(unverifiable.message, /cites no verifiable reference/);
  }
  assert.equal(findUnverifiableRecordedRow(srcRepo.fileSystem, [{ criterion: 'covered', evidence: 'lib/static-evidence.ts:1' }], srcRepo.root), null);
});

test('a path that escapes and re-enters the repository is rejected even when the re-entered file exists (TASK-2662)', () => {
  const reenter = memoryRepository({ 'pkg/package.json': '{}' });
  // `../../repo/pkg/package.json` walks above the root, then resolves back
  // into the repository at an existing file; the escape must win.
  const evidence = '../../repo/pkg/package.json';
  const unverifiable = findUnverifiableRecordedRow(reenter.fileSystem, [{ criterion: 'covered', evidence }], reenter.root);
  assert.ok(unverifiable, `${evidence} escapes the repository and must not be accepted`);
  assert.match(unverifiable.message, /cites no verifiable reference/);
});
