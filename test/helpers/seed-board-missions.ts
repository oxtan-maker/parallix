import assert from 'node:assert/strict';
import path from 'node:path';
import { createMissionApplicationServices } from '../../src/composition/application-services.js';
import { missionId } from '../../src/domain/mission.js';

/** Populate the isolated board database; Markdown fixtures supply titles only. */
export async function seedBoardMissions(rootDir: string, stateDir: string, entries: readonly { id: string; title: string }[]): Promise<void> {
  const services = await createMissionApplicationServices(rootDir, { databasePath: path.join(stateDir, 'parallix.db') });
  for (const entry of entries) {
    const id = missionId(entry.id);
    const result = await services.intake.execute({ operationId: `${id}-fixture`, missionId: id,
      repositoryId: services.repositoryId, title: entry.title, capabilities: new Set(['mission:intake']) });
    assert.equal(result.status, 'completed');
    const loaded = await services.store.load(id);
    assert.equal(loaded.kind, 'found');
    if (loaded.kind !== 'found') { throw new Error(`Missing fixture ${id}`); }
    const saved = await services.store.save({ ...loaded.mission, status: 'refined', rawStatus: 'refined', closedAt: null }, loaded.version);
    assert.equal(saved, loaded.version + 1);
  }
}
