import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');

test('task-2332.09: every composed review loop injects mission services into automatic handoff', () => {
  const compositionFiles = [
    'src/composition/application-services.ts',
    'src/composition/create-cli.ts',
  ];

  for (const relative of compositionFiles) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.match(source, /performHandoffFn:\s*\(/, `${relative} must inject the review-loop handoff function`);
    assert.match(source, /missionServicesFn(?:\s*:|\s*[,}])|missionServices:\s*missionServicesFn/,
      `${relative} must bind Mission services for automatic handoff`);
  }
});
