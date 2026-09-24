/**
 * TASK-2521.04 — `px depends add|remove` end to end.
 *
 * Every write runs through the production command graph against a real SQLite
 * operator database, and every read comes back from that database through the
 * `mission_dependencies` table migration 0025 adds. Reads go to the store
 * rather than `px status --json` for the reason
 * `test/task-2521-03-context-cli.integration.test.ts` states: building the
 * board projection would list the repository's pull requests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { clearOperatorStateCache, initOperatorState } from '../src/adapters/sqlite/adapter-factory.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { run } from '../src/composition/create-cli.js';
import { agentFamily } from '../src/domain/agents.js';
import { intakeMission, missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const SLUG = 'task-2521-04-depends';
const OTHER = 'task-2521-04-predecessor';

test('px depends records Mission-to-Mission dependencies and refuses the rest', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-depends-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-depends-repo-'));
  fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({
    product: { name: 'Depends Fixture' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog' },
      missions: { baseDir: 'docs/missions' },
      verification: { command: './scripts/verify-local.sh {{area}}' },
      review: { provider: 'none' },
      agents: {},
    },
  }, null, 2));
  const previousHome = process.env.PARALLIX_HOME;
  const errors: string[] = [];
  process.env.PARALLIX_HOME = home;

  try {
    const { db } = await initOperatorState({ homeDir: home });
    const store = new SqliteMissionStore(db);
    for (const slug of [SLUG, OTHER]) {
      await store.save({
        ...intakeMission({
          id: missionId(slug),
          repositoryId: repositoryId('parallix'),
          title: `Dependency fixture ${slug}`,
          labels: missionLabels(['cli']),
          assignee: agentFamily('codex'),
        }),
      } as Mission, null);
    }
    await clearOperatorStateCache();

    const invoke = async (args: readonly string[]) => {
      errors.length = 0;
      const write = process.stdout.write.bind(process.stdout);
      (process.stdout as unknown as { write: (_chunk: string) => boolean }).write = () => true;
      try {
        return await run([...args], { baseCwd: repo, error: (message) => { errors.push(message); return message; } });
      } finally { (process.stdout as unknown as { write: typeof write }).write = write; }
    };
    /** Re-read the Mission exactly as a later agent would: from the database. */
    const recorded = async () => {
      await clearOperatorStateCache();
      const { db: readDb } = await initOperatorState({ homeDir: home });
      const loaded = await new SqliteMissionStore(readDb).load(missionId(SLUG));
      assert.equal(loaded.kind, 'found', 'the mission must stay readable');
      const found = loaded as { mission: Mission; version: number };
      return { dependencies: found.mission.dependencies ?? [], version: found.version };
    };

    // --- add, and read it back out of the database ------------------------
    let current = (await recorded()).version;
    assert.equal(
      await invoke(['depends', 'add', '--slug', SLUG, '--on', OTHER, '--expected-version', String(current)]),
      0,
      errors.join('\n'),
    );
    assert.deepEqual((await recorded()).dependencies, [OTHER]);

    // --- a stale version is rejected and changes nothing ------------------
    assert.equal(
      await invoke(['depends', 'remove', '--slug', SLUG, '--on', OTHER, '--expected-version', String(current)]),
      1,
    );
    assert.match(errors.join('\n'), /expected version/);
    assert.deepEqual((await recorded()).dependencies, [OTHER], 'the stale write changed nothing');

    // --- a self-reference is refused --------------------------------------
    current = (await recorded()).version;
    assert.equal(
      await invoke(['depends', 'add', '--slug', SLUG, '--on', SLUG, '--expected-version', String(current)]),
      1,
    );
    assert.match(errors.join('\n'), /cannot depend on itself/);

    // --- an id that is not a Mission is refused ---------------------------
    assert.equal(
      await invoke(['depends', 'add', '--slug', SLUG, '--on', 'task-does-not-exist', '--expected-version', String(current)]),
      1,
    );
    assert.match(errors.join('\n'), /dependency is not a mission/);
    assert.deepEqual((await recorded()).dependencies, [OTHER], 'neither refusal wrote a row');

    // --- remove ------------------------------------------------------------
    assert.equal(
      await invoke(['depends', 'remove', '--slug', SLUG, '--on', OTHER, '--expected-version', String(current)]),
      0,
      errors.join('\n'),
    );
    assert.deepEqual((await recorded()).dependencies, []);
  } finally {
    await clearOperatorStateCache();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
