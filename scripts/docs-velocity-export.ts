import fs from 'node:fs';
import path from 'node:path';
import { initOperatorState } from '../src/adapters/sqlite/adapter-factory.js';
import { SqliteBoardLaneEventRepository } from '../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteUsageRepository } from '../src/adapters/sqlite/usage-repository.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { resolveCanonicalRepositoryId } from '../src/adapters/git/repository-identity.js';
import { ConcreteMetricsReadAdapter, missionCohortMetadata } from '../src/application/projections/metrics-read-adapter.js';
import { weeklyComparableOutcomes } from '../src/application/docs/velocity.js';

const root = process.cwd(), target = path.join(root, 'docs/metrics/velocity/weekly.json');
const snapshot = JSON.parse(fs.readFileSync(target, 'utf8')), repositoryId = resolveCanonicalRepositoryId(root);
const { db } = await initOperatorState(); const store = new SqliteMissionStore(db);
const outcomes = await new ConcreteMetricsReadAdapter({ laneEventRepo: new SqliteBoardLaneEventRepository(db), usageRepo: new SqliteUsageRepository(db), repositoryId, cohortMetadata: async () => missionCohortMetadata(await store.loadByRepository(repositoryId)) }).readOutcomes();
const dates = outcomes.map(o => o.closedAt.slice(0, 10)).sort();
snapshot.parallix = { source: 'Canonical lifecycle mission outcomes: integration-to-done lifecycle completion all classifications; exported without mission identities or telemetry.', observationDates: { startedOn: dates[0] ?? null, endedOn: dates.at(-1) ?? null }, weeks: weeklyComparableOutcomes(outcomes, new Date().toISOString()) };
fs.writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`);
