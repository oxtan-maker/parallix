


import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const repoRoot = path.resolve(import.meta.dirname, '..');
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

test('px runtime smoke test verifies the source entrypoint executes without module resolution errors', (t) => {
  if (nodeMajor < 24) {
    t.skip(`requires Node >= 24 (got ${process.version})`);
    return;
  }
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `features` absent from its inferred mock shape.
  if (process.features?.typescript !== true) {
    t.skip(`Node runtime lacks built-in TypeScript entrypoint support (process.features.typescript=${String(process.features?.typescript)})`);
    return;
  }
  const result = spawnSync('node', ['src/entry/px.ts', '--version'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;

  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND/);
});
