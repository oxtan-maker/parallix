import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { removeTypeOnlyCoverage } from '../src/adapters/verification/type-only-coverage.js';

test('coverage omits erased declarations but keeps mixed modules and runtime imports', () => {
  const root = path.resolve('virtual-coverage-root');
  // The real compiler contract is exercised in type-only-coverage.integration.test.ts.
  const fixtures = new Map([
    ['ports.ts', { source: 'export interface Port { run(): void }', emitted: 'export {};\n' }],
    ['types.ts', { source: 'type Id = string;', emitted: '\n' }],
    ['mixed.ts', { source: 'export interface Port {}\nexport const count = 0;', emitted: 'export const count = 0;\n' }],
    ['side-effect.ts', { source: 'import "./mixed.js";', emitted: 'import "./mixed.js";\n' }],
    ['enum.ts', { source: 'export enum State { Active, Done }', emitted: 'export var State;\n(function (State) {})(State || (State = {}));\n' }],
  ]);
  const reads: string[] = [];
  const emissions: string[] = [];
  const files = [...fixtures.keys(), 'missing.ts', '../outside.ts', 'runtime.js'];
  const record = (file: string) => `SF:${file}\nDA:1,0\nLF:1\nLH:0\nend_of_record\n`;
  const result = removeTypeOnlyCoverage(files.map(record).join(''), root, {
    readSource(file) {
      assert.equal(path.dirname(file), root, 'never read outside the coverage root');
      const name = path.basename(file);
      reads.push(name);
      return fixtures.get(name)?.source;
    },
    emitSource(source, file) {
      const name = path.basename(file);
      const fixture = fixtures.get(name);
      assert.ok(fixture, 'only existing TypeScript sources are compiled');
      assert.equal(source, fixture.source);
      emissions.push(name);
      return fixture.emitted;
    },
  });
  assert.equal(result, '\n' + files.filter(file => file !== 'ports.ts' && file !== 'types.ts').map(record).join(''));
  assert.deepEqual(reads, [...fixtures.keys(), 'missing.ts']);
  assert.deepEqual(emissions, [...fixtures.keys()]);
});
