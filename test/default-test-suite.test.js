const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('default test runner leaves integration-only E2E suites to integration gates', () => {
  const runner = fs.readFileSync(path.join(__dirname, 'run-default-tests.js'), 'utf8');

  assert.match(runner, /file !== 'e2e-mission-lifecycle\.test\.js'/);
  assert.match(runner, /file !== 'e2e-real-agent-smoke\.test\.js'/);
});
