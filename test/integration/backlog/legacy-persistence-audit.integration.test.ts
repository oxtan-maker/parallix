import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { auditLegacyFiles } from '../../../src/adapters/backlog/legacy-mission-audit.js';
import type { MissionStore } from '../../../src/application/domain-ports.js';
import type { Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { readExportedReviewEvents } from '../../../src/adapters/review/review-state.js';
import { hasApprovedCheckpointException } from '../../../src/adapters/backlog/legacy-mission-content.js';
import { importLegacyMissions, type MissionImportServices } from '../../../src/adapters/backlog/legacy-mission-import.js';

test('task-2521.06: runtime audit permits Backlog mirrors but rejects live legacy materializers and document writers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-runtime-'));
  try {
    const write = (name: string, content: string) => {
      const file = path.join(root, 'src', name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    };
    write('adapters/backlog/concrete-mission-read-adapter.ts', 'export class ConcreteMissionReadAdapter {}');
    write('adapters/backlog/task-transitions.ts', 'fs.writeFileSync(taskFilePath, content);');
    const store = { loadByRepository: async () => [] } as unknown as MissionStore;
    const allowed = await auditLegacyFiles(root, repositoryId('parallix'), store);
    assert.equal(allowed.counters.normalRuntimeReadersOfRetiredPaths, 0);
    assert.equal(allowed.counters.normalRuntimeWritersOfRetiredPaths, 0);
    write('composition/board.ts', "import { ConcreteMissionReadAdapter } from '../adapters/backlog/concrete-mission-read-adapter.js';");
    write('adapters/rogue.ts', "fs.writeFileSync(path.join(root, 'MISSION.md'), content);");
    const rejected = await auditLegacyFiles(root, repositoryId('parallix'), store);
    assert.equal(rejected.counters.normalRuntimeReadersOfRetiredPaths, 1);
    assert.equal(rejected.counters.normalRuntimeWritersOfRetiredPaths, 1);
    assert.equal(rejected.verdict, 'NO-GO');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('task-2521.06: legacy audit treats an archive copy as obsolete when the completed body is pinned', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-archive-'));
  for (const dir of ['completed', 'archive']) fs.mkdirSync(path.join(root, 'backlog', dir), { recursive: true });
  const body = (text: string) => `---\nid: TASK-9001\ntitle: Example\n---\n\n${text}\n`;
  fs.writeFileSync(path.join(root, 'backlog/completed/task-9001.md'), body('Canonical body.'));
  fs.writeFileSync(path.join(root, 'backlog/archive/task-9001.md'), body('Older body.'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const mission = {
    id: 'task-9001', repositoryId: repositoryId('parallix'), status: 'done', checkpoints: [],
    externalTaskRef: { source: 'backlog-md', id: 'TASK-9001', url: `backlog/completed/task-9001.md@${commit}` },
  } as unknown as Mission;
  const store = { loadByRepository: async () => [mission] } as unknown as MissionStore;
  const audit = await auditLegacyFiles(root, repositoryId('parallix'), store);
  assert.deepEqual(audit.files.map(file => file.classification), ['obsolete', 'imported Mission']);
  assert.equal(audit.counters.unresolvedLegacyFiles, 0);
});

test('task-2521.06: legacy audit verifies a committed preservation copy of a nonstandard checkpoint', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-nonstandard-'));
  const name = 'missions/task-9002/CP-FINAL.md';
  const body = '# CP-FINAL: extra evidence\n\nHistorical result.\n';
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), body);
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  run('init', '-q');
  run('add', '.');
  run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'source');
  const sourceCommit = run('rev-parse', 'HEAD');
  const artifact = path.join(root, 'missions/task-2521.06/artifacts/nonstandard-checkpoints.json');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, JSON.stringify({ sourceCommit, entries: [{
    file: name, sha256: createHash('sha256').update(body).digest('hex'), content: body,
  }] }));
  run('add', '.');
  run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'archive');
  const store = { loadByRepository: async () => [] } as unknown as MissionStore;
  const verified = await auditLegacyFiles(root, repositoryId('parallix'), store);
  assert.equal(verified.files.find(file => file.path === name)?.classification, 'retained external artifact');
  fs.writeFileSync(path.join(root, name), body + 'changed');
  const changed = await auditLegacyFiles(root, repositoryId('parallix'), store);
  assert.equal(changed.files.find(file => file.path === name)?.classification, 'UNRESOLVED');
});

