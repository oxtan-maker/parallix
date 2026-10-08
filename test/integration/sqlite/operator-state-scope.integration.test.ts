import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createProductionApplicationServices } from '../../../src/composition/application-services.js';
import { clearOperatorStateCache } from '../../../src/adapters/sqlite/adapter-factory.js';
import { intakeMission, missionId, missionLabels } from '../../../src/domain/mission.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { resolveConfiguration } from '../../../src/composition/config.js';

test('review scope cleanup leaves the enclosing integration store usable', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-scope-'));
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  try {
    const integration = await createProductionApplicationServices(process.cwd(), undefined, { configuration: resolveConfiguration(process.env) });
    const review = await createProductionApplicationServices(process.cwd(), undefined, { configuration: resolveConfiguration(process.env) });
    assert.ok(integration.mission);
    assert.equal(integration.executeMission.constructor.name, 'ExecuteMissionService');
    assert.equal(integration.statsBackfill.constructor.name, 'StatsBackfillService');
    assert.equal(integration.mission.store.constructor.name, 'SqliteMissionStore');
    assert.ok(review.mission);
    assert.ok(integration.operatorState.db);
    assert.strictEqual(review.operatorState.db, integration.operatorState.db);
    const mission = intakeMission({
      id: missionId('task-scope-regression'),
      repositoryId: integration.mission.repositoryId,
      title: 'Nested review cleanup',
      labels: missionLabels([]),
      assignee: agentFamily('codex'),
    });
    // Leave a review write queued, as happens when the approval is recorded.
    const writing = review.mission.store.save(mission, null);
    await review.operatorState.close();
    await writing;
    const approved = await integration.mission.store.load(mission.id);
    assert.equal(approved.kind, 'found');
    if (approved.kind !== 'found') { throw new Error('review write was lost'); }
    await integration.mission.store.save({ ...approved.mission, title: 'Integration resumed' }, approved.version);
    await integration.operatorState.close();
    // Later commands in the same process also reuse the live handle.
    const later = await createProductionApplicationServices(process.cwd(), undefined, { configuration: resolveConfiguration(process.env) });
    assert.ok(later.mission);
    assert.strictEqual(later.operatorState.db, integration.operatorState.db);
    const resumed = await later.mission.store.load(mission.id);
    assert.equal(resumed.kind === 'found' && resumed.mission.title, 'Integration resumed');
    await later.operatorState.close();
  } finally {
    await clearOperatorStateCache();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    fs.rmSync(home, { recursive: true, force: true });
  }
});
