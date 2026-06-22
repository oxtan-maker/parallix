const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW_LIB = path.join(__dirname, '..', 'lib');
const WORKFLOW_INDEX = path.join(__dirname, '..', 'index.js');
// fmt.js is the centralized terminal sink — the one place allowed to call console.*
const EXCLUDED = new Set(['fmt.js']);
const CONSOLE_RE = /console\.(log|error)/;
// Catches raw status-prefix strings like '[INFO] ...' or `[FAIL] ...` passed directly to log sinks.
// These bypass the coloring layer; use fmt.status('LEVEL', text) instead.
const RAW_STATUS_RE = /[`'"](?:\\n)?\[(?:INFO|FAIL|PASS|WARN|DRY-RUN)\]/;

function findViolations(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  return lines.reduce((acc, line, idx) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return acc;
    const tag = `${path.basename(filePath)}:${idx + 1}: ${line.trim()}`;
    if (CONSOLE_RE.test(line)) acc.push(tag);
    else if (RAW_STATUS_RE.test(line)) acc.push(tag);
    return acc;
  }, []);
}

function walkJsFiles(rootDir) {
  return fs.readdirSync(rootDir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) return walkJsFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith('.js')) return [fullPath];
    return [];
  });
}

test('no direct console.log/error calls in workflow/lib/**/*.js except fmt.js', () => {
  const files = walkJsFiles(WORKFLOW_LIB)
    .filter(f => path.basename(f) !== 'index.js')
    .filter(f => !EXCLUDED.has(path.basename(f)));

  const violations = files.flatMap(findViolations);
  assert.deepEqual(violations, [],
    `Formatter violations found (use fmt.status/fmt.log.* instead):\n${violations.join('\n')}`);
});

test('no direct console.log/error calls in workflow/index.js', () => {
  const violations = findViolations(WORKFLOW_INDEX);
  assert.deepEqual(violations, [],
    `Formatter violations found in index.js (use fmt.status/fmt.log.* instead):\n${violations.join('\n')}`);
});
