import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DefectProvenanceBackfillService } from '../../../src/application/defect-provenance-backfill-service.js';
import type { DefectProvenanceBackfillEntry } from '../../../src/application/ports/defect-provenance-backfill.js';
import { missionId, missionLabels } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { openMigratedMissionStore, type MigratedMissionStore } from '../../fixtures/mission-sqlite-store.js';

const REPOSITORY = repositoryId('parallix');
const unresolved = (mission: string): DefectProvenanceBackfillEntry => ({
  missionId: missionId(mission),
  provenance: { rootCauseSummary: `Root cause for ${mission}`, investigationEvidence: `test/repro.test.ts and retained diff for ${mission}`, attribution: { kind: 'unresolved' } },
});

async function completion(f: MigratedMissionStore, mission: string, repository: string, occurredAt: string): Promise<void> {
  await f.database.execute(
    `INSERT INTO board_lane_events
       (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
     VALUES (?, ?, 'integration', 'done', 'integrate', 'codex', ?, ?)`,
    [repository, mission, occurredAt, `complete:${repository}:${mission}`],
  );
}

async function recoveredCompletion(f: MigratedMissionStore, mission: string, occurredAt: string): Promise<void> {
  await f.database.execute(
    `INSERT INTO board_lane_events
       (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
     VALUES (?, ?, 'review', 'done', 'recover-landed', 'codex', ?, ?)`,
    [REPOSITORY, mission, occurredAt, `recover:${mission}`],
  );
}