test('task-2521.06: legacy audit verifies historical artifacts outside the deletion tree', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-artifact-'));
  const name = 'missions/task-9007/data/dataset.md';
  const body = 'Historical dataset\n';
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), body);
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  run('init', '-q'); run('add', '.');
  run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'source');
  const sourceCommit = run('rev-parse', 'HEAD');
  const artifact = path.join(root, 'missions/task-2521.06/artifacts/retained-mission-artifacts.json');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, JSON.stringify({ sourceCommit, entries: [{
    file: name, sha256: createHash('sha256').update(body).digest('hex'), content: body,
  }] }));
  run('add', '.'); run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'archive');
  const store = { loadByRepository: async () => [] } as unknown as MissionStore;
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), store)).files.find(file => file.path === name)?.classification, 'retained external artifact');
  fs.writeFileSync(path.join(root, name), 'Changed dataset\n');
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), store)).files.find(file => file.path === name)?.classification, 'UNRESOLVED');
});

test('task-2521.06: legacy audit compares NEL export to recorded Mission measurement', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-nel-'));
  const dir = path.join(root, 'missions/task-9003');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'nel-record.json'), JSON.stringify({
    slug: 'task-9003', predictedBucket: 'Medium', actualNel: 42, actualBucket: 'Small',
  }));
  const mission = { id: 'task-9003', repositoryId: repositoryId('parallix'),
    netEngineeringLines: 42, predictedNelBucket: 'Medium', checkpoints: [], status: 'done',
  } as unknown as Mission;
  const store = { loadByRepository: async () => [mission] } as unknown as MissionStore;
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), store)).files[0].classification, 'identical Mission');
  fs.writeFileSync(path.join(dir, 'nel-record.json'), JSON.stringify({
    slug: 'task-9003', predictedBucket: 'Medium', actualNel: 43, actualBucket: 'Small',
  }));
  const changed = await auditLegacyFiles(root, repositoryId('parallix'), store);
  assert.equal(changed.counters.migrationVerificationFailures, 1);
});

test('task-2521.06: legacy audit checks every exported review event against its Mission row', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-review-'));
  const dir = path.join(root, 'missions/task-9004/review-events');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '2026-01-01-reviewer_findings.md');
  fs.writeFileSync(file, '---\nevent_type: reviewer_findings\ntimestamp: 2026-01-01T00:00:00.000Z\nround: 1\nphase: reviewing\nactor: codex\nslug: task-9004\n---\n\nFinding body\n');
  const events = readExportedReviewEvents('task-9004', root);
  const mission = { id: 'task-9004', repositoryId: repositoryId('parallix'), checkpoints: [], status: 'done',
    review: { reviewEvents: [{ position: 0, ...events[0] }] },
  } as unknown as Mission;
  const store = { loadByRepository: async () => [mission] } as unknown as MissionStore;
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), store)).files[0].classification, 'identical Mission');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Finding body', 'Changed body'));
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), store)).counters.migrationVerificationFailures, 1);
});

test('task-2521.06: legacy review parser accepts the older event and agent keys with source-backed timestamp', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-old-review-'));
  const dir = path.join(root, 'missions/task-9005/review-events');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-07-27T174412-implementer_disposition-4-custom.md'),
    '---\nevent: implementer_disposition\nround: 3\nagent: custom\ndisposition: CHANGES_MADE\n---\n\nHistorical resolution\n');
  const events = readExportedReviewEvents('task-9005', root);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'implementer_disposition');
  assert.equal(events[0].actor, 'custom');
  assert.equal(events[0].createdAt, '2026-07-27T17:44:12.000Z');
});

