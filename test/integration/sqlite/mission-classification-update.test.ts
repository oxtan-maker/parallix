/**
 * TASK-2609 — `px classification set` no longer takes `--expected-version`.
 *
 * The flag is dropped from the command, its help, and its call path, while the
 * optimistic-concurrency guard still runs: the version is discovered from stored
 * mission state and written back through the store's own guard. This test pins
 * that persistence behaviour against a real SQLite operator database, the same
 * production command graph `px status` reads from.
 */

import test, { before } from 'node:test';
import { copyMigratedSchema, prepareMigratedSchema } from '../../fixtures/migrated-database.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { mkdtemp } from '../../helpers/temp-dir.js';
import { clearOperatorStateCache, initOperatorState } from '../../../src/adapters/sqlite/adapter-factory.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { run } from '../../../src/composition/create-cli.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionBrief } from '../../../src/domain/mission-brief.js';
import { intakeMission, missionId, missionLabels, type Mission, type MissionLabel } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';

const SLUG = 'task-2609-classification-set';
before(prepareMigratedSchema);

async function withClassificationFixture(check: (_fixture: {
  invoke(_args: string[]): Promise<number>;
  readBack(): Promise<{ mission: Mission; version: number }>;
  output: string[];
  errors: string[];
}) => Promise<void>) {
  const home = mkdtemp('parallix-class-');
  const repo = mkdtemp('parallix-class-repo-');
  const previousHome = process.env.PARALLIX_HOME;
  const output: string[] = [];
  const errors: string[] = [];
  try {
    copyMigratedSchema(path.join(home, 'parallix.db'));
    fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Classification Fixture' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions' },
        verification: { command: './scripts/verify-local.sh {{area}}' },
        review: { provider: 'none' }, agents: {},
      },
    }));
    process.env.PARALLIX_HOME = home;
    const { db } = await initOperatorState({ homeDir: home });
    await new SqliteMissionStore(db).save({
      ...intakeMission({
        id: missionId(SLUG), repositoryId: repositoryId('parallix'),
        title: 'Classification fixture', labels: missionLabels(['cli']), assignee: agentFamily('codex'),
      }),
      status: 'active',
      brief: missionBrief({ goal: 'Prove classification writes', why: 'The version is discoverable from mission state.', scope: null, outOfScope: [] }),
    }, null);
    await clearOperatorStateCache();
    await check({
      output, errors,
      async invoke(args) {
        output.length = 0; errors.length = 0;
        const write = process.stdout.write;
        process.stdout.write = chunk => { output.push(String(chunk)); return true; };
        try { return await run(args, { baseCwd: repo, error: message => { errors.push(message); return message; } }); }
        finally { process.stdout.write = write; }
      },
      async readBack() {
        await clearOperatorStateCache();
        const { db: readDb } = await initOperatorState({ homeDir: home });
        return await new SqliteMissionStore(readDb).load(missionId(SLUG)) as { mission: Mission; version: number };
      },
    });
  } finally {
    await clearOperatorStateCache();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

test('classification set discovers the version itself and records the value', async () => {
  await withClassificationFixture(async ({ invoke, readBack, output, errors }) => {
    const before = await readBack();
    // No --expected-version: the command discovers the version itself.
    assert.equal(await invoke(['classification', 'set', '--slug', SLUG, '--value', 'user_value']), 0, errors.join('\n'));
    const after = await readBack();
    assert.equal(after.version, before.version + 1, 'classification set must write with the discovered version');
    assert.match(JSON.parse(output.join('')).classification, /user_value/);
    assert.ok((after.mission.labels ?? []).includes('user_value' as MissionLabel), 'user_value must be recorded on the Mission');
  });
});

test('classification set still rejects a value that is not one of the allowed labels', async () => {
  await withClassificationFixture(async ({ invoke, readBack, errors }) => {
    assert.equal(await invoke(['classification', 'set', '--slug', SLUG, '--value', 'bogus']), 1);
    assert.match(errors.join('\n'), /exactly one of ai_sdlc, user_value, or unknown/);
    // The rejected write changed nothing.
    assert.deepEqual((await readBack()).mission.labels ?? [], ['cli']);
  });
});

test('other write verbs resolve the version without --expected-version', async () => {
  await withClassificationFixture(async ({ invoke, readBack, errors }) => {
    assert.equal(await invoke(['goal', 'set', '--slug', SLUG, '--goal', 'x', '--why', 'y']), 0, errors.join('\n'));
    assert.equal((await readBack()).mission.brief?.goal, 'x');
  });
});
