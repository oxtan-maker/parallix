import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ConcreteGateReadAdapter } from '../src/adapters/backlog/concrete-gate-read-adapter.js';
import { ConcreteGitReadAdapter } from '../src/adapters/backlog/concrete-git-read-adapter.js';
import { ConcreteMissionReadAdapter } from '../src/adapters/backlog/concrete-mission-read-adapter.js';
import { ConcreteOperationLogReadAdapter } from '../src/adapters/backlog/concrete-operation-log-read-adapter.js';
import { ConcreteReviewReadAdapter } from '../src/adapters/backlog/concrete-review-read-adapter.js';
import { BoardProjectionBuilder } from '../src/application/projections/board-readers.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  createPrimaryAndWorktree,
  fixedClock,
  withStatisticsDatabase,
} from './fixtures/task-2357-statistics-fixture.js';
import {
  CURRENT_SHAPE,
  OLD_SHAPE,
  PREVIOUS_SHAPE,
  persistMission,
  persistOpenMission,
} from './fixtures/task-2363-certification-fixture.js';

const NOW = '2026-08-11T12:00:00.000Z';
const REPO = repositoryId('task-2363-certification');
const CURRENT_CLOSED = '2026-08-11T10:00:00.000Z';
const PREVIOUS_CLOSED = '2026-08-04T10:00:00.000Z';
const OLD_CLOSED = '2026-06-01T10:00:00.000Z';
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

function writeCompletedTask(root: string, id: string, closedAt: string): void {
  const dir = path.join(root, 'backlog', 'completed');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id} - fixture.md`), `---
id: ${id.toUpperCase()}
title: Certification ${id}
status: done
closedAt: '${closedAt}'
labels: [ai_sdlc]
---
`);
}

function writeOpenTask(root: string): void {
  const dir = path.join(root, 'backlog', 'tasks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task-open - fixture.md'), `---
