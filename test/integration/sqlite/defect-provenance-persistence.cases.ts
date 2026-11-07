import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { missionVersion } from '../../../src/application/domain-ports.js';
import { DefectProvenanceViolation, type DefectProvenance } from '../../../src/domain/defect-provenance.js';
import { missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { openMigratedMissionStore } from '../../fixtures/mission-sqlite-store.js';

const evidence = 'The focused reproduction and retained diff identify the faulty ownership change.';
const provenance = (attribution: DefectProvenance['attribution']): DefectProvenance => ({
  rootCauseSummary: 'A lifecycle retry was owned by the wrong boundary.',
  investigationEvidence: evidence,
  attribution,
});

export function defectProvenancePersistenceCases(): void {
  describe('Defect provenance persistence', () => {
    test('migrated legacy Missions read null and every disposition round-trips', async () => {
      const origin = fixtureMission('px-0100', { checkpoints: [] });
      const legacy = fixtureMission('px-0101', { checkpoints: [] });
      const f = await openMigratedMissionStore([origin, legacy]);
      try {
        const legacyRead = await f.store.load(legacy.id);
        assert.equal(legacyRead.kind === 'found' ? legacyRead.mission.defectProvenance : undefined, null);
        const values: DefectProvenance['attribution'][] = [
          { kind: 'originating-mission', missionId: origin.id },
          { kind: 'external' },
          { kind: 'pre-mission' },
          { kind: 'unresolved' },
        ];
        for (const [index, attribution] of values.entries()) {
          const mission = fixtureMission(`px-011${index}`, { checkpoints: [], defectProvenance: provenance(attribution) });
          await f.store.save(mission, null);
          const loaded = await f.store.load(mission.id);
          assert.equal(loaded.kind, 'found');
          assert.deepEqual(loaded.kind === 'found' ? loaded.mission.defectProvenance : null, mission.defectProvenance);
        }
      } finally { await f.close(); }
    });

    test('invalid attribution references and stale replacement roll back atomically', async () => {
      const origin = fixtureMission('px-0200', { checkpoints: [] });
      const target = fixtureMission('px-0201', { checkpoints: [], defectProvenance: provenance({ kind: 'unresolved' }) });
      const otherRepository = fixtureMission('px-0202', { checkpoints: [], repositoryId: repositoryId('other') });
      const f = await openMigratedMissionStore([origin, target, otherRepository]);
      try {
        const initial = await f.store.load(target.id);
        assert.equal(initial.kind, 'found');
        if (initial.kind !== 'found') { throw new Error('target missing'); }
        const invalid = [
          provenance({ kind: 'originating-mission', missionId: missionId('px-9999') }),
          provenance({ kind: 'originating-mission', missionId: otherRepository.id }),
          provenance({ kind: 'originating-mission', missionId: target.id }),
        ];
        for (const value of invalid) {
          await assert.rejects(
            f.store.save({ ...initial.mission, defectProvenance: value }, initial.version),
            DefectProvenanceViolation,
          );
          assert.deepEqual(await f.store.load(target.id), initial);
        }
        const replacedVersion = await f.store.save({
          ...initial.mission,
          defectProvenance: provenance({ kind: 'originating-mission', missionId: origin.id }),
        }, initial.version);
        assert.equal(replacedVersion, missionVersion(2));
        await assert.rejects(
          f.store.save({ ...initial.mission, defectProvenance: provenance({ kind: 'external' }) }, initial.version),
          /Stale write/,
        );
        const final = await f.store.load(target.id);
        assert.deepEqual(final.kind === 'found' ? final.mission.defectProvenance : null,
          provenance({ kind: 'originating-mission', missionId: origin.id }));
      } finally { await f.close(); }
    });
  });
}
