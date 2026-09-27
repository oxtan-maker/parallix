import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeTypeOnlyCoverage } from '../src/adapters/verification/type-only-coverage.js';

test('coverage normalization preserves the real TypeScript emit contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'type-only-coverage-'));
  try {
    const sources = {
      'ports.ts': 'export interface Port { run(): void }\nexport type Id = string;',
      'types.ts': 'type Id = string;',
      'mixed.ts': 'export interface Port { run(): void }\nexport const count = 0;',
      'side-effect.ts': 'import "./mixed.js";',
      'enum.ts': 'export enum State { Active, Done }',
    };
    for (const [file, source] of Object.entries(sources)) { fs.writeFileSync(path.join(root, file), source); }
    const records = [...Object.keys(sources), 'missing.ts'].map(file => `SF:${file}\nDA:1,0\nLF:1\nLH:0\nend_of_record\n`).join('');
    const result = removeTypeOnlyCoverage(records, root);
    assert.doesNotMatch(result, /SF:ports.ts/);
    assert.doesNotMatch(result, /SF:types.ts/);
    for (const file of ['mixed.ts', 'side-effect.ts', 'enum.ts', 'missing.ts']) {
      assert.ok(result.includes(`SF:${file}\nDA:1,0`), `uncovered runtime code must remain: ${file}`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
