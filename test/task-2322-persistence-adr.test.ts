import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();
const adrPath = path.join(
  root,
  'docs/adr/0053-operational-persistence-and-authority-boundaries.md',
);
const adr = fs.readFileSync(adrPath, 'utf8');

const checkedDomainNames = [
  ['RepositoryId', 'src/domain/repository.ts'],
  ['KnownRepository', 'src/domain/repository.ts'],
  ['Mission', 'src/domain/mission.ts'],
  ['CheckpointData', 'src/domain/checkpoint.ts'],
  ['Review', 'src/domain/review.ts'],
  ['AgentRunMeasurement', 'src/domain/usage.ts'],
  ['MissionOutcome', 'src/domain/usage.ts'],
  ['SessionMarker', 'src/domain/session.ts'],
  ['LaneTransitionEvent', 'src/domain/board-event.ts'],
  ['AgentBlock', 'src/domain/agents.ts'],
] as const;

test('ADR 0053 persistence names resolve to checked domain types', () => {
  for (const [name, relative] of checkedDomainNames) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.match(
      source,
      new RegExp(`export (?:interface|type|class) ${name}\\b`),
      `${name} must remain a checked domain name`,
    );
    assert.match(adr, new RegExp(`\\b${name}\\b`), `ADR 0053 must name ${name}`);
  }
});

test('ADR 0053 excludes schema-led Attempt modeling', () => {
  const domainSource = fs.readdirSync(path.join(root, 'src/domain'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => fs.readFileSync(path.join(root, 'src/domain', name), 'utf8'))
    .join('\n');

  assert.doesNotMatch(domainSource, /export (?:interface|type|class) Attempt\b/);
  assert.match(adr, /\| `Attempt` \| \*\*Excluded\.\*\*/);
  assert.match(adr, /does not introduce `Attempt`/);
});

test('ADR index and domain README defer persistence authority to ADR 0053', () => {
  const index = fs.readFileSync(path.join(root, 'docs/adr/index.md'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'src/domain/README.md'), 'utf8');

  assert.match(index, /0053-operational-persistence-and-authority-boundaries\.md/);
  assert.match(readme, /ADR 0053 owns those decisions/);
  assert.doesNotMatch(readme, /ADR 0044 makes .*MissionStore/s);
  assert.doesNotMatch(readme, /repository-local MissionStore/);
  assert.doesNotMatch(readme, /operator-local[^.\n]+not a MissionStore/);
});
