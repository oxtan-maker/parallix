import { webProjection } from '../../../fixtures/web-projection.js';
// Mission identity and optional facts rendered through the validated production Board.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../../../../web/src/board.js';
import { projectMissionCard, type MissionCard } from '../../../../src/application/projections/mission-board.js';
import { validateWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import { makeCard, makeFullCard, makeProjection } from '../../../fixtures/board-projection.js';
import { fixtureMission } from '../../../fixtures/mission-builders.js';

// TASK-2784: retired card facts belong to the production Board, after wire validation.
function renderedCard(card: MissionCard): string {
  const wire = JSON.parse(JSON.stringify(webProjection.snapshot(makeProjection({ [card.lane]: [card] }))));
  const validation = validateWebBoardSnapshot(wire);
  assert.ok(validation.ok);
  const article = renderToStaticMarkup(React.createElement(Board, { snapshot: validation.value, onRefresh: async () => {} })).match(/<article\b[^>]*data-board-card="[^"]*"[\s\S]*?<\/article>/)?.[0];
  assert.ok(article);
  return article;
}

test('Board preserves populated mission identity, supplied PR URL and review phase (TASK-2784)', () => {
  const card = makeFullCard({ reviewRound: 2, reviewPhase: 'fixing', reviewDisposition: 'REQUEST_CHANGES' });
  const html = renderedCard(card);
  assert.ok(html.includes(card.id));
  assert.ok(html.includes(card.title));
  assert.match(html, /Recorded: CP-2\.md/);
  assert.match(html, /data-gate="passed"[^>]*>[\s\S]*?<svg[^>]*aria-label="Passed"/);
  assert.match(html, /<a href="https:\/\/example\.invalid\/pr\/42"[^>]*>PR #42<\/a>/);
  assert.match(html, /aria-label="Review attempts"/, 'the review budget renders as a named group');
  assert.match(html, /data-review-attempt="2"[^>]*data-review-state="changes-requested"/,
    'the supplied round and its recorded disposition survive wire validation');
});

test('Board leaves absent checkpoint, PR and review facts unknown (TASK-2784)', () => {
  const html = renderedCard(makeCard({ gate: 'unavailable' }));
  assert.match(html, /checkpoints · completion unknown/);
  assert.match(html, /data-gate="unavailable"[^>]*>[\s\S]*?<svg[^>]*aria-label="Unknown"/);
  assert.match(html, /Gate evidence could not be observed/);
  assert.doesNotMatch(html, /Recorded:|PR #|review round \d|round \d\/5/);
  assert.doesNotMatch(html, /<a\b[^>]*>PR /);
});

test('Board identifies a PR with null URL without inventing a PR anchor (TASK-2784)', () => {
  const card = makeFullCard();
  assert.ok(card.pullRequest);
  const html = renderedCard({ ...card, pullRequest: { ...card.pullRequest, id: '77', url: null } });
  assert.match(html, /<span[^>]*>PR #77<\/span>/);
  assert.doesNotMatch(html, /<a\b[^>]*>PR /);
  assert.doesNotMatch(html, /href="[^"]*(?:77|pull|pr\/)/);
});

test('repair verification controls reduced and complete web checkpoint progress (TASK-2858)', () => {
  const webMissionId = fixtureMission('task-repair-web-progress').id;
  const mission = fixtureMission('task-repair-web-progress', { status: 'active', checkpoints: [
    { missionId: webMissionId, name: 'CP-1', firstLine: 'Implement',
      goalCheck: [{ criterion: 'delivers', evidence: 'test/unit/interfaces/web/web-board-card-facts.cases.ts' }],
      nextActionText: 'Run verification' },
    { missionId: webMissionId, name: 'CP-2', firstLine: 'Repair verification',
      goalCheck: [{ criterion: 'delivers', evidence: 'test/unit/interfaces/web/web-board-card-facts.cases.ts',
        carriedFrom: 'CP-1' }],
      nextActionText: 'Repair the failed gate', repair: { incidentId: 'integration-1', command: 'npm test',
        authorizedGates: ['npm test'], authorizedCriteria: ['delivers'], attempt: 1,
        evidenceRecorded: false, verified: false },
    },
  ] });
  const facts = { latestGate: 'failed' as const, reviewApproval: null, currentWork: null, blockingReason: null, flags: [] };
  const open = projectMissionCard(mission, facts);
  const openHtml = renderedCard(open);
  assert.equal(open.currentCheckpoint, 'CP-2');
  assert.match(openHtml, /aria-description="1\/2 completed · Current: CP-2 · Recorded: CP-2"/);
  assert.match(openHtml, /data-checkpoint-fill=""[^>]*width:50%/);
  assert.doesNotMatch(openHtml, /data-checkpoint-complete=""/);

  const verified = projectMissionCard({ ...mission, checkpoints: mission.checkpoints.map(checkpoint => checkpoint.repair
    ? { ...checkpoint, repair: { ...checkpoint.repair, evidenceRecorded: true, verified: true } }
    : checkpoint) }, facts);
  const verifiedHtml = renderedCard(verified);
  assert.equal(verified.currentCheckpoint, null);
  assert.match(verifiedHtml, /aria-description="2\/2 completed · Recorded: CP-2"/);
  assert.match(verifiedHtml, /data-checkpoint-fill=""[^>]*width:100%/);
  assert.equal((verifiedHtml.match(/data-checkpoint-complete=""/g) ?? []).length, 1);
  assert.doesNotMatch(verifiedHtml, /Current: CP-2/);
});

