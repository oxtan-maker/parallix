const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../package.json');

test('build:cjs is a no-emit compatibility check and cannot create source siblings', () => {
  const command = packageJson.scripts['build:cjs'];
  assert.match(command, /\btsc\b/);
  assert.match(command, /--noEmit\b/);
  assert.match(command, /--module CommonJS\b/);
  assert.doesNotMatch(command, /--outDir\s+\./);
});

test('prepack builds dist before checking freshness', () => {
  assert.equal(
    packageJson.scripts.prepack,
    'npm run build:cjs && npm run build && npm run publish:guard',
  );
});