id: TASK-OPEN
title: Open certification mission
status: active
labels: [ai_sdlc]
---
`);
}

async function renderFlow(metrics: Awaited<ReturnType<BoardProjectionBuilder['build']>>['metrics']): Promise<string> {
  const ink = await import('ink');
  const React = await import('react');
  const { FlowPanel } = await import('../src/interfaces/tui/flow-panel.js');
  return ink.renderToString(
    React.createElement(FlowPanel, { metrics, columns: 200 }),
    { columns: 200 },
  ).replace(ANSI, '');
}

describe('TASK-2363 production certification: persisted weekly FLOW decision surface', () => {
  it('keeps 240 historical rows out of the hand-computed current weekly FLOW population', async () => {
    // Boundary coverage: this uses a real git worktree and migrated SQLite,
    // so the test-run plan schedules it only in the integration suite.
    const checkouts = createPrimaryAndWorktree('task-2363-certification');
    try {
      // The linked worktree is deliberate: canonical identity and board reads
      // must remain safe in a real Git worktree topology, without launching an agent.
      assert.ok(fs.existsSync(checkouts.worktree));
      writeOpenTask(checkouts.primary);

      await withStatisticsDatabase(async ({ db, laneEventRepo, usageRepo, historyRepo }) => {
        for (let index = 0; index < 240; index += 1) {
          const id = `task-old-${index}`;
          writeCompletedTask(checkouts.primary, id, OLD_CLOSED);
          await persistMission(laneEventRepo, db, {
            repositoryId: REPO, missionId: id, closedAt: OLD_CLOSED,
            cycleTimeMinutes: 1_000, shape: OLD_SHAPE, bounced: false, classification: 'ai_sdlc',
            telemetry: { durationMinutes: 1_000, prFixRounds: 9 },
          });
        }
        for (let index = 0; index < 28; index += 1) {
          const id = `task-previous-${index}`;
          writeCompletedTask(checkouts.primary, id, PREVIOUS_CLOSED);
          await persistMission(laneEventRepo, db, {
            repositoryId: REPO, missionId: id, closedAt: PREVIOUS_CLOSED,
            cycleTimeMinutes: 140, shape: PREVIOUS_SHAPE, bounced: true, classification: 'ai_sdlc',
            telemetry: { durationMinutes: 25, prFixRounds: 1 },
          });
        }
        for (let index = 0; index < 31; index += 1) {
          const id = `task-current-${index}`;
          writeCompletedTask(checkouts.primary, id, CURRENT_CLOSED);
          await persistMission(laneEventRepo, db, {
            repositoryId: REPO, missionId: id, closedAt: CURRENT_CLOSED,
            cycleTimeMinutes: 40, shape: CURRENT_SHAPE, bounced: index < 5, classification: 'ai_sdlc',
            telemetry: { durationMinutes: 15, prFixRounds: index === 0 ? 0 : index === 1 ? undefined : 1 },
          });
        }
        await persistOpenMission(laneEventRepo, REPO, 'task-open', '2026-08-10T08:00:00.000Z');

        const missionReader = new ConcreteMissionReadAdapter({ rootDir: checkouts.primary, repositoryId: REPO });
        const metricsAdapter = new ConcreteMetricsReadAdapter({
          laneEventRepo, usageRepo, historyRepo, repositoryId: REPO, clock: fixedClock(NOW),
        });
        const projection = await new BoardProjectionBuilder(
          missionReader,
          new ConcreteReviewReadAdapter({ rootDir: checkouts.primary, missionStore: null }),
          new ConcreteGateReadAdapter({ rootDir: checkouts.primary }),
          {
            loadAgentAvailability: async () => [],
            loadAssignedAgent: async () => null,
            // The certification never probes or starts an agent process.
            loadRunningSessions: async () => [],
          },
          new ConcreteGitReadAdapter({ rootDir: checkouts.primary, repositoryId: REPO }),
          new ConcreteOperationLogReadAdapter({ historyRepo }),
          { metricsAdapter },
        ).build();

        // Hand-computed oracle: 31 current missions × 40 min; old 240 × 1000
        // min and the 28 previous missions are deliberately outside Aug 5–11.
        assert.equal(projection.metrics.decisionWindow?.current.completedMissions, 31);
        assert.deepEqual(projection.metrics.decisionWindow?.current.cycleTime, { value: 40, observationCount: 31 });
        assert.deepEqual(projection.metrics.decisionWindow?.previous.cycleTime, { value: 140, observationCount: 28 });
        assert.deepEqual(projection.metrics.decisionWindow?.current.agentRuntime, { value: 15, observationCount: 31 });
        assert.deepEqual(projection.metrics.decisionWindow?.current.activeDwell, { value: 9, observationCount: 36 });
        assert.deepEqual(projection.metrics.decisionWindow?.current.reviewDwell, { value: 4, observationCount: 36 });
        assert.deepEqual(projection.metrics.decisionWindow?.current.integrationDwell, { value: 3, observationCount: 31 });
        assert.deepEqual(projection.metrics.decisionWindow?.current.reviewBounce, { value: 5 / 31, observationCount: 31 });
        assert.equal(projection.metrics.cohorts?.cohorts[0]?.n, 31);
        // One current mission deliberately has an unknown count; known zero is
        // still an observation, so only that unknown is excluded.
        assert.equal(projection.metrics.cohorts?.cohorts[0]?.observationCounts.reviewFixRounds, 30);
        assert.equal(projection.metrics.cohorts?.cohorts[0]?.medianReviewFixRounds, 1);

        const flow = await renderFlow(projection.metrics);
        assert.match(flow, /decision window 2026-08-05 → 2026-08-11/);
        assert.match(flow, /Completed missions\s+n=31\s+n=28/);
        assert.match(flow, /Lifecycle cycle median\s+40 min \(n=31\)\s+140 min/);
        assert.match(flow, /\(n=28\)/);
        assert.match(flow, /population n=299 \(all recorded history, not the decision sample\)/);
      });
    } finally {
      checkouts.cleanup();
    }
  });
});