export function defectProvenanceBackfillCases(): void {
  describe('Defect provenance historical backfill', () => {
    test('selects the newest 100 exact stored bug labels by canonical completion and applies idempotently', async () => {
      const origin = fixtureMission('px-0900', { checkpoints: [] });
      const bugs = Array.from({ length: 103 }, (_, index) => {
        const id = `px-${1000 + index}`;
        const completedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
        return fixtureMission(id, { status: 'done', closedAt: completedAt, checkpoints: [], labels: missionLabels(['bug']),
          ...(index === 102 ? { defectProvenance: { rootCauseSummary: 'Preserve me', investigationEvidence: 'Existing evidence', attribution: { kind: 'external' as const } } } : {}) });
      });
      const nonBug = fixtureMission('px-1200', { status: 'done', closedAt: '2026-02-01T00:00:00.000Z', checkpoints: [], labels: missionLabels(['bugfix']) });
      const otherRepoBug = fixtureMission('px-1201', { status: 'done', closedAt: '2026-02-02T00:00:00.000Z', checkpoints: [], labels: missionLabels(['bug']), repositoryId: repositoryId('other') });
      const f = await openMigratedMissionStore([origin, ...bugs, nonBug, otherRepoBug]);
      try {
        for (const mission of bugs) {
          if (mission.id === 'px-1102') { await recoveredCompletion(f, mission.id, mission.closedAt!); }
          else { await completion(f, mission.id, REPOSITORY, mission.closedAt!); }
        }
        await completion(f, nonBug.id, REPOSITORY, nonBug.closedAt!);
        await completion(f, otherRepoBug.id, 'other', otherRepoBug.closedAt!);
        const selected = bugs.slice(3).reverse();
        const entries = selected.slice(1).map((mission, index): DefectProvenanceBackfillEntry => {
          const attribution = index % 4 === 0 ? { kind: 'originating-mission' as const, missionId: origin.id }
            : index % 4 === 1 ? { kind: 'external' as const }
              : index % 4 === 2 ? { kind: 'pre-mission' as const }
                : { kind: 'unresolved' as const };
          return { missionId: mission.id, provenance: { rootCauseSummary: `Cause ${mission.id}`,
            investigationEvidence: `Reproduction and retained diff ${mission.id}`, attribution } };
        });
        const service = new DefectProvenanceBackfillService(f.store, REPOSITORY);
        const preview = await service.preview(entries);
        assert.deepEqual({ targeted: preview.targeted, attributed: preview.attributed,
          externalOrPreMission: preview.externalOrPreMission, unresolved: preview.unresolved,
          alreadyPopulated: preview.alreadyPopulated, failed: preview.failed, applied: preview.applied },
        { targeted: 100, attributed: 25, externalOrPreMission: 50, unresolved: 24, alreadyPopulated: 1, failed: 0, applied: 0 });
        assert.equal(preview.rows[0]?.missionId, 'px-1102');
        assert.equal(preview.rows.at(-1)?.missionId, 'px-1003');
        assert.equal(preview.committed, false);
        const applied = await service.apply(entries);
        assert.equal(applied.committed, true); assert.equal(applied.applied, 99);
        const repeat = await service.apply(entries);
        assert.deepEqual({ targeted: repeat.targeted, alreadyPopulated: repeat.alreadyPopulated, failed: repeat.failed, applied: repeat.applied },
          { targeted: 100, alreadyPopulated: 100, failed: 0, applied: 0 });
        const preserved = await f.store.load(missionId('px-1102'));
        assert.equal(preserved.kind === 'found' ? preserved.mission.defectProvenance?.rootCauseSummary : null, 'Preserve me');
        for (const excluded of ['px-1000', 'px-1001', 'px-1002', nonBug.id, otherRepoBug.id]) {
          const loaded = await f.store.load(missionId(excluded));
          assert.equal(loaded.kind === 'found' ? loaded.mission.defectProvenance : undefined, null);
        }
      } finally { await f.close(); }
    });

    test('validation and write failures roll the whole apply back with complete accounting', async () => {
      const first = fixtureMission('px-2000', { status: 'done', closedAt: '2026-01-02T00:00:00.000Z', checkpoints: [], labels: missionLabels(['bug']) });
      const second = fixtureMission('px-2001', { status: 'done', closedAt: '2026-01-03T00:00:00.000Z', checkpoints: [], labels: missionLabels(['bug']) });
      const f = await openMigratedMissionStore([first, second]);
      try {
        await completion(f, first.id, REPOSITORY, first.closedAt!); await completion(f, second.id, REPOSITORY, second.closedAt!);
        const service = new DefectProvenanceBackfillService(f.store, REPOSITORY);
        const incomplete = await service.apply([unresolved(first.id)]);
        assert.deepEqual({ committed: incomplete.committed, targeted: incomplete.targeted, unresolved: incomplete.unresolved,
          failed: incomplete.failed, applied: incomplete.applied }, { committed: false, targeted: 2, unresolved: 1, failed: 1, applied: 0 });
        assert.match(incomplete.rows.find(row => row.missionId === second.id)?.reason ?? '', /no provenance supplied/);
        await f.database.execute(`CREATE TRIGGER reject_second_provenance BEFORE INSERT ON mission_defect_provenance
          WHEN NEW.mission_id = 'px-2001' BEGIN SELECT RAISE(ABORT, 'injected backfill failure'); END`);
        await assert.rejects(service.apply([unresolved(first.id), unresolved(second.id)]), /injected backfill failure/);
        for (const mission of [first, second]) {
          const loaded = await f.store.load(mission.id);
          assert.equal(loaded.kind === 'found' ? loaded.mission.defectProvenance : undefined, null);
        }
        await f.database.execute('DROP TRIGGER reject_second_provenance');
        const originalEntries = [unresolved(first.id), unresolved(second.id)];
        assert.equal((await service.apply(originalEntries)).applied, 2);
        const replacements = originalEntries.map(entry => ({ ...entry, provenance: { ...entry.provenance, rootCauseSummary: `Replacement ${entry.missionId}` } }));
        const preserved = await service.apply(replacements);
        assert.deepEqual({ applied: preserved.applied, alreadyPopulated: preserved.alreadyPopulated }, { applied: 0, alreadyPopulated: 2 });
        const replaced = await service.apply(replacements, true);
        assert.deepEqual({ committed: replaced.committed, applied: replaced.applied }, { committed: true, applied: 2 });
        const reloaded = await f.store.load(first.id);
        assert.equal(reloaded.kind === 'found' ? reloaded.mission.defectProvenance?.rootCauseSummary : null, `Replacement ${first.id}`);
      } finally { await f.close(); }
    });
  });
}
