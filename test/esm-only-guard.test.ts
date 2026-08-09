import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findEsmOnlyViolations } from '../scripts/esm-only-guard.js';

test('ESM-only guard accepts the repository and rejects module syntax, configuration, output, and retired-runtime references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'esm-only-guard-'));
  try {
    assert.deepEqual(findEsmOnlyViolations(process.cwd()), []);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'test'), { recursive: true });

    // src/ fixtures — raw source checked (no stripping)
    fs.writeFileSync(path.join(root, 'src', 'compat.ts'), "module.exports = {};\n", 'utf8');
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}\n', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'output.js'), 'require("node:fs");\n', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'reference.ts'), 'const retired = ".test-runtime";\n', 'utf8');

    // test/ fixtures — strings/comments stripped for CJS patterns,
    // but .test-runtime always checked against raw source
    fs.writeFileSync(path.join(root, 'test', 'cjs-syntax.test.ts'),
      'module.exports = { run: () => {} };\n', 'utf8'); // real CJS syntax — caught
    fs.writeFileSync(path.join(root, 'test', 'retired-path.test.ts'),
      'const p = path.join(import.meta.dirname, "..", ".test-runtime", "lib");\n', 'utf8'); // .test-runtime in string — caught
    fs.writeFileSync(path.join(root, 'test', 'scenario.test.ts'),
      "const scenario = \"require('fs').readFileSync(x)\";\n", 'utf8'); // require( in string — not caught

    // src/: 4 (module.exports, type:commonjs, require(, .test-runtime)
    // test/: 2 (module.exports in cjs-syntax, .test-runtime in retired-path)
    assert.equal(findEsmOnlyViolations(root).length, 6);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
