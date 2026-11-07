import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MissionBriefService } from '../../../src/application/mission-brief-service.js';
import { missionVersion, type MissionStore } from '../../../src/application/domain-ports.js';
import { createDefectProvenanceCommand } from '../../../src/interfaces/cli/defect-provenance-write.js';
import { setLogger } from '../../../src/application/presentation/cli-format.js';
import { missionId, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';

export function defectProvenanceAuthoringCases(): void {
  describe('Defect provenance authoring', () => {
    test('typed service records and replaces provenance after validating attribution references', async () => {
      const target = fixtureMission('px-0300', { checkpoints: [] });
      const origin = fixtureMission('px-0301', { checkpoints: [] });
      const crossRepository = fixtureMission('px-0302', { checkpoints: [], repositoryId: repositoryId('other') });
      const missions = new Map<string, Mission>([[target.id, target], [origin.id, origin], [crossRepository.id, crossRepository]]);
      let version = 1; let writes = 0;
      const store: MissionStore = {
        async load(id) { const mission = missions.get(id); return mission ? { kind: 'found', mission, version: missionVersion(version) } : { kind: 'missing' }; },
        async save(mission, expected) { assert.equal(expected, version); writes++; missions.set(mission.id, mission); return missionVersion(++version); },
      };
      const service = new MissionBriefService(store);
      const request = (attribution: Parameters<typeof service.setDefectProvenance>[0]['provenance']['attribution']) => ({
        operationId: 'provenance', missionId: target.id, capabilities: new Set(['mission:context'] as const),
        provenance: { rootCauseSummary: 'Cause', investigationEvidence: 'Evidence', attribution },
      });
      for (const [attribution, message] of [
        [{ kind: 'originating-mission', missionId: missionId('px-9999') }, /does not exist/],
        [{ kind: 'originating-mission', missionId: crossRepository.id }, /different repository/],
        [{ kind: 'originating-mission', missionId: target.id }, /cannot attribute its defect to itself/],
      ] as const) {
        const result = await service.setDefectProvenance(request(attribution));
        assert.equal(result.error?.kind, 'validation'); assert.match(result.error?.message ?? '', message); assert.equal(writes, 0);
      }
      const result = await service.setDefectProvenance(request({ kind: 'originating-mission', missionId: origin.id }));
      assert.equal(result.status, 'completed'); assert.equal(writes, 1);
      assert.deepEqual(missions.get(target.id)?.defectProvenance, result.value?.defectProvenance);
    });

    test('public command requires exactly one disposition and sends one atomic write', async () => {
      const writes: unknown[] = [];
      const command = createDefectProvenanceCommand({
        resolveSlug: () => 'px-0300',
        brief: { async setDefectProvenance(request) { writes.push(request); return { status: 'completed', durableEvidence: [], value: { defectProvenance: request.provenance, version: missionVersion(2) } }; } },
        defectProvenanceBackfill: { async preview() { throw new Error('unused'); }, async apply() { throw new Error('unused'); } },
        readBackfillEntries() { throw new Error('unused'); },
      });
      for (const args of [
        ['set', '--root-cause', 'Cause', '--evidence', 'Evidence'],
        ['set', '--root-cause', 'Cause', '--evidence', 'Evidence', '--external', '--unresolved'],
        ['set', '--root-cause', 'Cause', '--evidence', 'Evidence', '--originating-mission'],
      ]) {
        await assert.rejects(command(args)); assert.equal(writes.length, 0);
      }
      const previous = setLogger({ log: () => {} });
      try {
        await command(['set', '--root-cause', 'Cause', '--evidence', 'Evidence', '--originating-mission', 'px-0301']);
      } finally { setLogger(previous); }
      assert.equal(writes.length, 1);
      assert.deepEqual((writes[0] as { provenance: unknown }).provenance, {
        rootCauseSummary: 'Cause', investigationEvidence: 'Evidence',
        attribution: { kind: 'originating-mission', missionId: 'px-0301' },
      });
    });
  });
}
