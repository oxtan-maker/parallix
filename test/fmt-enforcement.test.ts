

// Enforced against TypeScript source rather than a generated tree: the source
// is authoritative after the transitional dist/ emitter was retired, and the
// check no longer needs a build to have run first.

import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
const RUNTIME_LIB = path.join(import.meta.dirname, '..', 'src', 'adapters', 'cli');
const RUNTIME_INDEX = path.join(import.meta.dirname, '..', 'src', 'interfaces', 'cli', 'runtime.ts');
// fmt.ts is the centralized terminal sink — the one place allowed to call console.*
const EXCLUDED = new Set(['fmt.ts']);
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

function walkSourceFiles(rootDir) {
  return fs.readdirSync(rootDir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) return [fullPath];
    return [];
  });
}

test('no direct console.log/error calls in CLI adapter modules', () => {
  const files = walkSourceFiles(RUNTIME_LIB)
    .filter(f => path.basename(f) !== 'index.ts')
    .filter(f => !EXCLUDED.has(path.basename(f)));

  const violations = files.flatMap(findViolations);
  assert.deepEqual(violations, [],
    `Formatter violations found (use fmt.status/fmt.log.* instead):\n${violations.join('\n')}`);
});

test('no direct console.log/error calls in src/interfaces/cli/runtime.ts', () => {
  const violations = findViolations(RUNTIME_INDEX);
  assert.deepEqual(violations, [],
    `Formatter violations found in index.ts (use fmt.status/fmt.log.* instead):\n${violations.join('\n')}`);
});
