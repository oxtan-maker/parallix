// TASK-2594 — TASK-2521.07 kept its classification only in the provider
// task.  Once closeout removed that task, integration statistics could no
// longer record the completed Mission even though the aggregate remained.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { recordIntegrationStats } from '../src/adapters/cli/commands/stats.js';
import { MissionBriefService } from '../src/application/mission-brief-service.js';

const slug = 'task-2521.07';

function missionWithLabels(labels: readonly string[]): Mission {
  return {
    id: missionId(slug), repositoryId: repositoryId('parallix'), title: 'classification regression',
    labels: missionLabels(labels), status: 'done', assignee: agentFamily('codex'),
    checkpoints: [], closedAt: '2026-09-27T12:00:00.000Z', netEngineeringLines: null,
    review: {
      rounds: [{ number: 1, implementer: agentFamily('codex'), reviewer: agentFamily('claude'),
        subject: { revision: 'landed' }, decision: { kind: 'approved', decidedAt: '2026-09-27T11:00:00.000Z', comment: null, source: { kind: 'local' } } }],
      reviewEvents: [], stageLaunches: [], intervention: null,
    } as unknown as Mission['review'],
  };
}

function missionStore(mission: Mission) {
  return {
    async load(id: ReturnType<typeof missionId>) {
      return String(id) === slug
        ? { kind: 'found' as const, mission, version: 1 as never }
        : { kind: 'missing' as const };
    },
  };
}

test('TASK-2594: classification writes preserve labels for native and imported Mission identities', async () => {
  for (const origin of ['native', 'imported'] as const) {
    let mission = missionWithLabels([origin, 'bug', 'ai_sdlc']);
    let version = 4;
    const service = new MissionBriefService({
      async load() { return { kind: 'found' as const, mission, version: version as never }; },
      async save(next: Mission, expected: number) {
        assert.equal(expected, version, `${origin} write uses the loaded version`);
        mission = next; version += 1; return version as never;
      },
    } as never);
    const result = await service.setClassification({
      operationId: `test-${origin}`, missionId: missionId(slug), expectedVersion: version as never,
      capabilities: new Set(['mission:context']), classification: 'user_value',
    });
    assert.equal(result.status, 'completed');
    assert.deepEqual(mission.labels.map(String).sort(), ['bug', origin, 'user_value'].sort());
    const invalid = await service.setClassification({
      operationId: `invalid-${origin}`, missionId: missionId(slug), expectedVersion: version as never,
      capabilities: new Set(['mission:context']), classification: 'other',
    });
    assert.equal(invalid.status, 'failed');
  }
});

test('TASK-2594: TASK-2521.07 requires stored classification before draft completion and after provider-file closeout', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2594-'));
  const taskFile = path.join(root, 'backlog', 'tasks', `${slug} - provider.md`);
  try {
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, [
      '---', 'id: TASK-2521.07', 'labels: [ai_sdlc, migration]', 'status: review', '---', '',
    ].join('\n'));

    const staleStore = missionStore(missionWithLabels(['migration', 'workflow']));
    await assert.rejects(
      recordIntegrationStats({ slug, rootDir: root, date: '2026-09-27', store: inMemoryMeasurements(), missionStore: staleStore as never }),
      /requires exactly one classification|px state/i,
      'provider-only ai_sdlc must not allow draft/closeout to treat an unclassified Mission as valid',
    );

    const classifiedStore = missionStore(missionWithLabels(['migration', 'workflow', 'ai_sdlc']));
    const measurements = inMemoryMeasurements();
    fs.rmSync(taskFile);
    const first = await recordIntegrationStats({ slug, rootDir: root, date: '2026-09-27', store: measurements, missionStore: classifiedStore as never });
    const second = await recordIntegrationStats({ slug, rootDir: root, date: '2026-09-27', store: measurements, missionStore: classifiedStore as never });

    assert.equal(first.row.classification, 'ai_sdlc');
    assert.equal(first.metadataSource.classification, 'mission-aggregate');
    assert.equal(second.changed, false, 'post-landing statistics repair is idempotent');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function inMemoryMeasurements() {
  const rows: any[] = [];
  return {
    upsertMeasurement(row: any) {
      const existing = rows.findIndex(candidate => candidate.repo === row.repo && candidate.mission === row.mission && candidate.stage === row.stage);
      if (existing >= 0) { return { changed: false }; }
      rows.push(row);
      return { changed: true };
    },
    listMeasurements() { return rows; },
  };
}
