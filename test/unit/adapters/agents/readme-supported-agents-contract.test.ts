// README supported-agent contract (TASK-2649): the agents README advertises
// must be the agents the launcher registry can actually start. The README names
// each agent's launcher key as `(\`<key>\`)`; the registry stays the only
// authority, so this suite compares keys, never agent prose.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LAUNCHERS } from '../../../../src/adapters/agents/launcher-selection.js';

function supportedAgentsSection(readme: string): string {
  const start = readme.indexOf('\n## Supported coding agents\n');
  assert.notEqual(start, -1, 'README.md must have a "## Supported coding agents" section');
  const end = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, end === -1 ? undefined : end);
}

function advertisedLauncherKeys(section: string): string[] {
  return [...section.matchAll(/\(`([a-z][a-z0-9-]*)`\)/g)].map((match) => match[1]);
}

test('every README-advertised coding agent has a production launcher (TASK-2649)', () => {
  const advertised = advertisedLauncherKeys(supportedAgentsSection(fs.readFileSync('README.md', 'utf8')));
  assert.ok(advertised.length > 0, 'README must name launcher keys as (`<key>`) in its supported-agent section');
  const launchers = Object.keys(LAUNCHERS);
  for (const key of advertised) {
    assert.ok(launchers.includes(key), `README advertises "${key}" but LAUNCHERS has no such launcher`);
  }
  assert.deepEqual([...new Set(advertised)].sort(), [...launchers].sort(), 'README must advertise every production launcher exactly as the registry names it');
});

test('a README agent without a launcher is rejected (TASK-2649)', () => {
  const keys = advertisedLauncherKeys(supportedAgentsSection('# x\n\n## Supported coding agents\n\n- Imaginary (`imaginary`)\n\n## Next\n'));
  assert.deepEqual(keys, ['imaginary']);
  assert.equal(Object.keys(LAUNCHERS).includes('imaginary'), false);
});