test('task-2521.06: legacy audit verifies review state and launch fingerprints', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-state-'));
  const dir = path.join(root, 'missions/task-9006');
  fs.mkdirSync(dir, { recursive: true });
  const state = { reviewer: 'codex', implementer: 'custom', round: 1,
    startedAt: '2026-01-01T00:00:00.000Z', phase: 'reviewing', disposition: null,
    metadata: { recordedStageLaunches: { 'review:codex': ['fingerprint'] } },
  };
  fs.writeFileSync(path.join(dir, 'review-state.json'), JSON.stringify(state));
  const mission = { id: 'task-9006', repositoryId: repositoryId('parallix'), checkpoints: [], status: 'done',
    review: { rounds: [{ reviewer: 'codex', implementer: 'custom', number: 1,
      startedAt: state.startedAt, phase: 'reviewing', disposition: null, subject: { change: { kind: 'local-branch' } },
    }], intervention: null, stageLaunches: [{ stageKey: 'review:codex', fingerprints: ['fingerprint'] }], reviewEvents: [] },
  } as unknown as Mission;
  const store = { loadByRepository: async () => [mission] } as unknown as MissionStore;
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), store)).files[0].classification, 'identical Mission');
  fs.writeFileSync(path.join(dir, 'review-state.json'), JSON.stringify({ ...state, metadata: { recordedStageLaunches: {} } }));
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), store)).counters.migrationVerificationFailures, 1);
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  run('init', '-q'); run('add', '.');
  run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'source');
  const content = fs.readFileSync(path.join(dir, 'review-state.json'), 'utf8');
  const artifact = path.join(root, 'missions/task-2521.06/artifacts/review-state-discrepancies.json');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, JSON.stringify({ sourceCommit: run('rev-parse', 'HEAD'), entries: [{
    file: 'missions/task-9006/review-state.json', sha256: createHash('sha256').update(content).digest('hex'), content,
  }] }));
  run('add', '.'); run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'archive');
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), store)).files[0].classification, 'retained external artifact');
});

test('task-2521.06: legacy audit traverses unknown files and fails closed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-audit-'));
  fs.mkdirSync(path.join(root, 'missions', 'task-9001', 'unexpected'), { recursive: true });
  fs.writeFileSync(path.join(root, 'missions', 'task-9001', 'MISSION.md'), '# Goal\n');
  fs.writeFileSync(path.join(root, 'missions', 'task-9001', 'unexpected', 'data.txt'), 'unknown');
  const store = { loadByRepository: async () => [] } as unknown as MissionStore;
  const audit = await auditLegacyFiles(root, repositoryId('parallix'), store);
  assert.equal(audit.files.length, 2);
  assert.equal(audit.counters.unresolvedLegacyFiles, 2);
  assert.equal(audit.counters.unparsedDataBearingFiles, 1);
  assert.equal(audit.verdict, 'NO-GO');
  assert.equal(audit.files.every(file => file.sha256.length === 64), true);
});

test('task-2521.06: unstarted backlog input needs no Mission or archive and is retained in place', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-future-'));
  fs.mkdirSync(path.join(root, 'backlog/tasks'), { recursive: true });
  const file = path.join(root, 'backlog/tasks/task-9008.md');
  const body = '---\nid: TASK-9008\ntitle: Future work\nstatus: backlog\n---\n\nOperator has not started this.\n';
  fs.writeFileSync(file, body);
  const store = { loadByRepository: async () => [] } as unknown as MissionStore;
  const audit = await auditLegacyFiles(root, repositoryId('parallix'), store);
  assert.equal(audit.files[0].classification, 'retained product/configuration');
  assert.equal(audit.counters.requiredTaskRecordsMissing, 0);
  assert.equal(audit.verdict, 'GO');
  assert.equal(fs.readFileSync(file, 'utf8'), body);
  const pendingStore = { loadByRepository: async () => [{
    id: 'task-9008', status: 'backlog', checkpoints: [], externalTaskRef: null,
  } as unknown as Mission] } as unknown as MissionStore;
  const pending = await auditLegacyFiles(root, repositoryId('parallix'), pendingStore);
  assert.equal(pending.files[0].classification, 'retained product/configuration');
  assert.equal(pending.verdict, 'GO');
  const nativeStore = { loadByRepository: async () => [{
    id: 'task-9008', status: 'refined', checkpoints: [], externalTaskRef: null,
  } as unknown as Mission] } as unknown as MissionStore;
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), nativeStore)).files[0].classification, 'retained product/configuration');
});

