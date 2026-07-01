/**
 * Regression test for task-1391: TypeScript import-equals syntax errors.
 *
 * Node.js native TypeScript strip-only mode does not support the TypeScript
 * `import X = require(Y)` (import-equals) declaration or `export =` statements.
 * This test verifies that no such patterns remain in px.ts or lib/index.ts,
 * which are the two files that serve as the entry point and barrel re-export.
 *
 * At the mission's parent commit (before the fix), this test fails because
 * px.ts:6 contains `import missionStart = require('./lib/commands/mission-start.js')`
 * and lib/index.ts contains ~19 import-equals declarations.
 *
 * After the fix, all import-equals declarations are replaced with standard ESM
 * imports and all export = statements are replaced with ESM named/default exports.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const pxTsPath = path.join(repoRoot, 'px.ts');
const libIndexPath = path.join(repoRoot, 'lib', 'index.ts');

// Regex matches TypeScript import-equals: `import X = require('...')`
// Also matches the variant: `import X = require("...")`
const IMPORT_EQUALS_RE = /import\s+\w+\s*=\s*require\s*\(/;

// Regex matches `export =` (but not `export {` or `export default`)
const EXPORT_EQUALS_RE = /^export\s*=\s*/m;

// Regex matches `export =` in a comment or string (negative filter)
// We need to distinguish `export = fn` from `export { fn }`

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return '';
  }
}

function findImportEqualsMatches(content, filePath) {
  const matches = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    if (IMPORT_EQUALS_RE.test(lines[i])) {
      matches.push({ lineNum, content: lines[i].trim() });
    }
  }
  return matches;
}

function findExportEqualsMatches(content, filePath) {
  const matches = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const trimmed = lines[i].trim();
    // Match `export =` but not `export {` or `export default`
    if (/^export\s*=/.test(trimmed) && !/^export\s*\{/.test(trimmed)) {
      matches.push({ lineNum, content: trimmed });
    }
  }
  return matches;
}

test('px.ts must not contain import-equals declarations', () => {
  const content = readFileSafe(pxTsPath);
  const matches = findImportEqualsMatches(content, pxTsPath);
  assert.strictEqual(
    matches.length,
    0,
    `px.ts contains ${matches.length} import-equals declaration(s) which Node.js strip-only mode does not support:\n${matches.map(m => `  line ${m.lineNum}: ${m.content}`).join('\n')}`
  );
});

test('px.ts must not contain export = statements', () => {
  const content = readFileSafe(pxTsPath);
  const matches = findExportEqualsMatches(content, pxTsPath);
  assert.strictEqual(
    matches.length,
    0,
    `px.ts contains ${matches.length} export = statement(s):\n${matches.map(m => `  line ${m.lineNum}: ${m.content}`).join('\n')}`
  );
});

test('lib/index.ts must not contain import-equals declarations', () => {
  const content = readFileSafe(libIndexPath);
  const matches = findImportEqualsMatches(content, libIndexPath);
  assert.strictEqual(
    matches.length,
    0,
    `lib/index.ts contains ${matches.length} import-equals declaration(s) which Node.js strip-only mode does not support:\n${matches.map(m => `  line ${m.lineNum}: ${m.content}`).join('\n')}`
  );
});

test('lib/index.ts must not contain export = statements', () => {
  const content = readFileSafe(libIndexPath);
  const matches = findExportEqualsMatches(content, libIndexPath);
  assert.strictEqual(
    matches.length,
    0,
    `lib/index.ts contains ${matches.length} export = statement(s):\n${matches.map(m => `  line ${m.lineNum}: ${m.content}`).join('\n')}`
  );
});
