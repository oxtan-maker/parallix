// Verification statistics composition: which retained-run population each
// consumer owns. The per-Mission FLOW projection reads the narrow delivery
// population; the repository-wide verification breakdown reads every retained
// agent run of this repository, open or historical (PX-0055.04).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVerificationStatisticsReader, verificationStatisticsReader } from '../../../src/composition/verification-statistics.js';
import { resolveCanonicalRepositoryId } from '../../../src/adapters/git/repository-identity.js';
import { initOperatorState } from '../../../src/adapters/sqlite/adapter-factory.js';
import { SqliteBoardLaneEventRepository } from '../../../src/adapters/sqlite/board-lane-event-repository.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { RUN_RECORD_FILE } from '../../../src/application/run-history-types.js';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';

function retainAgentRun(historyRoot: string, repositoryId: string, missionId: string, runId: string): void {
  const dir = path.join(historyRoot, missionId, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, RUN_RECORD_FILE), JSON.stringify({
    version: 1, runId, missionId, repositoryId, captureKind: 'agent', role: 'execute', family: 'codex',
    attempt: 1, hostFallbackReason: null, supervisorPid: 1, operationId: null, execution: null, terminalHost: 'pipe',
    tmux: null, state: 'exited', startedAt: '2026-11-01T00:00:00.000Z', endedAt: '2026-11-01T00:01:00.000Z',
    exitCode: 0, signal: null, providerSessionId: null, redacted: false, sources: [], omissions: [],
    streams: { stdout: { bytes: 0, retainedBytes: 0, omitted: [] }, stderr: { bytes: 0, retainedBytes: 0, omitted: [] } },
  }));
}

test('verification input collection receives the requested Mission scope (PX-0055.04)', async () => {
  let collected: ReadonlySet<string> | undefined;
  const reader = verificationStatisticsReader(async missions => {
    collected = missions;
    return { repositoryId: 'repo', history: [], operations: [], lifecycle: [], runs: [] };
  });
  const requested = new Set(['delivered-mission']);

  await reader.read(requested);

  assert.equal(collected, requested,
    'the retained-run producer must not scan unrelated historical Missions before the projection applies its scope');
});

test('repository verification narrows only the FLOW retained-run producer (PX-0055.04)', async () => {
  let statisticsScope: ReadonlySet<string> | undefined;
  let flowRunScope: ReadonlySet<string> | undefined;
  const reader = verificationStatisticsReader(async (missions, flowRunMissions) => {
    statisticsScope = missions;
    flowRunScope = flowRunMissions;
    return { repositoryId: 'repo', history: [], operations: [], lifecycle: [], runs: [], flowRuns: [] };
  });
  const flowMissions = new Set(['current-delivery']);

  await reader.readRepository!(flowMissions);

  assert.equal(statisticsScope, undefined, 'repository attempts and history stay unfiltered');
  assert.equal(flowRunScope, flowMissions, 'only the expensive per-Mission FLOW producer uses the weekly scope');
});

test('repository verification still observes agent runs outside the delivery cohort (PX-0055.04)', async () => {
  const root = registeredMkdtemp('px-0055.04-run-population-');
  try {
    const checkout = path.join(root, 'repository');
    const historyRoot = path.join(checkout, '.workflow', 'run-history');
    const configuration = resolveConfiguration({ PARALLIX_HOME: path.join(root, 'operator') });
    const repositoryId = resolveCanonicalRepositoryId(checkout);
    // One delivered mission and one open mission, each with one retained agent run.
    retainAgentRun(historyRoot, repositoryId, 'delivered-mission', 'execute-codex-a1-deliv1');
    retainAgentRun(historyRoot, repositoryId, 'open-mission', 'execute-codex-a1-open01');
    const { db } = await initOperatorState({ configuration });
    const lifecycle = new SqliteBoardLaneEventRepository(db);
    for (const missionId of ['delivered-mission', 'open-mission']) {
      await lifecycle.append({ repositoryId, missionId, fromStatus: 'review', toStatus: 'done', trigger: 'integration',
        agent: 'codex', occurredAt: '2026-11-02T00:00:00.000Z', idempotencyKey: `done-${missionId}` });
    }

    const statistics = await createVerificationStatisticsReader(checkout, configuration).readRepository!(new Set(['delivered-mission']));

    assert.deepEqual(statistics.flowMissions.map(mission => mission.missionId), ['delivered-mission'],
      'the per-Mission FLOW projection stays scoped to the delivery population');
    assert.deepEqual(statistics.agentResources.runs.map(run => run.missionId).sort(), ['delivered-mission', 'open-mission'],
      'the verification breakdown owns the repository-wide agent-run population, so an open mission cannot be dropped silently');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