test('task-2521.06: TASK-2576 exception preserves the approved pair and fails closed on changes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-exception-'));
  const file = 'missions/task-2576/CP-1.md';
  const content = '# CP-1: Final summary\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Final result | test/example.test.ts | PASS |\n\nNext action: Integrate.\n';
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  run('init', '-q'); run('add', '.');
  run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'summary');
  const sourceCommit = run('rev-parse', 'HEAD');
  const checkpoint = { missionId: 'task-2576', name: 'CP-1', firstLine: 'Red reproduction',
    goalCheck: [{ criterion: 'Reproduced', evidence: 'Captured failing test' }], nextActionText: 'Implement fix.' };
  const mission = { id: 'task-2576', repositoryId: repositoryId('parallix'), status: 'done',
    closedAt: '2026-09-26T00:00:00.000Z', checkpoints: [checkpoint] } as unknown as Mission;
  const archive = path.join(root, 'missions/task-2521.06/artifacts/task-2576-checkpoint-comparison.json');
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.writeFileSync(archive, JSON.stringify({ missionId: mission.id,
    exception: { approvedBy: 'operator', reason: 'Accept this final summary' },
    source: { file, sourceCommit, content, sha256: createHash('sha256').update(content).digest('hex') },
    recordedCheckpoints: [{ ...checkpoint, rawFilename: null }],
  }));
  assert.equal(hasApprovedCheckpointException(root, mission, file, content), false);
  run('add', '.'); run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'approve pair');
  const store = { loadByRepository: async () => [mission],
    load: async () => ({ kind: 'found', mission, version: 1 }),
    save: async () => { throw new Error('Exception must never replace checkpoints'); },
  } as unknown as MissionStore;
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), store)).files[0].classification, 'retained external artifact');
  const report = await importLegacyMissions({ repositoryId: repositoryId('parallix'), store } as unknown as MissionImportServices, { rootDir: root });
  assert.equal(report.conflicting, 0);
  assert.equal(report.checkpointFilesImportable, 0);
  assert.equal(hasApprovedCheckpointException(root, { ...mission, status: 'active', closedAt: null }, file, content), false);
  assert.equal(hasApprovedCheckpointException(root, mission, file, content + 'changed'), false);
  checkpoint.nextActionText = 'Changed database evidence';
  assert.equal(hasApprovedCheckpointException(root, mission, file, content), false);
});

test('task-2521.06: placeholder mission documents need no archive and do not satisfy typed context', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-template-'));
  fs.mkdirSync(path.join(root, 'missions/task-9009'), { recursive: true });
  fs.writeFileSync(path.join(root, 'missions/task-9009/MISSION.md'), '# Mission: <Title>\n\n## Goal\n<Goal>\n');
  const store = { loadByRepository: async () => [{
    id: 'task-9009', status: 'active', brief: null, successCriteria: [], checkpoints: [],
  } as unknown as Mission] } as unknown as MissionStore;
  const audit = await auditLegacyFiles(root, repositoryId('parallix'), store);
  assert.equal(audit.files[0].classification, 'obsolete');
  assert.equal(audit.counters.unparsedDataBearingFiles, 0);
  assert.equal(audit.counters.requiredMissionContextMissing, 1);
});

test('task-2521.06: legacy audit excludes only a committed operator stop while review remains blocked', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2521-06-stopped-'));
  const name = 'missions/task-2521.06/artifacts/stopped-missions.json';
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), '[{"id":"task-2550","reason":"Operator stopped this mission"}]\n');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', name]);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Record stop']);
  let disposition = 'BLOCKED';
  const store = { loadByRepository: async () => [{
    id: 'task-2550', status: 'review', brief: null, successCriteria: [], checkpoints: [],
    review: { rounds: [{ disposition }] },
  } as unknown as Mission] } as unknown as MissionStore;
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), store)).counters.requiredMissionContextMissing, 0);
  disposition = 'PARKED';
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), store)).counters.requiredMissionContextMissing, 1);
  disposition = 'BLOCKED';
  fs.writeFileSync(path.join(root, name), '[]\n');
  assert.equal((await auditLegacyFiles(root, repositoryId('parallix'), store)).counters.requiredMissionContextMissing, 1);
});
