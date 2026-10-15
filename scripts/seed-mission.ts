import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { agentFamily } from '../src/domain/agents.js';
import { changeRevision, type Review } from '../src/domain/review.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/index.js';
import { resolveDatabasePath } from '../src/adapters/sqlite/database-path-resolver.js';

const slug = process.argv[2];
if (!slug) { throw new Error('usage: seed-mission.ts <slug>'); }

const now = new Date().toISOString();
const review: Review = {
  rounds: [
    {
      number: 1,
      subject: { change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' }, revision: changeRevision('seed-revision-0001') },
      reviewer: agentFamily('claude'),
      implementer: agentFamily('codex'),
      startedAt: now,
      decision: { kind: 'approved', decidedAt: now, comment: 'seed approval', source: { kind: 'local' } },
      response: null,
      phase: 'approved',
      disposition: 'APPROVED',
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    },
  ],
  intervention: null,
  stageLaunches: [],
  reviewEvents: [
    {
      position: 0,
      eventType: 'reviewer_outcome',
      roundNumber: 1,
      phase: 'review',
      actor: 'claude',
      content: 'requested changes',
      disposition: 'CHANGES_MADE',
      verdict: 'request-changes',
      itemDispositions: null,
      blockedReason: null,
      followUpReference: null,
      createdAt: now,
    },
  ],
};

const mission: Mission = {
  id: missionId(slug),
  repositoryId: repositoryId('local'),
  title: 'Fix hello world greeting',
  status: 'review',
  rawStatus: 'review',
  assignee: agentFamily('claude'),
  labels: missionLabels(['user_value']),
  checkpoints: [],
  review,
  netEngineeringLines: null,
  closedAt: null,
};

const db = new SqliteDatabaseAdapter();
await db.open({ path: resolveDatabasePath() });
await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
const store = new SqliteMissionStore(db);
const version = await store.save(mission, null);
console.log('seeded', slug, 'version', Number(version), 'status', mission.status);
await db.close?.();
