import test from 'node:test';
import assert from 'node:assert/strict';
import { typeEscapeSites } from '../../../scripts/type-escape-report.js';

test('report-only configuration escape audit detects nested and parenthesized literals (TASK-2709)', () => {
  const source = `factory({ config: ({ nested: {} } as never), other: (({}) as unknown) as Options });
    factory(({ rebaseWorkflowConfig } as unknown as Options));`;
  assert.equal(typeEscapeSites('fixture.ts', source).length, 3);
  // Literal from d423cbea3^:src/adapters/review/review-loop.ts.
  assert.equal(typeEscapeSites('fixture.ts', `const options = {
    ...(missionStore ? { rebaseWorkflowOptions: { missionServicesFn: async () => ({ store: missionStore, lifecycle: lifecycleService }) } as never } : {}),
  };`).length, 1);
});

test('configuration escape audit accepts typed literals and unrelated casts and records documented exemptions', () => {
  assert.deepEqual(typeEscapeSites('fixture.ts', `const a: Options = {}; const b = {} satisfies Options;
    const c = value as never; const d = value as unknown as Options; const e = {} as Options;`), []);
  const sites = typeEscapeSites('fixture.ts', `// type-escape-exempt: invalid input intentionally exercises rejection
    factory({} as never);`);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].exemption, 'invalid input intentionally exercises rejection');
});
