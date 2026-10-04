/**
 * TASK-2609 — `px classification set` no longer takes `--expected-version`.
 *
 * The flag is dropped from the command, its help, and its call path, while the
 * optimistic-concurrency guard still runs: the version is discovered from stored
 * mission state and written back through the store's own guard. This test pins
 * that behaviour end to end against a real SQLite operator database, the same
 * production command graph `px status` reads from.
 */

import test from 'node:test';
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

test('classification set discovers the version itself and records the value', async () => {
  const home = mkdtemp('parallix-class-');
  const repo = mkdtemp('parallix-class-repo-');
  fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({
    product: { name: 'Classification Fixture' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog' },
      missions: { baseDir: 'docs/missions' },
      verification: { command: './scripts/verify-local.sh {{area}}' },
      review: { provider: 'none' },
      agents: {},
    },
  }, null, 2));
  const previousHome = process.env.PARALLIX_HOME;
  const output: string[] = [];
  const errors: string[] = [];
  process.env.PARALLIX_HOME = home;

  try {
    const { db } = await initOperatorState({ homeDir: home });
    const store = new SqliteMissionStore(db);
    await store.save({
      ...intakeMission({
        id: missionId(SLUG),
        repositoryId: repositoryId('parallix'),
        title: 'Classification fixture',
        labels: missionLabels(['cli']),
        assignee: agentFamily('codex'),
      }),
      status: 'active',
      brief: missionBrief({
        goal: 'Prove classification set needs no flag',
        why: 'The version is discoverable from mission state.',
        scope: null,
        outOfScope: [],
      }),
    }, null);
    await clearOperatorStateCache();

    const invoke = async (args: string[]) => {
      output.length = 0;
      errors.length = 0;
      const write = process.stdout.write.bind(process.stdout);
      (process.stdout as unknown as { write: (_chunk: string) => boolean }).write = (chunk) => {
        output.push(String(chunk));
        return true;
      };
      try { return await run(args, { baseCwd: repo, error: (message) => { errors.push(message); return message; } }); }
      finally { (process.stdout as unknown as { write: typeof write }).write = write; }
    };
    const readBack = async () => {
      await clearOperatorStateCache();
      const { db: readDb } = await initOperatorState({ homeDir: home });
      const loaded = await new SqliteMissionStore(readDb).load(missionId(SLUG));
      return loaded as { mission: Mission; version: number };
    };

    const before = await readBack();
    // No --expected-version: the command discovers the version itself.
    assert.equal(await invoke(['classification', 'set', '--slug', SLUG, '--value', 'user_value']), 0, errors.join('\n'));
    // The write used the version it just discovered: exactly one increment.
    const after = await readBack();
    assert.equal(after.version, before.version + 1, 'classification set must write with the discovered version');
    assert.match(JSON.parse(output.join('')).classification, /user_value/);
    const labels = after.mission.labels ?? [];
    assert.ok(labels.includes('user_value' as MissionLabel), 'user_value must be recorded on the Mission');
  } finally {
    process.env.PARALLIX_HOME = previousHome;
  }
});

test('classification set still rejects a value that is not one of the allowed labels', async () => {
  const home = mkdtemp('parallix-class-');
  const repo = mkdtemp('parallix-class-repo-');
  fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({
    product: { name: 'Classification Fixture' },
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
    await store.save({
      ...intakeMission({
        id: missionId(SLUG),
        repositoryId: repositoryId('parallix'),
        title: 'Classification fixture',
        labels: missionLabels(['cli']),
        assignee: agentFamily('codex'),
      }),
      status: 'active',
      brief: missionBrief({ goal: 'g', why: 'w', scope: null, outOfScope: [] }),
    }, null);
    await clearOperatorStateCache();

    const invoke = async (args: string[]) => {
      errors.length = 0;
      const write = process.stdout.write.bind(process.stdout);
      (process.stdout as unknown as { write: (_chunk: string) => boolean }).write = (chunk) => true;
      try { return await run(args, { baseCwd: repo, error: (message) => { errors.push(message); return message; } }); }
      finally { (process.stdout as unknown as { write: typeof write }).write = write; }
    };

    assert.equal(await invoke(['classification', 'set', '--slug', SLUG, '--value', 'bogus']), 1);
    assert.match(errors.join('\n'), /exactly one of ai_sdlc, user_value, or unknown/);
    // The rejected write changed nothing.
    const after = await new SqliteMissionStore((await initOperatorState({ homeDir: home })).db).load(missionId(SLUG));
    assert.deepEqual((after as { mission: Mission }).mission.labels ?? [], ['cli']);
  } finally {
    process.env.PARALLIX_HOME = previousHome;
  }
});

test('other write verbs still require --expected-version', async () => {
  const home = mkdtemp('parallix-class-');
  const repo = mkdtemp('parallix-class-repo-');
  fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({
    product: { name: 'Classification Fixture' },
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
    await store.save({
      ...intakeMission({
        id: missionId(SLUG),
        repositoryId: repositoryId('parallix'),
        title: 'Classification fixture',
        labels: missionLabels(['cli']),
        assignee: agentFamily('codex'),
      }),
      status: 'active',
      brief: missionBrief({ goal: 'Prove other verbs keep the flag', why: 'w', scope: null, outOfScope: [] }),
    }, null);
    await clearOperatorStateCache();

    const invoke = async (args: string[]) => {
      errors.length = 0;
      const write = process.stdout.write.bind(process.stdout);
      (process.stdout as unknown as { write: (_chunk: string) => boolean }).write = (chunk) => true;
      try { return await run(args, { baseCwd: repo, error: (message) => { errors.push(message); return message; } }); }
      finally { (process.stdout as unknown as { write: typeof write }).write = write; }
    };

    assert.equal(await invoke(['goal', 'set', '--slug', SLUG, '--goal', 'x', '--why', 'y']), 1);
    assert.match(errors.join('\n'), /--expected-version <n> is required/);
  } finally {
    process.env.PARALLIX_HOME = previousHome;
  }
});

