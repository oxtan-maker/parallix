/**
 * Mission tool (TASK-2434, CP-4): render the read-only board to a standalone
 * HTML file so it can be screenshotted and visually diffed against the
 * reference acceptance artifact.
 *
 * This is checkpoint evidence, not production code: the fixture below stands
 * in for a live snapshot so the diff has comparable data volume to the
 * reference's generated sample. Run with:
 *
 *   npx tsx missions/task-2434/render-board-snapshot.ts <output.html>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../../web/src/board.js';
import { toWebBoardSnapshot } from '../../src/interfaces/web/transport.js';
import { emptyMetrics, makeAttentionItem, makeCard, makeProjection } from '../../test/fixtures/board-projection.js';
import type { AgentAvailabilityMetric, BoardProjection } from '../../src/application/projections/board.js';
import type { MissionCard } from '../../src/application/projections/mission-board.js';
import { agentFamily } from '../../src/domain/agents.js';

const id = (value: string): MissionCard['id'] => value as MissionCard['id'];

const agentMetric = (overrides: Partial<AgentAvailabilityMetric>): AgentAvailabilityMetric =>
  ({ family: agentFamily('custom'), available: true, blockedForMs: 0, reason: null, ...overrides });

const gateFailed = makeCard({
  id: id('task-1453'), title: 'migrate stats.csv to 22-column extended schema',
  lane: 'active', status: 'active', agent: agentFamily('codex'),
  checkpoint: 'CP-3/5', checkpointDescription: 'CP-3: schema upsert', gate: 'failed',
  nextActionText: 'fix upsert key collision on (repo, mission, stage)',
  flags: ['gate_failed'],
  commands: [{ command: 'active', enabled: true, reason: null }],
});

const reviewBlocking = makeCard({
  id: id('task-1447'), title: 'retry forgejo PR sync on transient 502',
  lane: 'review', status: 'review', agent: agentFamily('codex'),
  checkpoint: 'CP-4/4', gate: 'passed', reviewRound: 2, reviewPhase: 'act-on-review',
  reviewDisposition: '2 blocking', blockingReason: 'reviewer requested changes',
  nextActionText: 'act on reviewer findings (backoff cap, test for 502→200)',
  flags: ['review_blocking'],
  commands: [{ command: 'active', enabled: true, reason: null }, { command: 'review', enabled: false, reason: 'findings are unresolved' }],
});

const waitingHuman = makeCard({
  id: id('task-1440'), title: 'refresh graphify-out during integrate gate',
  lane: 'integration', status: 'integration', agent: agentFamily('codex'),
  checkpoint: 'CP-3/3', gate: 'passed', reviewRound: 1, reviewDisposition: 'clean',
  nextActionText: 'awaiting operator px integrate', flags: ['waiting_human'],
  commands: [{ command: 'integrate', enabled: true, reason: null }],
});

const projection: BoardProjection = {
  ...makeProjection({
    backlog: [
      makeCard({ id: id('task-1458'), title: 'add px undraft to abort a drafted mission cleanly', lane: 'backlog', status: 'backlog', commands: [{ command: 'draft', enabled: true, reason: null }] }),
      makeCard({ id: id('task-1459'), title: 'handle windows-style worktree paths in shell-init', lane: 'backlog', status: 'backlog', commands: [{ command: 'draft', enabled: true, reason: null }] }),
      makeCard({ id: id('task-1462'), title: 'graphify: skip refresh when graph is younger than HEAD', lane: 'backlog', status: 'backlog', commands: [{ command: 'draft', enabled: true, reason: null }] }),
    ],
    refined: [
      makeCard({ id: id('task-1456'), title: 'surface blocklist countdown in px active preflight', lane: 'refined', status: 'refined', commands: [{ command: 'active', enabled: true, reason: null }] }),
      makeCard({ id: id('task-1454'), title: 'split verify-local.sh integrate area into staged plan', lane: 'refined', status: 'refined', commands: [{ command: 'active', enabled: false, reason: 'no implementer family is eligible' }] }),
    ],
    active: [
      makeCard({ id: id('task-1451'), title: 'add jitter to usage-limit backoff windows', lane: 'active', status: 'active', agent: agentFamily('claude'), checkpoint: 'CP-2/4', gate: 'passed', nextActionText: 'extend limit-hit.js regex table with retry-after capture', commands: [{ command: 'review', enabled: true, reason: null }] }),
      gateFailed,
      makeCard({ id: id('task-1455'), title: 'lint checkpoint docs for literal Next action: line', lane: 'active', status: 'active', agent: agentFamily('mistral'), checkpoint: 'CP-1/2', gate: 'unknown', nextActionText: 'add lint stage to verify-local.sh docs area', flags: ['agent_stuck'], commands: [{ command: 'active', enabled: false, reason: 'mistral is blocked by a usage limit' }] }),
    ],
    review: [
      reviewBlocking,
      makeCard({ id: id('task-1449'), title: 'quote worktree paths in shell-init cd hook', lane: 'review', status: 'review', agent: agentFamily('claude'), checkpoint: 'CP-2/2', gate: 'passed', reviewRound: 1, reviewDisposition: 'clean', nextActionText: 'review in progress', commands: [] }),
    ],
    integration: [
      waitingHuman,
      makeCard({ id: id('task-1444'), title: 'record Base-Branch: line idempotently on redraft', lane: 'integration', status: 'integration', agent: agentFamily('claude'), checkpoint: 'CP-2/2', gate: 'passed', reviewRound: 1, reviewDisposition: 'clean', nextActionText: 'awaiting operator px integrate', flags: ['waiting_human'], commands: [{ command: 'integrate', enabled: true, reason: null }] }),
    ],
    done: [
      makeCard({ id: id('task-1436'), title: 'migrate timed blocklist to PARALLIX_HOME', lane: 'done', status: 'done', closed: true }),
      makeCard({ id: id('task-1432'), title: 'code-block self-approval at review provider', lane: 'done', status: 'done', closed: true }),
      makeCard({ id: id('task-1429'), title: 'px diff: reject plain pagers, accept delta/difft', lane: 'done', status: 'done', closed: true }),
    ],
  }, '~/dev/visualBoard'),
  attentionQueue: [
    makeAttentionItem(waitingHuman, { kind: 'integrate-lane', detail: 'reviewed and approved — nothing merges itself' }, 1),
    makeAttentionItem(reviewBlocking, { kind: 'blocking', detail: 'blocking findings on the open review round' }, 2),
    makeAttentionItem(gateFailed, { kind: 'gate-failed', detail: 'verification gate failed at CP-3/5' }, 3),
  ],
  availableActions: [{ command: 'draft', enabled: true, reason: null }],
  operationLog: [
    { operationId: 'op-1', phase: 'active', message: 'implementer selected for task-1451', timestamp: '2026-08-30T13:29:05Z', agent: agentFamily('claude') },
    { operationId: 'op-2', phase: 'checkpoint', message: 'CP-2 committed · gate pass', timestamp: '2026-08-30T13:32:45Z' },
  ],
  sourceFacts: [
    { source: 'task-markdown', status: 'fresh' },
    { source: 'git', status: 'fresh' },
    { source: 'stats', status: 'unavailable' },
  ],
  metrics: {
    ...emptyMetrics,
    agentAvailability: [
      agentMetric({ family: agentFamily('codex'), runningSessions: 2 }),
      agentMetric({ family: agentFamily('claude'), runningSessions: 2 }),
      agentMetric({ family: agentFamily('mistral'), available: false, blockedForMs: 2_455_000, reason: 'usage limit hit', runningSessions: 0 }),
      agentMetric({ family: agentFamily('custom'), runningSessions: null }),
    ],
    unattributedRunningSessions: 0,
  },
};

const target = process.argv[2];
if (target === undefined) {
  throw new Error('usage: render-board-snapshot.ts <output.html>');
}
const css = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'web', 'src', 'style.css'), 'utf8');
const markup = renderToStaticMarkup(
  React.createElement('main', {
    style: {
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0c110e', color: '#cfd9d2',
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12, overflow: 'hidden',
    },
  }, React.createElement(Board, { snapshot: toWebBoardSnapshot(projection) })),
);
fs.writeFileSync(target, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parallix web board</title><style>${css}</style></head><body>${markup}</body></html>
`);
